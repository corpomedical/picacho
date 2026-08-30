import { describe, expect, it } from "vitest";
import {
  freeHighResolution,
  resolutionCreditWeight,
  resolutionExtraCredits,
  resolveVideoResolution,
  videoResolutionOffers,
} from "./providers/video-resolution";

// Resolution pricing (2026-08-30). Veo 3.1, verbatim from fal's own page:
//   "$0.20 without audio or $0.40 with audio for 720p or 1080p. At 4k, you
//    will be charged $0.40 per second without audio, or $0.60 with."
// Audio is on by default for Veo, so 720p and 1080p both bill $0.40/sec and
// 4K bills $0.60/sec — exactly 1.5x.

const COST_PER_CREDIT = 0.28; // COST_BASIS_USD_PER_CREDIT
const VEO_4K_PER_SEC = 0.6;
const VEO_BASE_WEIGHTS: Record<number, number> = { 4: 6, 6: 9, 8: 12 };

describe("what each resolution costs", () => {
  it("prices 4K from the real per-second price, rounded UP, on every duration", () => {
    // The house formula: provider cost / $0.28 per credit, rounded up.
    // Rounding down would sell the most expensive option at a loss.
    for (const seconds of [4, 6, 8]) {
      const expected = Math.ceil((seconds * VEO_4K_PER_SEC) / COST_PER_CREDIT);
      expect(resolutionCreditWeight("veo", "4k", seconds)).toBe(expected);
    }
    // Spelled out, so a future edit has to face the numbers:
    expect(resolutionCreditWeight("veo", "4k", 4)).toBe(9); // $2.40 -> 8.57
    expect(resolutionCreditWeight("veo", "4k", 6)).toBe(13); // $3.60 -> 12.86
    expect(resolutionCreditWeight("veo", "4k", 8)).toBe(18); // $4.80 -> 17.14
  });

  it("REGRESSION: 4K is derived from cost, NOT by scaling the base weight", () => {
    // Base weights were themselves rounded up, so scaling them compounds the
    // rounding and overcharges. At 6s, 9 x 1.5 = 13.5 -> 14, but the true
    // cost is 12.86 -> 13. One credit is a real overcharge on every render.
    expect(resolutionCreditWeight("veo", "4k", 6)).toBe(13);
    expect(resolutionCreditWeight("veo", "4k", 6)).not.toBe(Math.ceil(VEO_BASE_WEIGHTS[6] * 1.5));
  });

  it("charges nothing extra for 1080p, which the provider bills the same", () => {
    expect(resolutionCreditWeight("veo", "1080p", 8)).toBeNull();
    expect(resolutionExtraCredits("veo", "1080p", 8, VEO_BASE_WEIGHTS[8])).toBe(0);
  });

  it("reports the surcharge the composer shows before anything is spent", () => {
    expect(resolutionExtraCredits("veo", "4k", 8, VEO_BASE_WEIGHTS[8])).toBe(6); // 18 - 12
    expect(resolutionExtraCredits("veo", "4k", 4, VEO_BASE_WEIGHTS[4])).toBe(3); // 9 - 6
    expect(resolutionExtraCredits("veo", "4k", 6, VEO_BASE_WEIGHTS[6])).toBe(4); // 13 - 9
  });

  it("REGRESSION: an unknown duration falls back rather than billing as free", () => {
    // null makes the caller use getDurationCreditWeight, which has its own
    // default-duration fallback. A missing row must never mean "no charge".
    expect(resolutionCreditWeight("veo", "4k", 7)).toBeNull();
    expect(resolutionCreditWeight("veo", "4k", 30)).toBeNull();
  });
});

describe("which resolutions are offered", () => {
  it("offers 1080p and 4K on Veo, and marks only 1080p as free", () => {
    expect(videoResolutionOffers("veo").map((o) => o.value)).toEqual(["1080p", "4k"]);
    expect(freeHighResolution("veo")).toBe("1080p");
  });

  it("offers nothing on models with no same-cost or priced alternative", () => {
    for (const id of ["kling", "kling-2.5", "kling-o3", "kling-o3-pro", "seedance", "seedance-2"]) {
      expect(videoResolutionOffers(id)).toEqual([]);
      expect(freeHighResolution(id)).toBeNull();
    }
  });
});

describe("resolveVideoResolution (the server-side gate)", () => {
  it("accepts what the model actually offers", () => {
    expect(resolveVideoResolution("veo", "1080p")).toBe("1080p");
    expect(resolveVideoResolution("veo", "4k")).toBe("4k");
  });

  it("sends nothing when nobody asked, keeping today's behaviour exactly", () => {
    expect(resolveVideoResolution("veo", null)).toBeNull();
    expect(resolveVideoResolution("veo", undefined)).toBeNull();
    expect(resolveVideoResolution("veo", "")).toBeNull();
    // 720p is the endpoint default — nothing to send.
    expect(resolveVideoResolution("veo", "720p")).toBeNull();
  });

  it("REGRESSION: a resolution cannot ride along to a model rerouted by the circuit breaker", () => {
    // Ask for 4K on Veo, Veo is out of service, you land on Kling. The
    // request must carry neither a parameter Kling has never heard of nor
    // Veo's 4K surcharge — and on multi-angle that surcharge would have been
    // applied once PER ANGLE.
    expect(resolveVideoResolution("kling", "4k")).toBeNull();
    expect(resolveVideoResolution("kling", "1080p")).toBeNull();
    expect(resolutionCreditWeight("kling", "4k", 5)).toBeNull();
    expect(resolutionCreditWeight("kling-o3-pro", "4k", 5)).toBeNull();
  });

  it("ignores anything else that arrives in form data", () => {
    expect(resolveVideoResolution("veo", "8k")).toBeNull();
    expect(resolveVideoResolution("veo", "4K")).toBeNull(); // case-sensitive on purpose
    expect(resolveVideoResolution("veo", "'; drop table")).toBeNull();
  });
});

// The audit lives in video-models.ts, which vitest cannot import (it pulls
// "@/lib/plans"). Recomputing the same arithmetic here keeps the guarantee
// under test: no priced resolution may ever sell below its own cost.
describe("no priced resolution sells at a loss", () => {
  it("every 4K weight covers its real provider cost", () => {
    const offer = videoResolutionOffers("veo").find((o) => o.value === "4k")!;
    expect(offer.costPerSecondUsd).toBe(0.6);
    for (const [secondsKey, credits] of Object.entries(offer.weights!)) {
      const seconds = Number(secondsKey);
      const allowanceValueUsd = credits * COST_PER_CREDIT;
      const costUsd = offer.costPerSecondUsd! * seconds;
      expect(allowanceValueUsd + 0.005).toBeGreaterThanOrEqual(costUsd);
    }
  });

  it("the stated per-second price and the weights cannot drift apart", () => {
    // If someone edits one without the other, this fails — which is the
    // only thing standing between a provider price change and a silent loss.
    const offer = videoResolutionOffers("veo").find((o) => o.value === "4k")!;
    for (const [secondsKey, credits] of Object.entries(offer.weights!)) {
      expect(credits).toBe(
        Math.ceil((Number(secondsKey) * offer.costPerSecondUsd!) / COST_PER_CREDIT),
      );
    }
  });
});
