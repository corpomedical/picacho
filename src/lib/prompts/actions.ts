"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { latestMonthlyAnniversary } from "@/lib/generations/core";
import { runRealPipeline } from "@/lib/generations/pipeline";
import { describeImageAsPrompt, type DescribeMode } from "@/lib/generations/providers/describe-image";
import { absolutizeMediaUrl } from "@/lib/media/url";
import { getOrigin } from "@/lib/origin";
import type { BrandRule } from "@/lib/brand-rules/types";
import {
  FREE_PROMPT_ASSIST_LIMIT,
  PLAN_LABELS,
  PLAN_PROMPT_ASSIST_LIMITS,
  type PlanId,
} from "@/lib/plans";

// Prompt Studio — the "Enhance" step.
//
// This deliberately does NOT have its own prompt writer. Picacho already
// turns a plain request into an engineered prompt on every generation (the
// draft step in pipeline.ts, with the character rulebook, the brand rules,
// the safety-phrasing hygiene and the trait-repair pass all attached). If
// this feature called a second, different prompt writer, the user would
// approve prompt A here and the pipeline would quietly redraft it into
// prompt B on submit — two brains disagreeing, on the one feature whose
// entire purpose is showing someone what is about to happen.
//
// So it runs the real pipeline with compileOnly, which stops after
// draft → validate → repair and hands back the finished prompt without
// generating anything. What's on screen is byte-for-byte what runs, provided
// the caller submits it with refinement skipped (see the composer).

export type CompilePromptResult =
  | { error: string }
  | { error: null; prompt: string; assistsLeft: number | null };

// Assists are capped rather than charged — see PLAN_PROMPT_ASSIST_LIMITS.
// Returns the number left, or null for "uncapped" (Elite, and admins).
// Also returns the window (`since`, null = lifetime) and `cap` (uncapped = true
// for Elite/admin) so the atomic recordAssist below can re-check the cap and
// insert in one guarded step instead of racing this read.
type AssistAllowance = {
  error?: string;
  remaining: number | null;
  cap: number;
  since: string | null;
  uncapped: boolean;
};

async function assistAllowance(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<AssistAllowance> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, role, status, bonus_credits, current_period_start")
    .eq("id", userId)
    .single();

  if (profile?.status === "suspended") {
    return { error: "This account is suspended.", remaining: 0, cap: 0, since: null, uncapped: false };
  }
  if (profile?.role === "admin") return { remaining: null, cap: -1, since: null, uncapped: true };

  const plan = (profile?.plan ?? "none") as PlanId;
  const isFreeTier = plan === "none" && (profile?.bonus_credits ?? 0) === 0;

  // Free tier: counted for the lifetime of the account, since a trial has no
  // billing anchor to reset against.
  if (isFreeTier) {
    const { count } = await supabase
      .from("prompt_assists")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    const used = count ?? 0;
    if (used >= FREE_PROMPT_ASSIST_LIMIT) {
      return {
        error:
          `You've used your ${FREE_PROMPT_ASSIST_LIMIT} free prompt assists. ` +
          "Subscribe to a plan for more — writing your own prompt is always free.",
        remaining: 0,
        cap: FREE_PROMPT_ASSIST_LIMIT,
        since: null,
        uncapped: false,
      };
    }
    return { remaining: FREE_PROMPT_ASSIST_LIMIT - used, cap: FREE_PROMPT_ASSIST_LIMIT, since: null, uncapped: false };
  }

  const cap = PLAN_PROMPT_ASSIST_LIMITS[plan];
  if (cap === Number.POSITIVE_INFINITY) return { remaining: null, cap: -1, since: null, uncapped: true };

  // Counted against the account's real billing period so it resets in step
  // with credits; calendar month if Stripe hasn't given us an anchor yet
  // (same fallback as getMonthlyUsage and the reference-photo cap).
  const periodStart = profile?.current_period_start
    // Monthly anniversary, not the raw (possibly year-old) annual period start —
    // otherwise annual subs never get their monthly assist cap back.
    ? latestMonthlyAnniversary(new Date(profile.current_period_start as string))
    : (() => {
        const d = new Date();
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        return d;
      })();
  const since = periodStart.toISOString();

  const { count } = await supabase
    .from("prompt_assists")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);

  const used = count ?? 0;
  if (used >= cap) {
    return {
      error:
        `You've used all ${cap} prompt assists included in the ${PLAN_LABELS[plan]} plan this ` +
        "billing period. Writing your own prompt is always free.",
      remaining: 0,
      cap,
      since,
      uncapped: false,
    };
  }
  return { remaining: cap - used, cap, since, uncapped: false };
}

