"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { toMediaUrl } from "@/lib/media/url";
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
};

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
    .select("id, prompt_input, content_type, status, result_url, credits_used, free_generation_used, model_id")
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
