import { describe, expect, it } from "vitest";
import { costOfAstraUsageUsd, worstCaseAstraUsd } from "./prices";
import {
  SET_BUILD_INPUT_TOKENS,
  SET_BUILD_MAX_ATTEMPTS,
  SET_BUILD_MAX_OUTPUT_TOKENS,
  SET_CLOSE_RETRY_INPUT_TOKENS,
  SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS,
  SET_BUILDS_MONTHLY_LIMITS,
  SET_EDIT_MAX_CHARS,
  SET_EDIT_MAX_SPEC_CHARS,
  SET_EDIT_SPARE_TRIES,
  SET_EDITS_MONTHLY_LIMITS,
  SET_PHOTO_BUILD_INPUT_TOKENS,
  SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS,
  SET_PHOTO_CLOSE_RETRY_INPUT_TOKENS,
  setEditTriesMonthlyLimit,
  setEditsMonthlyLimit,
} from "../sets/set-config";
import { setEditInput, setEditRequest } from "../sets/set-edit-prompt";
import { normaliseSetSpec } from "../sets/set-spec";
import { PRICING_TIERS } from "../pricing";
import beach from "../sets/fixtures-beach.json";
import raceTrack from "../sets/fixtures-race-track.json";
import rainyMarket from "../sets/fixtures-rainy-market.json";
import showroomClosed from "../sets/fixtures-showroom-closed.json";
import showroomOpen from "../sets/fixtures-showroom-open.json";

// Every figure here is a usage block the API really returned on Picacho's
// key, with the cost worked by hand from the dated prices.

describe("costOfAstraUsageUsd", () => {
  it("the first set build (2026-09-10): 1,626 in, 5,593 out → $0.296", () => {
    // 1,626 × $10/1M + 5,593 × $50/1M = $0.01626 + $0.27965 = $0.29591
    expect(
      costOfAstraUsageUsd({
        input_tokens: 1626,
        input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
        output_tokens: 5593,
        output_tokens_details: { reasoning_tokens: 47 },
      }),
    ).toBeCloseTo(0.29591, 5);
  });

  it("bills cache writes at $12.50 and the rest as plain input (the photo probe, $0.667)", () => {
    // 1,989 × $12.50/1M + 3 × $10/1M + 12,834 × $50/1M = $0.0248625 + $0.00003 + $0.6417
    expect(
      costOfAstraUsageUsd({
        input_tokens: 1992,
        input_tokens_details: { cache_write_tokens: 1989, cached_tokens: 0 },
        output_tokens: 12834,
      }),
    ).toBeCloseTo(0.6665925, 6);
  });

  it("bills cached input at $1", () => {
    expect(
      costOfAstraUsageUsd({ input_tokens: 1000, input_tokens_details: { cached_tokens: 1000 }, output_tokens: 0 }),
    ).toBeCloseTo(0.001, 9);
  });

  it("applies the long-prompt multipliers to the whole request past 272K input", () => {
    // 300,000 × $10 × 2 + 1,000 × $50 × 1.5 = $6.00 + $0.075
    expect(costOfAstraUsageUsd({ input_tokens: 300_000, output_tokens: 1000 })).toBeCloseTo(6.075, 6);
  });

  it("reads a missing or broken usage block as nothing, never NaN", () => {
    expect(costOfAstraUsageUsd(null)).toBe(0);
    expect(costOfAstraUsageUsd({ input_tokens: Number.NaN, output_tokens: -5 })).toBe(0);
  });

  it("never counts a cached token twice when the details overlap", () => {
    const c = costOfAstraUsageUsd({
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 80, cache_write_tokens: 80 },
      output_tokens: 0,
    });
    // 80 cached × $1 + 20 written × $12.50 = $0.00008 + $0.00025
    expect(c).toBeCloseTo(0.00033, 9);
  });
});

