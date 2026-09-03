import { describe, expect, it } from "vitest";
import {
  LAYERS_COVERED_LAYERS,
  LAYERS_MAX_LAYERS,
  LAYERS_MODEL_ID,
  LAYERS_TIERS,
  layerStoragePath,
  layersCreditCost,
  takeLayersIneligibility,
  uploadLayersIneligibility,
} from "./layers";

// The split's money and eligibility rules, pinned. Provider prices read from
// fal's model page 2026-09-03 ($0.03375 / $0.0675 per delivered layer); the
// house basis is $0.28 per credit. Change a rate and these together.

describe("layersCreditCost", () => {
  it("charges the fixed tier prices", () => {
    expect(layersCreditCost("1k")).toBe(2);
    expect(layersCreditCost("2k")).toBe(4);
  });

  it("covers sixteen delivered layers at cost on both tiers", () => {
    for (const tier of ["1k", "2k"] as const) {
      const revenue = layersCreditCost(tier) * 0.28;
      expect(revenue).toBeGreaterThanOrEqual(LAYERS_TIERS[tier].providerUsdPerLayer * LAYERS_COVERED_LAYERS);
    }
  });

  it("documents the one case it does not cover: the seventeenth layer", () => {
    // Known and accepted — about two cents on a 2K split with the maximum
    // layer count, which the probe never produced (6–7 was typical).
    for (const tier of ["1k", "2k"] as const) {
      const revenue = layersCreditCost(tier) * 0.28;
      const worst = LAYERS_TIERS[tier].providerUsdPerLayer * LAYERS_MAX_LAYERS;
      expect(worst - revenue).toBeLessThan(0.03);
    }
  });

  it("keeps a real margin at the typical six layers", () => {
    for (const tier of ["1k", "2k"] as const) {
      expect(layersCreditCost(tier) * 0.28).toBeGreaterThan(LAYERS_TIERS[tier].providerUsdPerLayer * 6 * 1.2);
    }
  });
});

describe("takeLayersIneligibility", () => {
  const base = { content_type: "image", status: "succeeded", model_id: "flux", source_generation_id: null };
  it("accepts a finished image", () => {
    expect(takeLayersIneligibility(base)).toBeNull();
  });
  it("refuses video, unfinished and already-split rows", () => {
    expect(takeLayersIneligibility({ ...base, content_type: "video" })).toBe("not-image");
    expect(takeLayersIneligibility({ ...base, status: "generating" })).toBe("not-succeeded");
    expect(takeLayersIneligibility({ ...base, model_id: LAYERS_MODEL_ID })).toBe("already-layered");
  });
});

describe("uploadLayersIneligibility", () => {
  const ok = { bytes: 2_000_000, mimeType: "image/png", width: 1024, height: 1024 };
  it("accepts png/jpeg/webp within the caps", () => {
    expect(uploadLayersIneligibility(ok)).toBeNull();
    expect(uploadLayersIneligibility({ ...ok, mimeType: "image/jpeg" })).toBeNull();
    expect(uploadLayersIneligibility({ ...ok, mimeType: "image/webp" })).toBeNull();
  });
  it("refuses the wrong type, too big, too small", () => {
    expect(uploadLayersIneligibility({ ...ok, mimeType: "image/gif" })).toBe("not-image");
    expect(uploadLayersIneligibility({ ...ok, bytes: 21 * 1024 * 1024 })).toBe("too-big");
    expect(uploadLayersIneligibility({ ...ok, width: 400 })).toBe("too-small");
  });
});

describe("layerStoragePath", () => {
  it("keeps every layer under the owner's folder", () => {
    expect(layerStoragePath("u1", "g1", 4)).toBe("u1/layers/g1/z4.png");
  });
});
