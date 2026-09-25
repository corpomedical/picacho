import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_LIMITS, spendableCredits } from "../plans";

// Bonus credits are a DEPLETING BALANCE (2026-09-23).
//
// THE LEAK THIS PINS. checkGenerationAllowance used to compute the monthly
// ceiling as PLAN_LIMITS[plan] + bonus_credits, while usage was counted from
// current_period_start. The usage window resets every billing period; the
// column never did — so a one-time grant of N credits quietly granted N
// credits EVERY MONTH, for the life of the account, and the only way to stop
// it was to remember to zero the column by hand. core.ts stated the asymmetry
// in a comment beside the purchased spend without it reading as a bug:
// "They deplete, unlike bonus_credits."
//
// These tests hold the two properties the fix has to keep: bonus never widens
// the renewing monthly ceiling, and it is drawn down like purchased credits.

let usedCredits = 0;
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ rpc: async () => ({ data: usedCredits, error: null }) }),
}));
vi.mock("@/lib/media/url", () => ({ mediaUrl: () => null }));
vi.mock("@/lib/media/faststart", () => ({ faststartRemux: async () => null }));
vi.mock("@/lib/media/mp4-join", () => ({ withoutSoundMp4: () => ({ ok: false, reason: "unreadable" }) }));
vi.mock("@/lib/plans", async () => await import("../plans"));
vi.mock("@/lib/generations/providers/video-models", async () => await import("./providers/video-models"));

import { checkGenerationAllowance } from "./core";

type Profile = {
  plan: string;
  plan_status?: string | null;
  role?: string;
  bonus_credits?: number;
  purchased_credits?: number;
};

