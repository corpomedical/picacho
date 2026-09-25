import { describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "../plans";
import { apiUsageSummary } from "./usage";

// get_usage overstated credits (Press Tour cut 0, 2026-09-25): it added bonus
// into remaining_this_period and counted a lapsed plan's allowance, while
// GET /api/v1/usage and the spend path did neither. These are the REST
// route's rules; lib/mcp/route.test.ts holds the two routes to one answer.

describe("apiUsageSummary", () => {
  it("reports the plan's remainder, and the two balances beside it", () => {
    expect(
      apiUsageSummary(
        "growth",
        { plan_status: "active", bonus_credits: 7, purchased_credits: 20, current_period_start: "2026-09-01T00:00:00Z" },
        100,
      ),
    ).toEqual({
      plan: "growth",
      plan_label: "Growth",
      included_this_period: PLAN_LIMITS.growth,
      used_this_period: 100,
      remaining_this_period: PLAN_LIMITS.growth - 100,
      bonus_credits: 7,
      purchased_credits: 20,
      period_started_at: "2026-09-01T00:00:00Z",
    });
  });

  it("MONEY: bonus credits are never added into the plan's remaining allowance", () => {
    const u = apiUsageSummary("starter", { plan_status: "active", bonus_credits: 50 }, PLAN_LIMITS.starter);
    expect(u.remaining_this_period).toBe(0);
    expect(u.bonus_credits).toBe(50);
  });

  it("MONEY: a lapsed subscription's allowance is paused, as the spend path pauses it", () => {
    for (const lapsed of ["past_due", "canceled", "inactive"]) {
      const u = apiUsageSummary("elite", { plan_status: lapsed, purchased_credits: 4 }, 0);
      expect(u.included_this_period, lapsed).toBe(0);
      expect(u.remaining_this_period, lapsed).toBe(0);
      // Balances still spend while the plan is paused.
      expect(u.purchased_credits, lapsed).toBe(4);
    }
  });

  it("no plan_status passes: comped and pre-Stripe plans never had one", () => {
    expect(apiUsageSummary("studio", { plan_status: null }, 0).included_this_period).toBe(PLAN_LIMITS.studio);
    expect(apiUsageSummary("studio", null, 0).included_this_period).toBe(PLAN_LIMITS.studio);
  });

  it("never reports a negative remainder", () => {
    expect(apiUsageSummary("basic", { plan_status: "active" }, PLAN_LIMITS.basic + 9).remaining_this_period).toBe(0);
  });
});
