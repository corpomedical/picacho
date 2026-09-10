import { createAdminClient } from "@/lib/supabase/server";
import { getMonthlyUsageWith, monthlyWindowStart } from "@/lib/generations/core";
import { PLAN_LIMITS, type PlanId } from "@/lib/plans";
import { notifyUser } from "@/lib/push/send";

// The low-balance alert (settings survey, 2026-09-11): running dry used to
// be discovered only at the moment of refusal. After a successful render,
// if what remains has crossed the line, one push says so — once per monthly
// allowance window, so a person finishing ten renders at 3 credits is not
// told ten times.
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

    // Once per MONTHLY WINDOW — the same window the usage sum counts from.
    // The raw period anchor is the yearly renewal on an annual plan, which
    // allowed one alert a year (2026-09-11 review).
    const since = monthlyWindowStart(profile.current_period_start as string | null).toISOString();

    // Claim the alert atomically: only the call that moves the stamp into
    // this window sends it. Two renders finishing together (a multi-angle
    // batch, each angle its own webhook) used to both read "not yet" and
    // both send.
    const { data: claimed } = await admin
      .from("profiles")
      .update({ low_credit_notified_at: new Date().toISOString() })
      .eq("id", userId)
      // Quoted: the ISO timestamp carries dots and colons.
      .or(`low_credit_notified_at.is.null,low_credit_notified_at.lt."${since}"`)
      .select("id");
    if (!claimed?.length) return;

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