function asPerson(profile: Profile): SupabaseClient {
  return {
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: async () => ({ data: [], error: null }),
        single: async () => ({
          data: {
            role: "user",
            status: "active",
            plan_status: "active",
            bonus_credits: 0,
            purchased_credits: 0,
            free_generation_last_at: null,
            current_period_start: null,
            ...profile,
          },
          error: null,
        }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const ask = (profile: Profile, used: number, credits: number) => {
  usedCredits = used;
  return checkGenerationAllowance(asPerson(profile), "u1", credits, { skipCooldown: true });
};

describe("bonus credits are a balance, not a wider monthly allowance", () => {
  it("REGRESSION: the renewing ceiling is the PLAN's alone", async () => {
    // The leak in one assertion. Starter grants 30; a 30-credit bonus used to
    // make monthlyLimit 60, and 60 came back every period. The reserving RPC
    // re-checks against this exact number under its lock, so a wrong value
    // here is the leak itself, not a display bug.
    const out = await ask({ plan: "starter", bonus_credits: 30 }, 0, 1);
    expect(out.error).toBeNull();
    expect(out.monthlyLimit).toBe(PLAN_LIMITS.starter);
    expect(out.monthlyLimit).not.toBe(PLAN_LIMITS.starter + 30);
  });

  it("spends the plan first, and touches no balance while the plan covers it", async () => {
    const out = await ask({ plan: "starter", bonus_credits: 30, purchased_credits: 10 }, 0, 5);
    expect(out.error).toBeNull();
    expect(out.consumeBonus ?? 0).toBe(0);
    expect(out.consumePurchased ?? 0).toBe(0);
  });

  it("spends the gift before the money once the plan is exhausted", async () => {
    // Bonus first, purchased second: the pack was paid for, the grant was not.
    const out = await ask(
      { plan: "starter", bonus_credits: 4, purchased_credits: 10 },
      PLAN_LIMITS.starter,
      6,
    );
    expect(out.error).toBeNull();
    expect(out.consumeBonus).toBe(4);
    expect(out.consumePurchased).toBe(2);
  });

  it("charges only the part the plan cannot cover, not the whole request", async () => {
    // Straddling the line: 2 of the 5 fit inside the plan, 3 overflow.
    const out = await ask({ plan: "starter", bonus_credits: 30 }, PLAN_LIMITS.starter - 2, 5);
    expect(out.error).toBeNull();
    expect(out.consumeBonus).toBe(3);
  });

  it("does not re-charge the overspend on every later send", async () => {
    // `used` already sits past the plan line because earlier sends drew on
    // the balances. A second send must cost its own credits only.
    const out = await ask({ plan: "starter", bonus_credits: 30 }, PLAN_LIMITS.starter + 10, 2);
    expect(out.error).toBeNull();
    expect(out.consumeBonus).toBe(2);
  });

  it("STOPS when the balance runs out, instead of reaching next month's grant", async () => {
    // The operator's requirement in one test: the limit is reached, and it
    // stays reached until someone grants more.
    const out = await ask({ plan: "starter", bonus_credits: 3 }, PLAN_LIMITS.starter, 4);
    expect(out.error).toBeTruthy();
    expect(out.error).toContain("3 left");
    expect(out.consumeBonus ?? 0).toBe(0);
  });

  it("a lapsed subscription can still spend its bonus, but gets no plan credits", async () => {
    // plan_status gates the PLAN portion only — a grant is not a payment that
    // failed, so it stays spendable (same rule as purchased credits).
    const out = await ask({ plan: "growth", plan_status: "past_due", bonus_credits: 5 }, 0, 3);
    expect(out.error).toBeNull();
    expect(out.monthlyLimit).toBe(0);
    expect(out.consumeBonus).toBe(3);
  });

  it("an admin is still uncapped and spends nothing", async () => {
    const out = await ask({ plan: "none", role: "admin", bonus_credits: 2 }, 9999, 50);
    expect(out.error).toBeNull();
    expect(out.consumeBonus ?? 0).toBe(0);
  });
});

describe("the balance the composer shows is the balance the gate spends", () => {
  // The composer's creditsAvailable (and the header, dashboard and low-credit
  // push beside it) is spendableCredits; truth-contracts.test.ts pins that
  // they call it. This pins spendableCredits against the GATE ITSELF: it must
  // be exactly the largest request checkGenerationAllowance accepts. One
  // credit more is refused, and the refusal quotes the same number.
  const cases: { name: string; profile: Profile; used: number; expected: number }[] = [
    {
      // Live 2026-09-25: header 35, composer banner "you have 5 — Add 20
      // credits" over an 11-credit Seedance send the server then accepted.
      name: "REGRESSION: Starter with 5 plan credits left and a 30-credit grant",
      profile: { plan: "starter", bonus_credits: 30 },
      used: PLAN_LIMITS.starter - 5,
      expected: 35,
    },
    {
      name: "past the plan line: the remainder floors at zero, both balances still count",
      profile: { plan: "starter", bonus_credits: 4, purchased_credits: 3 },
      used: PLAN_LIMITS.starter + 10,
      expected: 7,
    },
    {
      name: "a lapsed subscription: no plan credits, the grant and the pack remain",
      profile: { plan: "growth", plan_status: "past_due", bonus_credits: 5, purchased_credits: 2 },
      used: 0,
      expected: 7,
    },
    {
      name: "a comped reviewer with no plan lives on the grant alone",
      profile: { plan: "none", bonus_credits: 12 },
      used: 3,
      expected: 12,
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const shown = spendableCredits({
        monthlyLimit: c.profile.plan_status ? 0 : PLAN_LIMITS[c.profile.plan as keyof typeof PLAN_LIMITS],
        used: c.used,
        bonus: c.profile.bonus_credits ?? 0,
        purchased: c.profile.purchased_credits ?? 0,
      });
      expect(shown).toBe(c.expected);

      const all = await ask(c.profile, c.used, shown);
      expect(all.error).toBeNull();

      const oneMore = await ask(c.profile, c.used, shown + 1);
      expect(oneMore.error).toBeTruthy();
      // A lapsed plan's refusal names the payment instead of a number.
      if (!c.profile.plan_status) expect(oneMore.error).toContain(`only have ${shown} left`);
    });
  }
});