// Records the assist atomically (see record_prompt_assist): re-checks the cap
// and inserts in one advisory-locked step, so a concurrent burst can't push the
// ledger past the cap. Metered only on success — the callers reach here only
// after a successful compile. Returns assists left (null = uncapped).
async function recordAssist(
  allowance: AssistAllowance,
  userId: string,
  kind: string,
): Promise<number | null> {
  const { data } = await createAdminClient().rpc("record_prompt_assist", {
    p_user_id: userId,
    p_since: allowance.since,
    p_cap: allowance.uncapped ? -1 : allowance.cap,
    p_kind: kind,
  });
  if (allowance.uncapped) return null;
  const rem = typeof data === "number" ? data : 0;
  return rem < 0 ? 0 : rem;
}

async function loadActiveBrandRules(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<BrandRule[]> {
  // Same kill switch the generator honours, so an enhanced prompt can't
  // include rules that enforcement is currently paused for.
  const { data: flag } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("key", "brand_rules_enforcement")
    .single();
  if (!flag?.enabled) return [];

  const { data } = await supabase
    .from("brand_rules")
    .select("id, kind, label, value, applies_to, severity, active")
    .eq("user_id", userId)
    .eq("active", true);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as BrandRule["kind"],
    label: r.label as string,
    value: r.value as string,
    appliesTo: r.applies_to as BrandRule["appliesTo"],
    severity: r.severity as BrandRule["severity"],
    active: r.active as boolean,
  }));
}

const MAX_INPUT_LENGTH = 2000;

