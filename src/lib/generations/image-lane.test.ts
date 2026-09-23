import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  IMAGE_LANES_THAT_COMPOSITE,
  IMAGE_MODELS,
  SELECTABLE_IMAGE_MODEL_IDS,
  getImageModel,
  imageLaneTakesExtraPhotos,
  isImageModelPaidOnly,
  selectableImageModels,
} from "./providers/image-models";
import { MODEL_CAPABILITIES } from "./send-plan";
import { COST_BASIS_USD_PER_CREDIT } from "./providers/video-models";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import it_ from "../i18n/messages/it";

// The picture lane a person picks (2026-09-23, the operator: "Make it an
// option for the user to select. Not for free tier.").
//
// Nano Banana Pro costs about 1.96x the render it can replace, so the two
// defects this file exists to prevent are both money defects, and a third
// that is worse than either: a lane that renders somewhere other than where
// the log says it did.
//
// Read as source where the module loads a provider SDK, the same way
// element-lane.test.ts does.

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const actions = read("actions.ts");
const image = read("providers/image.ts");
const falImage = read("providers/fal-image.ts");

describe("the pickable picture lanes", () => {
  it("offers only lanes that exist in the catalogue", () => {
    for (const id of SELECTABLE_IMAGE_MODEL_IDS) {
      expect(IMAGE_MODELS.some((m) => m.id === id), id).toBe(true);
    }
    expect(selectableImageModels().map((m) => m.id)).toEqual([...SELECTABLE_IMAGE_MODEL_IDS]);
  });

  // The FEATURED_VIDEO_MODEL_IDS guard, for the picture picker: a job line
  // missing from one locale renders an empty subtitle in that language only,
  // so it survives every English-language check.
  it("has a hand-written job line for every offered lane, in all four locales", () => {
    const keys: Record<string, string> = {
      "gpt-image": "imageModelJobGptImage",
      gemini: "imageModelJobNanoBananaPro",
    };
    for (const id of SELECTABLE_IMAGE_MODEL_IDS) {
      const key = keys[id];
      expect(key, `no job key mapped for ${id}`).toBeTruthy();
      for (const [name, msgs] of [["en", en], ["es", es], ["pt", pt], ["it", it_]] as const) {
        const line = (msgs.generate as Record<string, unknown>)[key];
        expect(typeof line, `${name}.${key}`).toBe("string");
        expect((line as string).trim().length, `${name}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps Flux out of the picker — it is the admin's fallback lane, not a choice anyone makes", () => {
    expect(SELECTABLE_IMAGE_MODEL_IDS).not.toContain("flux");
    // Still reachable from Admin > AI Providers.
    expect(IMAGE_MODELS.some((m) => m.id === "flux")).toBe(true);
  });
});

describe("what a picked lane costs", () => {
  // An image is one credit on every lane (quote.ts: "images are always 1"),
  // so a lane whose picture costs more than a credit's cost basis would lose
  // money on every render and nothing else in the suite would say so.
  it("leaves margin on a credit at its pinned resolution", () => {
    const gemini = IMAGE_MODELS.find((m) => m.id === "gemini")!;
    expect("costPerImageUsd" in gemini).toBe(true);
    const usd = (gemini as { costPerImageUsd: number }).costPerImageUsd;
    expect(usd).toBeLessThan(COST_BASIS_USD_PER_CREDIT);
    // Not merely "under" — 30% clear, so a price rise is noticed here rather
    // than in the margin report (the free-tier lesson in free-tier-model.ts).
    expect(COST_BASIS_USD_PER_CREDIT - usd).toBeGreaterThan(0.3 * COST_BASIS_USD_PER_CREDIT);
  });

  it("pins the resolution, because fal prices 4K higher", () => {
    const gemini = IMAGE_MODELS.find((m) => m.id === "gemini")!;
    expect((gemini as { falResolution?: string }).falResolution).toBe("1K");
    expect(falImage).toContain("resolution: model.falResolution");
    // And the SHAPE, for the same reason the GPT lane never sends "auto":
    // this endpoint's aspect_ratio defaults to following the first input
    // picture, so an unpinned lane answers a square shot in the shape of
    // whatever photo anchors the character — and the identity score reads a
    // face that lands smaller in a taller frame as a worse match.
    expect(falImage).toContain('aspect_ratio: "1:1"');
    // Never SENT (the module explains why in prose, hence the two exact
    // forms rather than the bare word): turning a provider's own filter down
    // is the ladder removed on 2026-09-09.
    expect(falImage).not.toContain("safety_tolerance:");
    expect(falImage).not.toContain("body.safety_tolerance");
  });
});

describe("free accounts", () => {
  it("are pinned server-side, not merely unoffered in the composer", () => {
    const pick = actions.slice(
      actions.indexOf("const requestedImageModelId ="),
      actions.indexOf("imageModelId = requestedImageModelId;"),
    );
    expect(pick).toContain('contentType === "image" &&');
    expect(pick).toContain("!isFreeTierAccount &&");
    // Only the offered lanes — a hand-written form must not be able to route
    // around the decision that Flux stays an admin choice.
    expect(pick).toContain("SELECTABLE_IMAGE_MODEL_IDS.includes(");
  });

  it("pays for a paid-only lane with a plan, and the flag says which lanes those are", () => {
    expect(isImageModelPaidOnly("gemini")).toBe(true);
    expect(isImageModelPaidOnly("gpt-image")).toBe(false);
    expect(isImageModelPaidOnly("flux")).toBe(false);
  });
});

describe("routing", () => {
  // The defect: generateImageWithFlux resolves getImageModel("flux") for its
  // own endpoints, so a second `provider: "fal"` lane dispatched on the
  // provider alone renders on Flux while every log names the other model —
  // the 2026-08-10 "the log claimed GPT made the image" defect, reversed.
  it("dispatches Nano Banana Pro on its id, before any provider check", () => {
    const byId = image.indexOf('if (model.id === "gemini")');
    const byProvider = image.indexOf('if (model.provider === "fal")');
    expect(byId).toBeGreaterThan(-1);
    expect(byId).toBeLessThan(byProvider);
    expect(image).toContain("generateImageWithGemini(prompt, combinedRefs)");
  });

  it("fails loudly when the answer carries no picture", () => {
    // Google's models decline in prose with a 200, so an undefined URL must
    // not travel up the stack as a success — Flux's 2026-08-14 black-frame
    // incident, in this lane's own shape.
    expect(falImage).toContain("throw new GeminiImageRefusal(IMAGE_RESULT_REFUSED)");
    // The message carries "safety", which pipeline.ts's SAFETY_REJECTION
    // reads — non-retryable, so no credit buys a second refusal.
    expect(/safety/i.test("This image was refused by the image model's safety system, so it can't be shown.")).toBe(true);
  });
});

describe("the extra photos beside the person", () => {
  // The defect this catches, found on the first real Nano Banana Pro render
  // (2026-09-23): the four gates in actions.ts spelled out the two lanes that
  // existed when they were written, so the new lane silently lost the outfit
  // photo and the set's look and place photos, and had the person's own
  // attachment vision-described into text instead of riding as pixels —
  // while the capability matrix said outfitImage: true and the send receipt
  // promised the photo rode. A lane list spelled at the call site is the
  // whole defect, so the test is that no call site spells one.
  it("is decided from the catalogue, never by naming lanes in actions.ts", () => {
    expect(actions).not.toContain('imageModelId === "gpt-image" || imageModelId === "flux"');
    expect(actions.match(/imageLaneTakesExtraPhotos\(imageModelId\)/g)).toHaveLength(4);
  });

  it("reaches every image lane, and matches what the receipt promises", () => {
    for (const m of IMAGE_MODELS) {
      expect(imageLaneTakesExtraPhotos(m.id), m.id).toBe(true);
      // MODEL_CAPABILITIES is what resolveSendPlan draws the receipt from:
      // a lane promising the outfit photo must actually be sent it.
      expect(MODEL_CAPABILITIES[m.id].outfitImage, m.id).toBe(true);
    }
    expect(imageLaneTakesExtraPhotos("kling")).toBe(false);
  });
});

describe("the capability matrix", () => {
  it("describes every catalogue lane", () => {
    for (const m of IMAGE_MODELS) {
      expect(MODEL_CAPABILITIES[m.id], m.id).toBeDefined();
      expect(MODEL_CAPABILITIES[m.id].kind, m.id).toBe("image");
    }
  });

  // Google's docs offer 3 Pro five character-consistency slots. Claiming them
  // here would hand this lane the whole gallery through
  // baselineIdentityReferences, on a reference order and prompt suffixes
  // written for a flat list — unproven, so unclaimed.
  it("keeps Nano Banana Pro to one identity photo until a probe says otherwise", () => {
    expect(MODEL_CAPABILITIES.gemini.identity).toEqual({
      max: 1,
      mechanism: "edit-source",
      required: false,
    });
  });

  it("lists every lane as one that can composite several characters, so the guard stays dormant", () => {
    for (const m of IMAGE_MODELS) {
      expect(IMAGE_LANES_THAT_COMPOSITE as readonly string[], m.id).toContain(m.id);
      expect(MODEL_CAPABILITIES[m.id].multiPerson, m.id).toBe(true);
    }
  });

  it("falls back to the recommended lane on an unknown id", () => {
    expect(getImageModel("nope").id).toBe("gpt-image");
    expect(getImageModel("gemini").id).toBe("gemini");
  });
});
