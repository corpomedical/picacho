import { describe, expect, it } from "vitest";
import {
  continuationExtraCredits,
  WITH_VIDEO_INPUT_MULTIPLIER,
  COST_BASIS_USD_PER_CREDIT,
  VIDEO_MODELS,
  getDurationCreditWeight,
} from "./providers/video-models";

// fal bills a continuation's SOURCE clip as well as its output, at 0.6x —
// "charged for both input and output videos", their published pricing. The
// codebase used to assert the opposite and charged nothing for the source;
// two production continuations each cost $3.72 against a $1.68 charge.
describe("continuationExtraCredits", () => {
  const model = (id: string) => VIDEO_MODELS.find((m) => m.id === id)!;

  it("re-prices the observed incident above its real cost", () => {
    // The two real losses: seedance-2, 5s out continued from a ~15s source,
    // 265.97 billed units = $3.72. Old charge: 6 credits ($1.68 basis).
    const extra = continuationExtraCredits("seedance-2", 5, 15);
    expect(extra).toBe(7);
    const charged = (6 + extra) * COST_BASIS_USD_PER_CREDIT;
    const realCost = model("seedance-2").costPerSecondUsd * WITH_VIDEO_INPUT_MULTIPLIER * (15 + 5);
    expect(charged).toBeGreaterThanOrEqual(realCost);
  });

  it("matches fal's published with-video rate for Seedance 2.5", () => {
    // fal, 2026-08-31: "With video inputs and 720p resolution, the price is
    // roughly $0.2838 per second" — which is exactly catalogue rate x 0.6.
    expect(model("seedance").costPerSecondUsd * WITH_VIDEO_INPUT_MULTIPLIER).toBeCloseTo(0.2838, 4);
  });

  it("never sells any continuation below cost, across the whole grid", () => {
    for (const id of ["seedance", "seedance-2"] as const) {
      const m = model(id);
      for (const d of m.durations) {
        for (const source of [3, 5, 10, 15, 20, 30]) {
          const total =
            getDurationCreditWeight(m, d.seconds) + continuationExtraCredits(id, d.seconds, source);
          const cost = m.costPerSecondUsd * WITH_VIDEO_INPUT_MULTIPLIER * (d.seconds + source);
          expect(total * COST_BASIS_USD_PER_CREDIT, `${id} ${d.seconds}s from ${source}s`).toBeGreaterThanOrEqual(cost);
        }
      }
    }
  });

  it("floors at zero instead of discounting", () => {
    // A short source into a long render is genuinely cheaper at fal (the
    // 0.6x also discounts the output) — the user just pays the normal price.
    expect(continuationExtraCredits("seedance-2", 15, 3)).toBe(0);
  });

  it("is zero for models that cannot continue, and for a zero-length source", () => {
    for (const id of ["kling", "kling-o3-pro", "veo", "kling-2.5"]) {
      expect(continuationExtraCredits(id, 5, 15)).toBe(0);
    }
    expect(continuationExtraCredits("seedance-2", 5, 0)).toBe(0);
  });
});