export async function compilePrompt(formData: FormData): Promise<CompilePromptResult> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const userInput = String(formData.get("prompt") ?? "").trim();
  const characterId = String(formData.get("character_id") ?? "").trim();
  const contentType = String(formData.get("content_type") ?? "image") === "video" ? "video" : "image";

  if (!userInput) return { error: "Write what you want to create first." };
  if (userInput.length > MAX_INPUT_LENGTH) {
    return { error: `That's longer than ${MAX_INPUT_LENGTH} characters — trim it a little.` };
  }

  const [{ data: studioFlag }, { data: providersFlag }] = await Promise.all([
    supabase.from("feature_flags").select("enabled").eq("key", "prompt_studio").single(),
    supabase.from("feature_flags").select("enabled").eq("key", "real_ai_providers").single(),
  ]);

  if (studioFlag?.enabled !== true) {
    return { error: "Prompt Studio is switched off right now." };
  }
  // The mock pipeline returns a canned string; enhancing against it would
  // teach the user nothing and still burn an assist.
  if (providersFlag?.enabled !== true) {
    return { error: "Real AI providers are off, so there's no model to enhance with yet." };
  }

  const allowance = await assistAllowance(supabase, userData.user.id);
  if (allowance.error) return { error: allowance.error };

  // Character is optional — the pipeline's empty-name placeholder is what
  // tells it "no specific character for this generation".
  const characterQuery = characterId
    ? await supabase
        .from("character_profiles")
        .select("*")
        .eq("id", characterId)
        .eq("user_id", userData.user.id)
        .single()
    : { data: null, error: null };
  const character = characterQuery.data;
  if (characterId && (characterQuery.error || !character)) {
    return { error: "Couldn't find that character." };
  }

  const characterForPipeline = character
    ? {
        name: character.name as string,
        traits: (character.traits ?? {}) as Record<string, string>,
        motion_style: character.motion_style as string | null,
        voice_tone_tags: (character.voice_tone_tags ?? []) as string[],
      }
    : { name: "", traits: {}, motion_style: null, voice_tone_tags: [] };

  const brandRules = await loadActiveBrandRules(supabase, userData.user.id);

  let compiled: string;
  try {
    const result = await runRealPipeline(
      userInput,
      characterForPipeline,
      { contentType, brandRules, compileOnly: true },
      // One attempt: the retry loop exists to react to a FAILED generation,
      // and nothing generates here. A user who doesn't like the wording has
      // a "Try another" button, which is a better use of an assist than a
      // silent second call they didn't ask for.
      1,
    );
    // compileOnly returns only AFTER the trait-validation and brand-rule
    // gates have passed, so an attempt that came back not-passed means the
    // request genuinely couldn't be turned into a compliant prompt. Handing
    // that text over anyway would send the user off to spend a credit on a
    // prompt we already know the generator will block.
    const lastAttempt = result.attempts.at(-1);
    if (lastAttempt && !lastAttempt.passed) {
      return {
        error:
          "That request conflicts with this character's rules or your brand rules — " +
          "rephrase it and try again. No assist was used.",
      };
    }
    compiled = result.finalPrompt?.trim() ?? "";
  } catch (err) {
    console.error("compilePrompt failed", err);
    return { error: "Couldn't enhance that prompt — try again in a moment." };
  }

  if (!compiled) {
    return { error: "Couldn't enhance that prompt — try again in a moment." };
  }

  // Metered only on success, and recorded atomically so a concurrent burst
  // can't slip the ledger past the cap (see record_prompt_assist).
  const assistsLeft = await recordAssist(allowance, userData.user.id, "enhance");

  return { error: null, prompt: compiled, assistsLeft };
}

// Prompt Studio, image mode: an uploaded picture in, a usable prompt out.
//
// The upload plumbing already exists — the composer's "+" button puts the
// file in the chat-attachments bucket and hands back a stable /api/media
// capability URL — so this only has to absolutize that URL (the vision
// provider fetches it over the open internet) and meter the call.
//
// Mode is decided by whether a character is selected, not by the user: with a
// character locked, describing the uploaded person's face would fight the
// identity photo the generator anchors on. See describe-image.ts.
export async function promptFromImage(formData: FormData): Promise<CompilePromptResult> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const rawUrl = String(formData.get("image_url") ?? "").trim();
  const mode: DescribeMode = String(formData.get("mode") ?? "") === "standalone" ? "standalone" : "scene";

  if (!rawUrl) return { error: "Attach an image first." };
  // Only our own media URLs. Without this the action would happily fetch and
  // describe any URL on the internet on the caller's behalf.
  if (!rawUrl.startsWith("/api/media/")) {
    return { error: "That image can't be read — upload it again." };
  }

  const [{ data: studioFlag }, { data: providersFlag }] = await Promise.all([
    supabase.from("feature_flags").select("enabled").eq("key", "prompt_studio").single(),
    supabase.from("feature_flags").select("enabled").eq("key", "real_ai_providers").single(),
  ]);
  if (studioFlag?.enabled !== true) return { error: "Prompt Studio is switched off right now." };
  if (providersFlag?.enabled !== true) {
    return { error: "Real AI providers are off, so there's no model to read the image with yet." };
  }

  const allowance = await assistAllowance(supabase, userData.user.id);
  if (allowance.error) return { error: allowance.error };

  const described = await describeImageAsPrompt(absolutizeMediaUrl(rawUrl, await getOrigin()), mode);
  if (!described) {
    return { error: "Couldn't read that image — try another one, or write the prompt yourself." };
  }

  const assistsLeft = await recordAssist(allowance, userData.user.id, "from_image");

  return { error: null, prompt: described, assistsLeft };
}

