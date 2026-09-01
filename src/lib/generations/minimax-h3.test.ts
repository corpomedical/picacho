import { describe, expect, it } from "vitest";
import {
  COST_BASIS_USD_PER_CREDIT,
  getVideoModel,
  pricingAudit,
  requiresReferenceImage,
  VIDEO_MODELS,
} from "./providers/video-models";
import {
  freeHighResolution,
  resolutionCreditWeight,
  resolutionExtraCredits,
  resolveVideoResolution,
  videoResolutionOffers,
} from "./providers/video-resolution";

// MiniMax H3 reference-to-video (added 2026-09-01).
//
// Prices, verbatim from fal's own model page that day:
//   "Video costs $0.05 per second at 480p, $0.06 per second at 768p, $0.13
//    per second at 2K and $0.16 per second at 4K; the first 5 reference
//    images are free and each additional image costs $0.08."
//
// The failure this file mostly exists to catch is not arithmetic drift, it
// is the resolution default. fal types this endpoint's `resolution` with a
// default of "2K", NOT its cheapest tier — so a future edit that drops the
// explicit parameter from the branch in fal.ts would keep every test here
// passing while silently billing $0.13/sec against weights built for $0.06.
// The catalogue comment says so; these tests pin the numbers that comment
// depends on.

const H3_768P_USD_PER_SECOND = 0.06;
const H3_2K_USD_PER_SECOND = 0.13;

describe("minimax-h3 catalogue entry", () => {
  const model = getVideoModel("minimax-h3");

  it("is in the catalogue under its own id", () => {
    // getVideoModel falls back to the recommended model for an unknown id,
    // so an id typo here would silently return Kling 1.6 and every other
    // assertion in this file would be testing the wrong model.
    expect(model.id).toBe("minimax-h3");
  });

  it("points at MiniMax's own fal namespace, not fal-ai/", () => {
    // The one endpoint in the catalogue without the fal-ai/ prefix. If a
    // well-meaning edit "corrects" it, every render 404s.
    expect(model.falEndpoint).toBe("minimax/h3/reference-to-video");
  });

  it("is priced at the 768P rate the branch actually sends", () => {
    expect(model.costPerSecondUsd).toBe(H3_768P_USD_PER_SECOND);
  });

  it("weighs every duration at ceil(cost / $0.28)", () => {
    for (const d of model.durations) {
      expect(d.creditWeight).toBe(
        Math.ceil((H3_768P_USD_PER_SECOND * d.seconds) / COST_BASIS_USD_PER_CREDIT),
      );
    }
    // Spelled out, so a weight change has to be deliberate: $0.30 -> 2,
    // $0.60 -> 3, $0.90 -> 4.
    expect(model.durations.map((d) => [d.seconds, d.creditWeight])).toEqual([
      [5, 2],
      [10, 3],
      [15, 4],
    ]);
  });

  it("cannot run without a reference photo", () => {
    // requiresReferenceImage is a regex over the endpoint, and it is what
    // stops a credit being spent on a request fal would reject.
    expect(requiresReferenceImage(model)).toBe(true);
  });

  it("keeps every catalogue id unique", () => {
    const ids = VIDEO_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("minimax-h3 resolution tier", () => {
  it("offers 2K and nothing else", () => {
    expect(videoResolutionOffers("minimax-h3").map((o) => o.value)).toEqual(["2k"]);
  });

  it("prices 2K at ceil(cost / $0.28), not by scaling the base weight", () => {
    for (const seconds of [5, 10, 15]) {
      expect(resolutionCreditWeight("minimax-h3", "2k", seconds)).toBe(
        Math.ceil((H3_2K_USD_PER_SECOND * seconds) / COST_BASIS_USD_PER_CREDIT),
      );
    }
    // $0.65 -> 3, $1.30 -> 5, $1.95 -> 7. Scaling the base weights by the
    // 2.17x price ratio would have given 5/7/9 — compounding two roundings.
    expect([5, 10, 15].map((s) => resolutionCreditWeight("minimax-h3", "2k", s))).toEqual([3, 5, 7]);
  });

  it("charges for 2K rather than giving it away", () => {
    // freeHighResolution returns the first offer with no weights. A null
    // here is the assertion that this upgrade is never labelled free.
    expect(freeHighResolution("minimax-h3")).toBeNull();
    expect(resolutionExtraCredits("minimax-h3", "2k", 5, 2)).toBe(1);
    expect(resolutionExtraCredits("minimax-h3", "2k", 10, 3)).toBe(2);
    expect(resolutionExtraCredits("minimax-h3", "2k", 15, 4)).toBe(3);
  });

  it("refuses a resolution this lane does not offer", () => {
    // 4K and 1080p are real VideoResolution values that other models use;
    // resolving one against H3 must yield null ("send no parameter"), never
    // a charge for a tier it cannot render.
    expect(resolveVideoResolution("minimax-h3", "4k")).toBeNull();
    expect(resolveVideoResolution("minimax-h3", "1080p")).toBeNull();
    expect(resolveVideoResolution("minimax-h3", "2k")).toBe("2k");
  });

  it("REGRESSION: 2K never resolves on a model that cannot render it", () => {
    // The circuit breaker can substitute the model after the resolution was
    // picked. Resolving against the FINAL id is what stops a 2K charge
    // riding along to an endpoint with no such tier.
    for (const id of ["kling", "kling-2.5", "kling-o3", "kling-o3-pro", "seedance", "seedance-2", "veo"]) {
      expect(resolveVideoResolution(id, "2k")).toBeNull();
    }
  });
});

describe("pricing audit", () => {
  it("reports no option selling below its provider cost", () => {
    // The whole catalogue, not just H3 — this is the gate the admin panel
    // surfaces, and a new model is the most likely thing to trip it.
    expect(pricingAudit()).toEqual([]);
  });

  it("undercuts the O3 Pro reference lane at every shared length", () => {
    // The reason this lane was added. If a fal price change ever inverts
    // this, the description ("about $0.06 per second") and the case for
    // featuring it both need revisiting.
    const h3 = getVideoModel("minimax-h3");
    const o3pro = getVideoModel("kling-o3-pro");
    for (const seconds of [5, 10, 15]) {
      const a = h3.durations.find((d) => d.seconds === seconds)!.creditWeight;
      const b = o3pro.durations.find((d) => d.seconds === seconds)!.creditWeight;
      expect(a).toBeLessThan(b);
    }
  });
});
