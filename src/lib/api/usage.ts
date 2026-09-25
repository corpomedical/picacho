// Relative import on purpose: the test loads this module, and vitest has no
// "@/" alias configured (the repo's standing gotcha).
import { PLAN_LABELS, PLAN_LIMITS, type PlanId } from "../plans";

// What an API caller has left to spend, in the exact shape and by the exact
// rules of GET /api/v1/usage.
//
// The MCP server's get_usage had its own copy, and it overstated the balance
// twice (Press Tour cut 0, 2026-09-25): it added bonus_credits into
// remaining_this_period, and it reported the plan's full allowance for a
// subscription whose payment had lapsed. The spend path
// (checkGenerationAllowance) refuses both, so an agent that checked its
// budget first was told it had credits the next call would be refused for.
// An agent and a script asking the same question must get the same answer,
// so both rules live here, with the REST route's reasons:
//
// - The plan portion is zero while plan_status says the subscription lapsed.
//   NULL passes: comped plans and pre-Stripe accounts never had one.
// - Bonus credits are a depleting BALANCE since 2026-09-23, reported beside
//   purchased credits, never inside the plan's remaining allowance.

export type UsageProfile = {
  plan_status?: string | null;
  bonus_credits?: number | null;
  purchased_credits?: number | null;
  current_period_start?: string | null;
} | null;

export type ApiUsage = {
  plan: PlanId;
  plan_label: string;
  included_this_period: number;
  used_this_period: number;
  remaining_this_period: number;
  bonus_credits: number;
  purchased_credits: number;
  period_started_at: string | null;
};

export function apiUsageSummary(plan: PlanId, profile: UsageProfile, usedThisPeriod: number): ApiUsage {
  const planStatus = profile?.plan_status ?? null;
  const planAllowanceActive = planStatus === null || planStatus === "active";
  const included = planAllowanceActive ? (PLAN_LIMITS[plan] ?? 0) : 0;
  return {
    plan,
    plan_label: PLAN_LABELS[plan] ?? plan,
    included_this_period: included,
    used_this_period: usedThisPeriod,
    remaining_this_period: Math.max(0, included - usedThisPeriod),
    bonus_credits: profile?.bonus_credits ?? 0,
    purchased_credits: profile?.purchased_credits ?? 0,
    period_started_at: profile?.current_period_start ?? null,
  };
}