describe("the set-build ceiling", () => {
  it("matches the arithmetic in set-config.ts: $0.53 first, $0.625 for a closing retry, $1.155 a build", () => {
    const first = worstCaseAstraUsd(SET_BUILD_INPUT_TOKENS, SET_BUILD_MAX_OUTPUT_TOKENS);
    const closing = worstCaseAstraUsd(SET_CLOSE_RETRY_INPUT_TOKENS, SET_BUILD_MAX_OUTPUT_TOKENS);
    expect(first).toBeCloseTo(0.53, 6);
    expect(closing).toBeCloseTo(0.625, 6);
    expect(SET_BUILD_MAX_ATTEMPTS).toBe(2);
    expect(first + closing).toBeCloseTo(1.155, 6);
  });

  it("bounds the closing retry's input: the set sent back fits the token budget", () => {
    // 2.24 characters per token: conservative for minified JSON.
    const previousTokens = Math.ceil(SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS / 2.24);
    expect(SET_BUILD_INPUT_TOKENS + previousTokens + 200).toBeLessThanOrEqual(SET_CLOSE_RETRY_INPUT_TOKENS);
  });

  it("leaves a mend room to add walls under the same output cap", () => {
    // 0.52 answer tokens per character sent back (a real set: 10,736 → 5,546),
    // plus ~1,500 for added objects and reasoning.
    expect(Math.ceil(SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS * 0.52) + 1_500).toBeLessThanOrEqual(SET_BUILD_MAX_OUTPUT_TOKENS);
  });
});

describe("the photo-build ceiling (Sets from a photo, 2026-09-11)", () => {
  it("matches the arithmetic in set-config.ts: $0.86125 first, $0.95625 for a closing retry, $1.8175 a build", () => {
    // 4,900 × $12.50/1M + 16,000 × $50/1M = $0.06125 + $0.80 (the input
    // grew 100 tokens on 2026-09-15, when the photo rules gained the human
    // ruler).
    const first = worstCaseAstraUsd(SET_PHOTO_BUILD_INPUT_TOKENS, SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS);
    // 12,500 × $12.50/1M + 16,000 × $50/1M = $0.15625 + $0.80
    const closing = worstCaseAstraUsd(SET_PHOTO_CLOSE_RETRY_INPUT_TOKENS, SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS);
    expect(first).toBeCloseTo(0.86125, 6);
    expect(closing).toBeCloseTo(0.95625, 6);
    expect(first + closing).toBeCloseTo(1.8175, 6);
    // Two failure retries resend the photo without a set: less than the closing path.
    expect(2 * first).toBeCloseTo(1.7225, 6);
    expect(2 * first).toBeLessThan(first + closing);
  });

  it("does not cut off the one measured photo build", () => {
    expect(SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS).toBeGreaterThan(12_834);
    expect(SET_BUILD_MAX_OUTPUT_TOKENS).toBeLessThan(12_834);
  });

  it("bounds the closing retry's input: the photo again, the set sent back and the feedback", () => {
    const previousTokens = Math.ceil(SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS / 2.24);
    expect(previousTokens).toBe(7_143);
    expect(SET_PHOTO_BUILD_INPUT_TOKENS + previousTokens + 200).toBeLessThanOrEqual(SET_PHOTO_CLOSE_RETRY_INPUT_TOKENS);
  });

  it("leaves a mend room under the photo cap, with the measured reasoning on top", () => {
    // 8,320 re-emitted + 1,500 added walls + 4,007 reasoning (the one measured run) = 13,827.
    expect(Math.ceil(SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS * 0.52) + 1_500 + 4_007).toBeLessThanOrEqual(
      SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS,
    );
  });

  it("leaves the text-build numbers where they were", () => {
    expect(SET_BUILD_INPUT_TOKENS).toBe(2_400);
    expect(SET_BUILD_MAX_OUTPUT_TOKENS).toBe(10_000);
    expect(SET_CLOSE_RETRY_INPUT_TOKENS).toBe(10_000);
  });
});

