import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_LIMITS, planInGoodStanding } from "../plans";

// Whether the video editor is on — the recast/enabled.ts shape: an env kill
// switch, what it cannot run without (the Managed Agent that edits, created by
// scripts/directors-cut-setup.mts in the workspace of
// DIRECTORS_CUT_ANTHROPIC_API_KEY, else of ANTHROPIC_API_KEY — see
// agent.ts editorApiKey; Whisper listens on our OpenAI key), and its own
// feature_flags row (`video_editor`,
// supabase/applied/2026-09-25/video-editor.sql). HeyGen is no longer needed:
// the agent renders in its own sandbox (v2, 2026-09-25).
//
// WHO (operator, 2026-10-03, when the Director's Cut ad went out): admins,
// and every paid plan in good standing once `video_editor_paid_plans` is on
// (inserted ON by supabase/pending/directors-cut-plans.sql) — Live's rule.
// Credits do the rest: a cut or a change holds its price before Opus starts
// (charge.ts, pricing.ts), so a plan with too few left is refused there.
// Someone with no paid plan still finds the page, which says it is part of
// every paid plan (his pick: "Page with upgrade prompt").
//
// Effects shares the `video_editor` switch but stays admins-only (his pick
// the same day: "Keep Effects admins-only") — effectsAllowed.
export async function isEditorEnabled(supabase: SupabaseClient): Promise<boolean> {
  if (process.env.VIDEO_EDITOR_DISABLED === "1") return false;
  if (!(process.env.DIRECTORS_CUT_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY) || !process.env.OPENAI_API_KEY) return false;
  if (!process.env.DIRECTORS_CUT_AGENT_ID || !process.env.DIRECTORS_CUT_ENVIRONMENT_ID) return false;
  return flagOn(supabase, "video_editor");
}

/** Director's Cut for paying customers — its own switch under `video_editor`. */
export async function isEditorOpenToPlans(supabase: SupabaseClient): Promise<boolean> {
  return flagOn(supabase, "video_editor_paid_plans");
}

async function flagOn(supabase: SupabaseClient, key: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("feature_flags")
      .select("enabled")
      .eq("key", key)
      .maybeSingle<{ enabled: boolean }>();
    if (error || !data) return false;
    return data.enabled === true;
  } catch {
    return false;
  }
}

export const EDITOR_NOT_OPEN = "The video editor isn't open to your account yet.";
export const EDITOR_UNAVAILABLE = "The video editor is switched off for the moment.";
export const EDITOR_NEEDS_PLAN = "Director's Cut is part of every paid plan — pick one under Settings → Plan & billing.";
export const EDITOR_SUSPENDED = "This account is suspended.";

export type EditorGate = { error: string | null; code: "suspended" | "notOpen" | "needsPlan" | null; isAdmin: boolean };

/**
 * Who may use Director's Cut: admins always; with `video_editor_paid_plans`
 * on, any plan with a monthly allowance (Basic through Elite) whose payments
 * are in good standing. A suspended account never.
 */
export function editorGate(
  profile: { plan?: unknown; role?: unknown; status?: unknown; plan_status?: unknown } | null | undefined,
  openToPlans: boolean,
): EditorGate {
  if (profile?.status === "suspended") return { error: EDITOR_SUSPENDED, code: "suspended", isAdmin: false };
  const isAdmin = profile?.role === "admin";
  if (isAdmin) return { error: null, code: null, isAdmin };
  if (!openToPlans) return { error: EDITOR_NOT_OPEN, code: "notOpen", isAdmin };
  const plan = typeof profile?.plan === "string" ? profile.plan : "none";
  const limit = (PLAN_LIMITS as Record<string, number>)[plan] ?? 0;
  return limit > 0 && planInGoodStanding(profile?.plan_status)
    ? { error: null, code: null, isAdmin }
    : { error: EDITOR_NEEDS_PLAN, code: "needsPlan", isAdmin };
}

/** Effects: admins only, and never a suspended account. */
export function effectsAllowed(profile: { role?: unknown; status?: unknown } | null | undefined): boolean {
  return profile?.status !== "suspended" && profile?.role === "admin";
}
