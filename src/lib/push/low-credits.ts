import { createAdminClient } from "@/lib/supabase/server";
import { getMonthlyUsageWith } from "@/lib/generations/core";
import { PLAN_LIMITS, type PlanId } from "@/lib/plans";
import { notifyUser } from "@/lib/push/send";

// The low-balance alert (settings survey, 2026-09-11): running dry used to
// be discovered only at the moment of refusal. After a successful render,
// if what remains has crossed the line, one push says so — once per billing
// period, so a person finishing ten renders at 3 credits is not told ten
// times.
//
// Strictly best-effort, same contract as every notification: this runs on
// the paths that record paid work, and must never be able to break them.
// Arithmetic mirrors checkGenerationAllowance (core.ts): plan allowance
// only while plan_status is null/active, bonus stacks, purchased rides on
// top. Fires only when the account HAS an allowance to run down — a
// plan-less account living on the daily free render is not "low", it is on
// the free tier, and nagging it would be an upsell dressed as an alert.

const THRESHOLD = 5;

export async function maybeNotifyLowCredits(userId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select(
        "plan, plan_status, bonus_credits, purchased_credits, current_period_start, low_credit_notified_at, notify_low_credits",
      )
      .eq("id", userId)
      .maybeSingle();
    if (!profile) return;
    if (profile.notify_low_credits === false) return;

    const plan = (profile.plan ?? "none") as PlanId;
    const planStatus = (profile.plan_status ?? null) as string | null;
    const planAllowanceActive = planStatus === null || planStatus === "active";
    const limit = (planAllowanceActive ? (PLAN_LIMITS[plan] ?? 0) : 0) + (profile.bonus_credits ?? 0);
    if (limit <= 0 && (profile.purchased_credits ?? 0) <= 0) return;

    const used = await getMonthlyUsageWith(admin, userId, profile.current_period_start as string | null);
    const remaining = Math.max(0, limit - used) + ((profile.purchased_credits ?? 0) as number);
    if (remaining > THRESHOLD) return;

    // Once per billing period (or 30 days where no period anchor exists).
    const since = (profile.current_period_start as string | null) ?? new Date(Date.now() - 30 * 86400_000).toISOString();
    const last = profile.low_credit_notified_at as string | null;
    if (last && last >= since) return;

    await admin
      .from("profiles")
      .update({ low_credit_notified_at: new Date().toISOString() })
      .eq("id", userId);
    await notifyUser(userId, {
      message: { key: "lowCredits", params: { n: remaining } },
      path: "/app/settings?tab=usage",
    });
  } catch (err) {
    // Missing columns before the pending SQL runs land here too — silent,
    // exactly as if the feature did not exist yet.
    console.warn("[low-credits] skipped:", err instanceof Error ? err.message : err);
  }
}