// ---------------------------------------------------------------------------
// Saved prompts — the library.
// ---------------------------------------------------------------------------

export type SavedPrompt = {
  id: string;
  prompt: string;
  sourceInput: string | null;
  characterId: string | null;
  contentType: "image" | "video";
  source: "enhance" | "from_image" | "manual";
  createdAt: string;
};

// Generous, but not unbounded: this is a personal library, not storage. At
// 4000 characters a row it also keeps one account from turning the table into
// a dumping ground.
const SAVED_PROMPT_LIMIT = 200;

export async function savePrompt(
  formData: FormData,
): Promise<{ error: string | null; saved?: SavedPrompt }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const prompt = String(formData.get("prompt") ?? "").trim();
  const sourceInput = String(formData.get("source_input") ?? "").trim() || null;
  const characterId = String(formData.get("character_id") ?? "").trim() || null;
  const contentType = String(formData.get("content_type") ?? "image") === "video" ? "video" : "image";
  const rawSource = String(formData.get("source") ?? "enhance");
  const source =
    rawSource === "from_image" || rawSource === "manual" ? rawSource : ("enhance" as const);

  if (!prompt) return { error: "Nothing to save." };
  if (prompt.length > 4000) return { error: "That prompt is too long to save." };

  const { count } = await supabase
    .from("saved_prompts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userData.user.id);

  if ((count ?? 0) >= SAVED_PROMPT_LIMIT) {
    return {
      error: `You've saved ${SAVED_PROMPT_LIMIT} prompts, which is the limit — delete one to make room.`,
    };
  }

  const { data, error } = await supabase
    .from("saved_prompts")
    .insert({
      user_id: userData.user.id,
      prompt,
      source_input: sourceInput,
      character_profile_id: characterId,
      content_type: contentType,
      source,
    })
    .select("id, prompt, source_input, character_profile_id, content_type, source, created_at")
    .single();

  if (error || !data) return { error: "Couldn't save that prompt — try again." };

  return {
    error: null,
    saved: {
      id: data.id as string,
      prompt: data.prompt as string,
      sourceInput: data.source_input as string | null,
      characterId: data.character_profile_id as string | null,
      contentType: data.content_type as "image" | "video",
      source: data.source as SavedPrompt["source"],
      createdAt: data.created_at as string,
    },
  };
}

export async function listSavedPrompts(): Promise<{ error: string | null; prompts: SavedPrompt[] }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again.", prompts: [] };

  const { data, error } = await supabase
    .from("saved_prompts")
    .select("id, prompt, source_input, character_profile_id, content_type, source, created_at")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: false })
    .limit(SAVED_PROMPT_LIMIT);

  if (error) return { error: "Couldn't load your saved prompts.", prompts: [] };

  return {
    error: null,
    prompts: (data ?? []).map((row) => ({
      id: row.id as string,
      prompt: row.prompt as string,
      sourceInput: row.source_input as string | null,
      characterId: row.character_profile_id as string | null,
      contentType: row.content_type as "image" | "video",
      source: row.source as SavedPrompt["source"],
      createdAt: row.created_at as string,
    })),
  };
}

export async function deleteSavedPrompt(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Nothing to delete." };

  // RLS already scopes deletes to the owner; the explicit user_id match is
  // belt-and-braces on a destructive call.
  const { error } = await supabase
    .from("saved_prompts")
    .delete()
    .eq("id", id)
    .eq("user_id", userData.user.id);

  if (error) return { error: "Couldn't delete that prompt — try again." };
  return { error: null };
}

// Records that a prompt was used, so the library can eventually sort by what
// someone actually reaches for. Fire-and-forget: failing to stamp a timestamp
// must never block using the prompt.
export async function touchSavedPrompt(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabase
    .from("saved_prompts")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userData.user.id);
}
