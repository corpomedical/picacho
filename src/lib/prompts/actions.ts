"use server";

import { createClient } from "@/lib/supabase/server";
import { runRealPipeline } from "@/lib/generations/pipeline";
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
async function assistAllowance(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ error?: string; remaining: number | null }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, role, status, bonus_credits, current_period_start")
    .eq("id", userId)
    .single();

  if (profile?.status === "suspended") {
    return { error: "This account is suspended.", remaining: 0 };
  }
  if (profile?.role === "admin") return { remaining: null };

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
      };
    }
    return { remaining: FREE_PROMPT_ASSIST_LIMIT - used };
  }

  const cap = PLAN_PROMPT_ASSIST_LIMITS[plan];
  if (cap === Number.POSITIVE_INFINITY) return { remaining: null };

  // Counted against the account's real billing period so it resets in step
  // with credits; calendar month if Stripe hasn't given us an anchor yet
  // (same fallback as getMonthlyUsage and the reference-photo cap).
  const periodStart = profile?.current_period_start
    ? new Date(profile.current_period_start as string)
    : (() => {
        const d = new Date();
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        return d;
      })();

  const { count } = await supabase
    .from("prompt_assists")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", periodStart.toISOString());

  const used = count ?? 0;
  if (used >= cap) {
    return {
      error:
        `You've used all ${cap} prompt assists included in the ${PLAN_LABELS[plan]} plan this ` +
        "billing period. Writing your own prompt is always free.",
      remaining: 0,
    };
  }
  return { remaining: cap - used };
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
    ? await supabase.from("character_profiles").select("*").eq("id", characterId).single()
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

  // Metered only on success. A failed assist charging the user for nothing is
  // the kind of small unfairness that makes a feature feel hostile.
  const { error: ledgerError } = await supabase
    .from("prompt_assists")
    .insert({ user_id: userData.user.id, kind: "enhance" });
  if (ledgerError) console.error("prompt_assists insert failed", ledgerError);

  return {
    error: null,
    prompt: compiled,
    assistsLeft: allowance.remaining === null ? null : Math.max(0, allowance.remaining - 1),
  };
}
