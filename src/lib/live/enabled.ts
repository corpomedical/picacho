import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_LIMITS } from "../plans";

// Whether Live exists, at three levels — the recast/enabled.ts shape: an env
// kill switch, the provider key it cannot run without, and its own
// feature_flags row (`live`, inserted ON by supabase/pending/live.sql).
export async function isLiveEnabled(supabase: SupabaseClient): Promise<boolean> {
  if (process.env.LIVE_DISABLED === "1") return false;
  if (!process.env.FAL_KEY) return false;
  return flagOn(supabase, "live");
}

// WHO, and why it is a second switch (operator, 2026-09-24). He first chose
// "Paid plans now"; the review then found what no code can close: a live
// take's words and opening picture travel from the browser straight to fal's
// runner, so a determined person can skip our words check and fal's own
// filter is the only guard. Told that, he chose "Admins first": admins until
// one paid take shows fal refusing what it should, then this switch
// (`live_paid_plans`, inserted OFF) opens it to every paid plan.
export async function isLiveOpenToPlans(supabase: SupabaseClient): Promise<boolean> {
  return flagOn(supabase, "live_paid_plans");
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

export const LIVE_NEEDS_PLAN = "Live is part of every paid plan — pick one under Settings → Plan & billing.";
export const LIVE_NOT_OPEN = "Live isn't open to your account yet.";
export const LIVE_SUSPENDED = "This account is suspended.";
export const LIVE_UNAVAILABLE = "Live is switched off for the moment.";

/**
 * Who may use Live: admins always; with `live_paid_plans` on, any plan with a
 * monthly allowance — Basic through Elite. Credits do the rest of the gating:
 * a take is paid for up front, so a plan with too few left is refused by the
 * allowance check, not here.
 */
export function liveAllowed(
  profile: { plan?: unknown; role?: unknown; status?: unknown } | null | undefined,
  openToPlans: boolean,
): { error: string | null; code: "suspended" | "notOpen" | "needsPlan" | null; isAdmin: boolean } {
  if (profile?.status === "suspended") return { error: LIVE_SUSPENDED, code: "suspended", isAdmin: false };
  const isAdmin = profile?.role === "admin";
  if (isAdmin) return { error: null, code: null, isAdmin };
  if (!openToPlans) return { error: LIVE_NOT_OPEN, code: "notOpen", isAdmin };
  const plan = typeof profile?.plan === "string" ? profile.plan : "none";
  const limit = (PLAN_LIMITS as Record<string, number>)[plan] ?? 0;
  return limit > 0 ? { error: null, code: null, isAdmin } : { error: LIVE_NEEDS_PLAN, code: "needsPlan", isAdmin };
}
