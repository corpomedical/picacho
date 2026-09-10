import { describe, expect, it } from "vitest";
import { costOfAstraUsageUsd, worstCaseAstraUsd } from "./prices";
import { SET_BUILD_INPUT_TOKENS, SET_BUILD_MAX_OUTPUT_TOKENS, SET_BUILD_MAX_ATTEMPTS } from "../sets/set-config";

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
  it("matches the arithmetic in set-config.ts: $0.5225 an attempt, $1.045 a build", () => {
    const perAttempt = worstCaseAstraUsd(SET_BUILD_INPUT_TOKENS, SET_BUILD_MAX_OUTPUT_TOKENS);
    expect(perAttempt).toBeCloseTo(0.5225, 6);
    expect(perAttempt * SET_BUILD_MAX_ATTEMPTS).toBeCloseTo(1.045, 6);
  });
});
