import { describe, expect, it } from "vitest";
import {
  costOfTurnUsd,
  unitsForTurn,
  isAgentMode,
  AGENT_UNIT_USD,
  MAX_UNITS_PER_TURN,
  OPUS_5_INPUT_PER_MTOK,
  OPUS_5_OUTPUT_PER_MTOK,
} from "./prices";
import { PLAN_CHAT_UNIT_LIMITS, FREE_CHAT_UNIT_LIMIT } from "../plans";
import { PRICING_TIERS } from "../pricing";

// These are the numbers that decide what a chat turn takes off someone's
// monthly allowance, so they get tested the same way refund-rules.ts does:
// alias-free module, arithmetic checked against hand-computed values rather
// than against itself.

describe("costOfTurnUsd", () => {
  it("prices fresh input and output at the published rates", () => {
    // 1M fresh input + 1M output = $5 + $25.
    const cost = costOfTurnUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000 });
    expect(cost).toBeCloseTo(OPUS_5_INPUT_PER_MTOK + OPUS_5_OUTPUT_PER_MTOK, 6);
  });

  it("bills a cache read at a tenth of fresh input", () => {
    const fresh = costOfTurnUsd({ input_tokens: 100_000 });
    const cached = costOfTurnUsd({ cache_read_input_tokens: 100_000 });
    expect(cached).toBeCloseTo(fresh / 10, 9);
  });

  it("bills a cache write above fresh input", () => {
    const fresh = costOfTurnUsd({ input_tokens: 100_000 });
    const written = costOfTurnUsd({ cache_creation_input_tokens: 100_000 });
    expect(written).toBeCloseTo(fresh * 1.25, 9);
  });

  it("treats missing usage fields as zero rather than NaN", () => {
    // The API omits cache fields entirely on an uncached turn. NaN here would
    // propagate into unitsForTurn and silently charge nothing.
    expect(costOfTurnUsd({})).toBe(0);
    expect(Number.isNaN(costOfTurnUsd({ input_tokens: null, output_tokens: null }))).toBe(false);
  });
});

describe("unitsForTurn", () => {
  it("never charges zero for a turn that reached the model", () => {
    expect(unitsForTurn({ output_tokens: 1 })).toBe(1);
    expect(unitsForTurn({})).toBe(1);
  });

  it("rounds up, so a partial unit is never given away", () => {
    // Exactly one unit's worth of cost plus a token must cost two.
    const tokensForOneUnit = AGENT_UNIT_USD / (OPUS_5_OUTPUT_PER_MTOK / 1_000_000);
    expect(unitsForTurn({ output_tokens: tokensForOneUnit })).toBe(1);
    expect(unitsForTurn({ output_tokens: tokensForOneUnit + 1 })).toBe(2);
  });

  it("charges a realistic cached Faster turn a small number of units", () => {
    // A typical second-or-later turn: most input read from cache, a short
    // answer. If this ever creeps up, the plan allowances are wrong.
    const units = unitsForTurn({
      input_tokens: 400,
      cache_read_input_tokens: 3_000,
      output_tokens: 300,
    });
    expect(units).toBeGreaterThanOrEqual(1);
    expect(units).toBeLessThanOrEqual(MAX_UNITS_PER_TURN.faster);
  });
});

describe("the reservation ceilings", () => {
  it("covers the most a turn of that mode can actually cost", () => {
    // The route reserves MAX_UNITS_PER_TURN[mode] before the call and
    // settles afterwards. A ceiling below the real worst case means a turn
    // can overrun someone's allowance; these assert it covers the arithmetic
    // written above the constant.
    const worstInput = { cache_creation_input_tokens: 9_500 };
    const faster = unitsForTurn({ ...worstInput, output_tokens: 1_500 });
    const smarter = unitsForTurn({ ...worstInput, output_tokens: 4_000 });
    expect(faster).toBeLessThanOrEqual(MAX_UNITS_PER_TURN.faster);
    expect(smarter).toBeLessThanOrEqual(MAX_UNITS_PER_TURN.smarter);
  });

  it("costs more to think harder", () => {
    expect(MAX_UNITS_PER_TURN.smarter).toBeGreaterThan(MAX_UNITS_PER_TURN.faster);
  });
});

describe("isAgentMode", () => {
  it("accepts only the two real modes", () => {
    expect(isAgentMode("faster")).toBe(true);
    expect(isAgentMode("smarter")).toBe(true);
    // The mode arrives from the request body, so anything else must fall
    // through to the default rather than reaching the API as-is.
    expect(isAgentMode("smartest")).toBe(false);
    expect(isAgentMode(undefined)).toBe(false);
    expect(isAgentMode(null)).toBe(false);
    expect(isAgentMode({ mode: "smarter" })).toBe(false);
  });
});

describe("the allowances buy a usable number of questions", () => {
  // The regression this exists for: the first version of the meter inserted
  // a reservation row AND a separate usage row, so every turn was charged
  // the worst case PLUS its real cost. The free tier's 25 units bought
  // exactly one question, and nothing failed loudly — it just said "You've
  // used the free chat allowance" on the second one.
  //
  // A cached Faster turn (the common case from turn two onward) is what a
  // conversation is actually made of, so that is what gets counted here.
  const cachedFasterTurn = {
    input_tokens: 400,
    cache_read_input_tokens: 4_000,
    output_tokens: 350,
  };

  it("gives a free account enough turns to hold a conversation", () => {
    const perTurn = unitsForTurn(cachedFasterTurn);
    expect(FREE_CHAT_UNIT_LIMIT / perTurn).toBeGreaterThanOrEqual(10);
  });

  it("gives every paid plan more than the free tier", () => {
    for (const plan of ["basic", "starter", "growth", "studio", "elite"] as const) {
      expect(PLAN_CHAT_UNIT_LIMITS[plan]).toBeGreaterThan(FREE_CHAT_UNIT_LIMIT);
    }
  });

  it("lets every paid plan start at least one Smarter turn", () => {
    // A plan whose whole allowance is under one reservation can never use
    // the Smarter switch at all — the reservation would be refused on turn
    // one, with a message about the allowance being spent.
    for (const plan of ["basic", "starter", "growth", "studio", "elite"] as const) {
      expect(PLAN_CHAT_UNIT_LIMITS[plan]).toBeGreaterThan(MAX_UNITS_PER_TURN.smarter);
    }
  });

  it("keeps the worst-case spend near a tenth of each plan price", () => {
    // Prices come from PRICING_TIERS rather than a copy, so a repricing
    // (Elite moved twice this month) fails this test instead of silently
    // leaving one tier with three times the chat budget of its neighbours.
    for (const tier of PRICING_TIERS) {
      const cap = PLAN_CHAT_UNIT_LIMITS[tier.id];
      const share = (cap * AGENT_UNIT_USD) / tier.price;
      // Named in the failure message so a break says WHICH tier drifted.
      expect([tier.id, share > 0.08 && share < 0.12]).toEqual([tier.id, true]);
    }
  });
});
