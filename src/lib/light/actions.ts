"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { toMediaUrl } from "@/lib/media/url";
import { getServerMessages } from "@/lib/i18n/server";
import { localizeServerText } from "@/lib/i18n/server-text";
import { isBudgetExhaustedDetail, isRawProviderError } from "@/lib/generations/user-facing-error";
import type { AttemptLog } from "@/lib/generations/pipeline";
import { forceRefundEligible } from "@/lib/generations/refund-rules";
import { otherPictureEngine, refusedByEngineOnly } from "@/lib/generations/engine-refusal";
import { getImageModel } from "@/lib/generations/providers/image-models";
import { DEFAULT_IMAGE_QUALITY, defaultImageResolution, imageRenderCreditWeight } from "@/lib/generations/providers/image-resolution";
import { offered } from "@/lib/models/controls";
import { parseAppLook, parseAppMode } from "./mode";

type SaveResult = { error: string | null };

/**
 * Saves how this person creates (Light / Advanced) and/or their look, from
 * the welcome step and Settings. Only the two columns picacho-light.sql adds
 * and grants; before it runs the update errors and the caller says so.
 */
export async function saveAppChoices(input: { mode?: string; look?: string }): Promise<SaveResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session expired — please log in again." };

  const patch: { app_mode?: string; app_look?: string } = {};
  if (input.mode !== undefined) {
    const mode = parseAppMode(input.mode);
    if (!mode) return { error: "Unknown choice." };
    patch.app_mode = mode;
  }
  if (input.look !== undefined) {
    const look = parseAppLook(input.look);
    if (!look) return { error: "Unknown look." };
    patch.app_look = look;
  }
  if (Object.keys(patch).length === 0) return { error: null };

  const { error } = await supabase.from("profiles").update(patch).eq("id", data.user.id);
  if (error) return { error: error.message };

  // The shell (Light rail or the studio's sidebar) is chosen by the layout.
  if (patch.app_mode) revalidatePath("/app", "layout");
  return { error: null };
}

export type LightTake = {
  id: string;
  prompt: string;
  contentType: "image" | "video";
  status: string;
  resultUrl: string | null;
  creditsUsed: number;
  /** The day's free generation paid for it (free accounts). */
  freeGeneration: boolean;
  modelId: string | null;
  /** Why a failed take stopped, in the person's words (the take page's same rule). */
  failReason: string | null;
  /** When it was started: a card opened again mid-render counts its clock from here. */
  createdAt: string | null;
  /**
   * A failed take that was REFUSED (our content policy, the picture check,
   * or the provider turning the request away before rendering) rather than
   * broken: sending the same words again would only be refused again, so the
   * chat offers "Change the words" and no "Try again".
   */
  refused: boolean;
  /**
   * A picture only the ENGINE's filter refused, after Picacho's own check
   * found nothing (engine-refusal.ts): the other engine the chat may offer,
   * and its price. Null for every other failure, for a free account (pinned
   * to one engine, so a "try another" would render on the same one), and
   * when that engine is off the Models menu.
   */
  tryOther: { modelId: string; name: string; credits: number } | null;
};

/**
 * The last thing a failed render's log says, as the take page shows it: a
 * raw provider dump never reaches the person (the generic line instead),
 * our own sentences are translated.
 */
async function failReasonOf(log: unknown): Promise<string | null> {
  const attempts = Array.isArray(log) ? (log as AttemptLog[]) : [];
  const detail = [...attempts]
    .reverse()
    .flatMap((a) => [...(Array.isArray(a?.steps) ? a.steps : [])].reverse())
    .map((step) => (typeof step?.detail === "string" ? step.detail.trim() : ""))
    .find(Boolean);
  if (!detail) return null;
  const { t } = await getServerMessages();
  if (isRawProviderError(detail)) return t.generate.stepFailedGeneric;
  if (isBudgetExhaustedDetail(detail)) return t.generate.stepAllAttemptsUsed;
  return localizeServerText(detail, t);
}

/** The force-refund classes (refund-rules.ts) plus the pipeline's own content gate. */
function wasRefused(log: unknown): boolean {
  const attempts = Array.isArray(log) ? (log as AttemptLog[]) : [];
  return attempts.some((a) => a?.issues?.includes("content_policy")) || forceRefundEligible(attempts);
}

/** The other picture engine for an engine-only refusal, when this person may use it (see LightTake.tryOther). */
async function tryOtherFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  row: { status: unknown; content_type: unknown; model_id: unknown; pipeline_log: unknown },
): Promise<LightTake["tryOther"]> {
  if (row.status !== "failed" || row.content_type !== "image" || !refusedByEngineOnly(row.pipeline_log)) return null;
  // actions.ts's own test for a free account, which it pins to one engine whatever the form asks.
  const { data: p } = await supabase.from("profiles").select("plan, bonus_credits, purchased_credits, role").eq("id", userId).maybeSingle();
  const free = (p?.plan ?? "none") === "none" && (p?.bonus_credits ?? 0) === 0 && (p?.purchased_credits ?? 0) === 0 && p?.role !== "admin";
  if (free) return null;
  const modelId = otherPictureEngine((row.model_id as string | null) ?? null);
  if (!(await offered("picture", modelId))) return null;
  return {
    modelId,
    name: getImageModel(modelId).name,
    credits: imageRenderCreditWeight(modelId, defaultImageResolution(modelId), DEFAULT_IMAGE_QUALITY),
  };
}

/**
 * One of this person's own takes, as the Light chat shows it: what was
 * asked, the finished picture or video, and what it really charged
 * (generations.credits_used: the row's whole charge, of which the purchased
 * and bonus columns are portions; 0 once refunded — never a guess).
 */
export async function getLightTake(id: string): Promise<LightTake | null> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const { data: row } = await supabase
    .from("generations")
    .select("id, prompt_input, content_type, status, result_url, credits_used, free_generation_used, model_id, pipeline_log, created_at")
    .eq("id", id)
    // An admin's SELECT policy reads every row; this chat is only ever yours.
    .eq("user_id", userData.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return null;
  return {
    id: row.id as string,
    prompt: (row.prompt_input as string | null) ?? "",
    contentType: row.content_type === "image" ? "image" : "video",
    status: (row.status as string | null) ?? "",
    resultUrl: toMediaUrl(row.result_url as string | null),
    creditsUsed: (row.credits_used as number | null) ?? 0,
    freeGeneration: row.free_generation_used === true,
    modelId: (row.model_id as string | null) ?? null,
    failReason: row.status === "failed" ? await failReasonOf(row.pipeline_log) : null,
    createdAt: (row.created_at as string | null) ?? null,
    refused: row.status === "failed" && wasRefused(row.pipeline_log),
    tryOther: await tryOtherFor(supabase, userData.user.id, row),
  };
}

/**
 * "Search chats" in Light's rail: this person's own takes whose words match,
 * newest first. Each take is one chat in Light.
 */
export async function searchLightTakes(query: string): Promise<{ id: string; prompt: string }[]> {
  const words = query.trim().slice(0, 80);
  if (!words) return [];
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];
  // ilike's own wildcards and escape are taken literally.
  const pattern = `%${words.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { data } = await supabase
    .from("generations")
    .select("id, prompt_input")
    .eq("user_id", userData.user.id)
    .is("deleted_at", null)
    .ilike("prompt_input", pattern)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []).map((r) => ({ id: r.id as string, prompt: (r.prompt_input as string | null) ?? "" }));
}