// An Astra edit (2026-09-16): a build's call, free to the person, bounded by
// a monthly cap per plan and by the size of the set it may send.
describe("the Astra-edit ceiling", () => {
  // The longest input an edit can send: its instructions, the schema, and a
  // working copy at the bound with the longest request.
  const longestInputChars = () => {
    const req = setEditRequest({} as never, "", undefined);
    // What the input adds around the set and the request.
    const framing = setEditInput({} as never, "").length - JSON.stringify({}).length;
    return req.instructions.length + JSON.stringify(req.schema).length + framing + SET_EDIT_MAX_SPEC_CHARS + SET_EDIT_MAX_CHARS;
  };

  it("matches the arithmetic in set-config.ts: 21,536 characters ≈ 9,615 tokens, $0.62 an edit at worst", () => {
    // 20,855 characters until 2026-09-17, when every object and the ground
    // gained a material word (21,378), then a light gained a size for the
    // area kind (21,536): the schema and the edit's instructions grew.
    expect(longestInputChars()).toBe(21_536);
    const tokens = Math.ceil(longestInputChars() / 2.24);
    expect(tokens).toBe(9_615);
    // 9,615 × $12.50/1M + 10,000 × $50/1M = $0.1201875 + $0.50
    expect(worstCaseAstraUsd(tokens, SET_BUILD_MAX_OUTPUT_TOKENS)).toBeCloseTo(0.6201875, 9);
  });

  it("caps a month at twice the builds, and the figures in set-config.ts are what those caps cost", () => {
    const perEdit = worstCaseAstraUsd(Math.ceil(longestInputChars() / 2.24), SET_BUILD_MAX_OUTPUT_TOKENS);
    const written: Record<string, [number, number]> = {
      basic: [1.24, 9],
      starter: [2.48, 19],
      growth: [6.2, 79],
      studio: [12.4, 299],
      elite: [31.01, 499],
    };
    for (const tier of PRICING_TIERS) {
      const id = tier.id as keyof typeof SET_EDITS_MONTHLY_LIMITS;
      expect(SET_EDITS_MONTHLY_LIMITS[id], id).toBe(2 * SET_BUILDS_MONTHLY_LIMITS[id]);
      expect(Math.round(SET_EDITS_MONTHLY_LIMITS[id] * perEdit * 100) / 100, id).toBe(written[id][0]);
      expect(tier.price, id).toBe(written[id][1]);
    }
    expect(SET_EDITS_MONTHLY_LIMITS.none).toBe(0);
    expect(setEditsMonthlyLimit("growth", true)).toBe(-1);
    expect(setEditsMonthlyLimit("growth", false)).toBe(SET_EDITS_MONTHLY_LIMITS.growth);
    expect(setEditsMonthlyLimit("platinum", false)).toBe(0);
    expect(setEditsMonthlyLimit(null, false)).toBe(0);
  });

  it("allows SET_EDIT_SPARE_TRIES failed tries a month, and the figures in set-config.ts are what they cost at worst", () => {
    // Only saved changes count against the month since 2026-09-25; every
    // try is still billed, so tries are capped at the changes plus 3.
    const perEdit = worstCaseAstraUsd(Math.ceil(longestInputChars() / 2.24), SET_BUILD_MAX_OUTPUT_TOKENS);
    expect(SET_EDIT_SPARE_TRIES).toBe(3);
    const written: Record<string, number> = { basic: 3.1, starter: 4.34, growth: 8.06, studio: 14.26, elite: 32.87 };
    for (const tier of PRICING_TIERS) {
      const id = tier.id as keyof typeof SET_EDITS_MONTHLY_LIMITS;
      const tries = setEditTriesMonthlyLimit(id, false);
      expect(tries, id).toBe(SET_EDITS_MONTHLY_LIMITS[id] + SET_EDIT_SPARE_TRIES);
      expect(Math.round(tries * perEdit * 100) / 100, id).toBe(written[id]);
    }
    // At most $1.86 a person a month more than counting every try.
    expect(Math.round(SET_EDIT_SPARE_TRIES * perEdit * 100) / 100).toBe(1.86);
    expect(setEditTriesMonthlyLimit("growth", true)).toBe(-1);
    expect(setEditTriesMonthlyLimit(null, false)).toBe(0);
    expect(setEditTriesMonthlyLimit("none", false)).toBe(0);
  });

  it("sends only a set Astra can answer whole, and every set Astra has built so far is one", () => {
    // The mend's own bound: 0.52 answer tokens a character, plus ~1,500 for what the change adds.
    expect(SET_EDIT_MAX_SPEC_CHARS).toBe(SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS);
    expect(Math.ceil(SET_EDIT_MAX_SPEC_CHARS * 0.52) + 1_500).toBeLessThanOrEqual(SET_BUILD_MAX_OUTPUT_TOKENS);
    for (const [name, fixture] of Object.entries({ beach, raceTrack, rainyMarket, showroomClosed, showroomOpen })) {
      const n = normaliseSetSpec(fixture);
      expect(n.ok, name).toBe(true);
      if (n.ok) expect(JSON.stringify(n.spec).length, name).toBeLessThanOrEqual(SET_EDIT_MAX_SPEC_CHARS);
    }
  });
});
