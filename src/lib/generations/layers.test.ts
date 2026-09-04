import { describe, expect, it } from "vitest";
import {
  LAYER_EDIT_MAX_PIXELS,
  layerEditCreditCost,
  LAYER_EDIT_MAX_PROMPT,
  layerEditIneligibility,
  newestLayers,
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

describe("layerEditIneligibility", () => {
  const ok = { prompt: "make the jacket red", zIndex: 3, parentStatus: "succeeded" };
  it("accepts a real prompt on a non-base layer of a finished split", () => {
    expect(layerEditIneligibility(ok)).toBeNull();
  });
  it("refuses an empty or whitespace prompt", () => {
    expect(layerEditIneligibility({ ...ok, prompt: "" })).toBe("no-prompt");
    expect(layerEditIneligibility({ ...ok, prompt: "   " })).toBe("no-prompt");
  });
  it("refuses a prompt past the cap", () => {
    expect(layerEditIneligibility({ ...ok, prompt: "x".repeat(LAYER_EDIT_MAX_PROMPT + 1) })).toBe("prompt-too-long");
    expect(layerEditIneligibility({ ...ok, prompt: "x".repeat(LAYER_EDIT_MAX_PROMPT) })).toBeNull();
  });
  it("refuses the base layer — everything else composites over it", () => {
    expect(layerEditIneligibility({ ...ok, zIndex: 0 })).toBe("base-layer");
  });
  it("refuses a split that has not finished", () => {
    expect(layerEditIneligibility({ ...ok, parentStatus: "generating" })).toBe("not-succeeded");
  });
});

describe("layerEditCreditCost", () => {
  it("charges one credit for an ordinary layer", () => {
    // The measured case: a 605x1088 hiker, 0.66 MP.
    expect(layerEditCreditCost(605, 1088)).toBe(1);
  });
  it("charges two once the layer is big enough to cost real money", () => {
    // ~2.6 MP at 2K: about $0.22 with the gate's free retry, which one
    // credit ($0.28) covers too thinly.
    expect(layerEditCreditCost(1210, 2176)).toBe(2);
  });
  it("keeps a real margin at both tiers, worst case (free retry spent)", () => {
    // fal, read 2026-09-04: $0.03 first output MP + $0.015 per extra MP of
    // input and output, ceiled. Small: 4 MP -> $0.075, x2 = $0.15 + $0.01
    // score. Large: 6 MP -> $0.105, x2 = $0.21 + $0.01.
    expect(layerEditCreditCost(605, 1088) * 0.28).toBeGreaterThan(0.15 + 0.01);
    expect(layerEditCreditCost(1210, 2176) * 0.28).toBeGreaterThan(0.21 + 0.01);
  });
  it("treats unknown dimensions as the cheap tier", () => {
    expect(layerEditCreditCost(null, null)).toBe(1);
  });
});

describe("layer edit size cap", () => {
  it("refuses a layer past the cap", () => {
    const over = Math.ceil(Math.sqrt(LAYER_EDIT_MAX_PIXELS)) + 10;
    expect(
      layerEditIneligibility({ prompt: "red", zIndex: 1, parentStatus: "succeeded", width: over, height: over }),
    ).toBe("too-large");
  });
  it("accepts a full-canvas 2K layer, which is what a 2K split delivers", () => {
    expect(
      layerEditIneligibility({ prompt: "red", zIndex: 1, parentStatus: "succeeded", width: 2048, height: 2048 }),
    ).toBeNull();
  });
});

describe("layerStoragePath versions", () => {
  it("keeps v1 at the unversioned name every stage-1 split already wrote", () => {
    expect(layerStoragePath("u1", "g1", 4)).toBe("u1/layers/g1/z4.png");
    expect(layerStoragePath("u1", "g1", 4, 1)).toBe("u1/layers/g1/z4.png");
  });
  it("gives every later version its own object, never a rewrite", () => {
    expect(layerStoragePath("u1", "g1", 4, 2)).toBe("u1/layers/g1/z4-v2.png");
  });
});

describe("newestLayers", () => {
  const rows = [
    { zIndex: 0, version: 1, tag: "base" },
    { zIndex: 1, version: 1, tag: "sky-v1" },
    { zIndex: 1, version: 2, tag: "sky-v2" },
    { zIndex: 2, version: 1, tag: "hiker" },
  ];
  it("keeps the highest version of each layer, in z order", () => {
    expect(newestLayers(rows).map((r) => r.tag)).toEqual(["base", "sky-v2", "hiker"]);
  });
  it("does not care what order the rows arrive in", () => {
    expect(newestLayers([...rows].reverse()).map((r) => r.tag)).toEqual(["base", "sky-v2", "hiker"]);
  });
  it("is empty for no rows", () => {
    expect(newestLayers([])).toEqual([]);
  });
});
