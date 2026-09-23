import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import it_ from "../i18n/messages/it";
import { localizeServerText } from "../i18n/server-text";
import { PLAN_LIMITS } from "../plans";
import { takesCredits } from "../sets/take";

// The allowance check's refusals, in the person's language (2026-09-16).
// A plan's subscriber who could not pay for a send read "That would use 13
// credits …, but you only have 5 left on your Growth plan this month." in
// English whatever their language: the one pattern the translator had
// stopped at "left." — the free trial's wording — and the plan's other
// refusals had none. A Helios take now asks for its still and its clip at
// once, so the take's whole price is what this sentence names.
//
// The sentences are the check's own: checkGenerationAllowance runs here
// with the database stood in for (core.ts imports through "@/", which this
// suite does not resolve, so those imports are given their real modules or
// a stand-in).

let usedCredits = 0;
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ rpc: async () => ({ data: usedCredits, error: null }) }),
}));
vi.mock("@/lib/media/url", () => ({ mediaUrl: () => null }));
vi.mock("@/lib/media/faststart", () => ({ faststartRemux: async () => null }));
vi.mock("@/lib/plans", async () => await import("../plans"));
vi.mock("@/lib/generations/providers/video-models", async () => await import("./providers/video-models"));

import { checkGenerationAllowance } from "./core";

type Profile = { plan: string; plan_status?: string | null; bonus_credits?: number; purchased_credits?: number };

/** The person's own client, as far as the check reads it: their profile, and their last generation (none). */
function asPerson(profile: Profile): SupabaseClient {
  return {
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: async () => ({ data: [], error: null }),
        single: async () => {
          expect(table).toBe("profiles");
          return {
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
          };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

async function refusal(profile: Profile, used: number, credits: number): Promise<string> {
  usedCredits = used;
  const out = await checkGenerationAllowance(asPerson(profile), "u1", credits, { skipCooldown: true });
  if (!out.error) throw new Error("the check let it through");
  return out.error;
}

const LOCALES = { es, pt, it: it_ };

/** Translated in every language, carrying the numbers and the plan's name as the English does. */
function expectTranslated(wire: string, keep: string[]) {
  expect(localizeServerText(wire, en)).toBe(wire);
  for (const [lang, t] of Object.entries(LOCALES)) {
    const said = localizeServerText(wire, t);
    expect(said, `${lang}: ${wire}`).not.toBe(wire);
    expect(said, lang).not.toMatch(/\{\w+\}/);
    for (const piece of keep) expect(said, `${lang} keeps ${piece}`).toContain(piece);
  }
}

beforeEach(() => {
  usedCredits = 0;
});

describe("the allowance check's refusals, translated", () => {
  it("a take's whole price, more than the plan has left", async () => {
    const veoTake = takesCredits("veo", { clips: 1, stills: 1 });
    const wire = await refusal({ plan: "growth" }, PLAN_LIMITS.growth - 5, veoTake);
    expect(wire).toBe(`That would use ${veoTake} credits (some models cost more than 1 per video), but you only have 5 left on your Growth plan this month.`);
    expectTranslated(wire, [String(veoTake), "5", "Growth"]);
  });

  it("a plan used up", async () => {
    const wire = await refusal({ plan: "studio" }, PLAN_LIMITS.studio, 1);
    expect(wire).toBe(`You've used all ${PLAN_LIMITS.studio} credits included in your Studio plan this month.`);
    expectTranslated(wire, [String(PLAN_LIMITS.studio), "Studio"]);
  });

  it("credits given without a plan: too few left, or none", async () => {
    // Bonus credits DEPLETE as they are spent (2026-09-23), so the fixtures
    // carry the balance that is actually left rather than the whole grant:
    // an account given 10 that has spent 8 reads bonus_credits 2, and one
    // that has spent all ten reads 0. Both sentences are unchanged — with no
    // plan, "all N you've been given" is what was spent plus what is left.
    const short = await refusal({ plan: "none", bonus_credits: 2 }, 8, 3);
    expect(short).toBe("That would use 3 credits (some models cost more than 1 per video), but you only have 2 left this month.");
    expectTranslated(short, ["3", "2"]);
    const none = await refusal({ plan: "none", bonus_credits: 1 }, 9, 2);
    expect(none).toBe("That would use 2 credits (some models cost more than 1 per video), but you only have 1 left this month.");
    expectTranslated(none, ["2", "1"]);
  });

  it("a grant spent to nothing falls back to the daily free tier", async () => {
    // Worth pinning, because it is the one behaviour the depletion fix
    // changed that nobody asked for. A granted no-plan account used to sit
    // outside the free tier forever (onDailyFreeTier skips anyone holding
    // bonus credits) and was handed the grant again every billing period.
    // Now the balance runs out, the account reads exactly like any other
    // account with no plan, and it gets the ordinary one-render-a-day trial
    // rather than a refusal — the grant does not come back, but the free
    // tier they were always entitled to does.
    usedCredits = 10;
    const out = await checkGenerationAllowance(
      asPerson({ plan: "none", bonus_credits: 0 }),
      "u1",
      1,
    );
    expect(out.error).toBeNull();
    expect(out.consumeFree).toBe(true);
    expect(out.consumeBonus ?? 0).toBe(0);
  });

  it("a plan whose payment failed, or that has ended", async () => {
    const failed = await refusal({ plan: "growth", plan_status: "past_due" }, 0, 1);
    expect(failed).toMatch(/^Your last payment for the Growth plan failed/);
    expectTranslated(failed, ["Growth"]);
    const ended = await refusal({ plan: "elite", plan_status: "canceled" }, 0, 1);
    expect(ended).toMatch(/^Your Elite plan isn't active anymore/);
    expectTranslated(ended, ["Elite"]);
  });

  it("purchased credits still cover what the plan cannot", async () => {
    usedCredits = PLAN_LIMITS.growth - 5;
    const out = await checkGenerationAllowance(asPerson({ plan: "growth", purchased_credits: 8 }), "u1", 13, { skipCooldown: true });
    expect(out.error).toBeNull();
    expect(out.consumePurchased).toBe(8);
  });

  it("leaves the free trial's own sentence as it was translated", () => {
    const wire = "That would use 3 credits (some models cost more than 1 per video), but you only have 1 left. Top up or pick a plan to keep going.";
    expect(localizeServerText(wire, es)).toBe(es.serverText.insufficientDetail.replace("{need}", "3").replace("{have}", "1"));
  });
});
