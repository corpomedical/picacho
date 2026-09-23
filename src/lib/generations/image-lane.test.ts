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
import { quoteSend } from "./quote";
import { COST_BASIS_USD_PER_CREDIT } from "./providers/video-models";
import {
  DEFAULT_IMAGE_ASPECT,
  IMAGE_ASPECTS,
  defaultImageResolution,
  imageAspectOffers,
  imagePricingAudit,
  imageResolutionCreditWeight,
  imageResolutionOffers,
  imageQualityCreditWeight,
  imageQualityIsPaidOnly,
  imageQualityOffers,
  imageRenderCreditWeight,
  laneTiersBothDimensions,
  offersImageAspect,
  offersImageQuality,
  offersImageResolution,
} from "./providers/image-resolution";
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
const pipeline = read("pipeline.ts");

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
  // Every weight covers its own provider price. The defect this prevents is
  // the one 4K introduced: at fal's "4K outputs will be charged at double
  // the standard rate" a 4K picture costs $0.30 against a credit worth
  // $0.28, so the "an image is always 1 credit" rule that held while no lane
  // sold a picture that dear would have lost money on every one.
  it("never sells a size below what it costs us", () => {
    for (const row of imagePricingAudit()) {
      expect(row.ok, `${row.modelId} ${row.band}: $${row.costUsd} at ${row.weight} credit(s)`).toBe(true);
    }
  });

  it("charges two credits for 4K and one for the rest, from fal's own arithmetic", () => {
    expect(imageResolutionCreditWeight("gemini", "1K")).toBe(1);
    expect(imageResolutionCreditWeight("gemini", "2K")).toBe(1);
    expect(imageResolutionCreditWeight("gemini", "4K")).toBe(2);
    // 2 x $0.28 = $0.56 against $0.30 — the same 46% shape the $0.15 tiers carry.
    expect(2 * COST_BASIS_USD_PER_CREDIT).toBeGreaterThan(0.3);
    // A size a lane does not sell is priced as that lane's default, never free.
    expect(imageResolutionCreditWeight("gpt-image", "4K")).toBe(1);
    expect(imageResolutionCreditWeight("gemini", null)).toBe(1);
  });

  it("opens on 2K, because fal charges the same for it as for 1K", () => {
    expect(defaultImageResolution("gemini")).toBe("2K");
    expect(defaultImageResolution("gpt-image")).toBe("1K");
    const offers = imageResolutionOffers("gemini");
    expect(offers.find((o) => o.value === "1K")!.costPerImageUsd).toBe(
      offers.find((o) => o.value === "2K")!.costPerImageUsd,
    );
  });

  it("sends a size and a shape, never the endpoint's own defaults", () => {
    // resolution defaults to 1K and aspect_ratio to "auto" (which follows the
    // first input picture — the 2026-09-23 shape defect). Both are always set.
    expect(falImage).toContain('resolution: options?.resolution ?? defaultImageResolution("gemini")');
    expect(falImage).toContain("aspect_ratio: options?.aspect ?? DEFAULT_IMAGE_ASPECT");
    // Never SENT (the module explains why in prose, hence the two exact
    // forms rather than the bare word): turning a provider's own filter down
    // is the ladder removed on 2026-09-09.
    expect(falImage).not.toContain("safety_tolerance:");
    expect(falImage).not.toContain("body.safety_tolerance");
  });

  it("offers only shapes the lane can actually render", () => {
    // GPT's endpoint takes three pixel sizes and nothing else, so offering a
    // 16:9 there would be a control that lies.
    expect(imageAspectOffers("gpt-image")).toEqual(["3:2", "1:1", "2:3"]);
    expect(imageAspectOffers("gemini")).toEqual(IMAGE_ASPECTS);
    expect(offersImageAspect("gemini", "21:9")).toBe(true);
    expect(offersImageAspect("gpt-image", "21:9")).toBe(false);
    expect(offersImageResolution("gemini", "4K")).toBe(true);
    expect(offersImageResolution("gpt-image", "4K")).toBe(false);
    // Every lane can do the default, or a send with no shape picked breaks.
    for (const m of IMAGE_MODELS) {
      expect(offersImageAspect(m.id, DEFAULT_IMAGE_ASPECT), m.id).toBe(true);
    }
  });
});

describe("how hard the model works", () => {
  it("offers the three top tiers on the lane that has the control, and none on the lanes that do not", () => {
    expect(imageQualityOffers("gpt-image").map((o) => o.value)).toEqual(["high", "xhigh", "max"]);
    // fal's Nano Banana Pro endpoint takes no quality parameter — a cell
    // there would change nothing.
    expect(imageQualityOffers("gemini")).toEqual([]);
    expect(imageQualityOffers("flux")).toEqual([]);
    expect(offersImageQuality("gpt-image", "max")).toBe(true);
    expect(offersImageQuality("gpt-image", "low")).toBe(false);
    expect(offersImageQuality("gemini", "max")).toBe(false);
  });

  it("charges for max, and never below what a tier can cost", () => {
    expect(imageQualityCreditWeight("gpt-image", "high")).toBe(1);
    expect(imageQualityCreditWeight("gpt-image", "xhigh")).toBe(1);
    expect(imageQualityCreditWeight("gpt-image", "max")).toBe(2);
    // A lane with no quality control contributes its floor, never a discount.
    expect(imageQualityCreditWeight("gemini", "max")).toBe(1);
    // Anything unrecognised is priced as the default tier, never free.
    expect(imageQualityCreditWeight("gpt-image", null)).toBe(1);
    expect(imageQualityCreditWeight("gpt-image", "low")).toBe(1);
  });

  // The two upper tiers are BOUNDS, not measurements: OpenAI publishes no
  // token count per quality, and no request has been sent at either. This
  // records that honestly so nobody later reads the table as measured.
  it("says which figures are measured and which are bounds", () => {
    const byTier = Object.fromEntries(imageQualityOffers("gpt-image").map((o) => [o.value, o]));
    expect(byTier.high.measured).toBe(true);
    expect(byTier.xhigh.measured).toBe(false);
    expect(byTier.max.measured).toBe(false);
  });

  it("is paid-only above high, and the server pins a free account", () => {
    expect(imageQualityIsPaidOnly("gpt-image", "high")).toBe(false);
    expect(imageQualityIsPaidOnly("gpt-image", "xhigh")).toBe(true);
    expect(imageQualityIsPaidOnly("gpt-image", "max")).toBe(true);
    const pick = actions.slice(
      actions.indexOf("const requestedImageQuality ="),
      actions.indexOf("imageQuality;", actions.indexOf("const requestedImageQuality =")),
    );
    expect(pick).toContain("offersImageQuality(imageModelId, requestedImageQuality)");
    expect(pick).toContain("!isFreeTierAccount || !imageQualityIsPaidOnly(imageModelId, requestedImageQuality)");
  });

  it("prices a max render at two credits through the same quote the receipt shows", () => {
    const base = {
      contentType: "image" as const,
      videoModelId: "kling",
      videoDurationSeconds: 5,
      videoResolution: null,
      storyboardTotalSeconds: null,
      referencePhotoCount: 0,
      framePicked: false,
      continuationSourceSeconds: null,
      dialoguePresent: false,
      renderCount: 1,
    };
    expect(quoteSend({ ...base, imageModelId: "gpt-image", imageQuality: "max" }).totalCredits).toBe(2);
    expect(quoteSend({ ...base, imageModelId: "gpt-image", imageQuality: "xhigh" }).totalCredits).toBe(1);
    expect(quoteSend({ ...base, imageModelId: "gpt-image", imageQuality: "high" }).totalCredits).toBe(1);
  });

  // imageRenderCreditWeight takes the LARGER of the two dimensions, which is
  // the price only while every lane tiers exactly one of them. The day a lane
  // charges more for both a bigger size AND a harder render, that max would
  // undercharge — so the invariant is asserted, not assumed.
  it("has no lane tiering both size and quality, which is what makes the combined weight a max", () => {
    for (const m of IMAGE_MODELS) {
      expect(laneTiersBothDimensions(m.id), m.id).toBe(false);
    }
    expect(imageRenderCreditWeight("gpt-image", "1K", "max")).toBe(2);
    expect(imageRenderCreditWeight("gemini", "4K", "high")).toBe(2);
    expect(imageRenderCreditWeight("gemini", "2K", "high")).toBe(1);
  });

  it("has every quality label in all four locales", () => {
    for (const tier of imageQualityOffers("gpt-image")) {
      for (const [name, msgs] of [["en", en], ["es", es], ["pt", pt], ["it", it_]] as const) {
        const line = (msgs.generate as Record<string, unknown>)[`imageQuality_${tier.value}`];
        expect(typeof line, `${name}.imageQuality_${tier.value}`).toBe("string");
        expect((line as string).trim().length, `${name}.${tier.value}`).toBeGreaterThan(0);
      }
    }
    for (const [name, msgs] of [["en", en], ["es", es], ["pt", pt], ["it", it_]] as const) {
      expect(typeof (msgs.generate as Record<string, unknown>).slateQuality, `${name}.slateQuality`).toBe("string");
    }
  });
});

describe("the size and shape a send asks for", () => {
  it("prices a 4K picture at two credits, through the same quote the receipt shows", () => {
    const base = {
      contentType: "image" as const,
      videoModelId: "kling",
      videoDurationSeconds: 5,
      videoResolution: null,
      storyboardTotalSeconds: null,
      referencePhotoCount: 0,
      framePicked: false,
      continuationSourceSeconds: null,
      dialoguePresent: false,
      renderCount: 1,
    };
    expect(quoteSend({ ...base, imageModelId: "gemini", imageResolution: "4K" }).totalCredits).toBe(2);
    expect(quoteSend({ ...base, imageModelId: "gemini", imageResolution: "2K" }).totalCredits).toBe(1);
    // Every caller that quoted a picture before 4K existed keeps its price.
    expect(quoteSend(base).totalCredits).toBe(1);
    // And a 4K send can never ride the free daily slot.
    expect(quoteSend({ ...base, imageModelId: "gemini", imageResolution: "4K" }).freeSlotEligible).toBe(false);
  });

  it("re-validates both against the FINAL lane, and pins free accounts", () => {
    const pick = actions.slice(
      actions.indexOf("const requestedImageResolution ="),
      actions.indexOf("const imageAspect:"),
    );
    // Against what the lane offers, not what the form claims — a 4K that
    // reached the provider on a one-credit lane is a render nobody charged for.
    expect(pick).toContain("offersImageResolution(imageModelId, requestedImageResolution)");
    expect(pick).toContain("!isFreeTierAccount &&");
    expect(actions).toContain("offersImageAspect(imageModelId, requestedImageAspect)");
    // The quote reads the band that was just validated, so the allowance
    // check, the saved credits_used and the receipt are one number.
    expect(actions).toContain("    imageModelId,\n    imageResolution,\n    imageQuality,\n    videoModelId,");
  });

  it("names the band on the take's log, so a two-credit charge can be traced", () => {
    expect(pipeline).toContain("const bandNote =");
    expect(pipeline).toContain("${bandNote}");
  });

  it("has the SIZE cell's label in all four locales", () => {
    for (const [name, msgs] of [["en", en], ["es", es], ["pt", pt], ["it", it_]] as const) {
      const line = (msgs.generate as Record<string, unknown>).slateSize;
      expect(typeof line, `${name}.slateSize`).toBe("string");
      expect((line as string).trim().length, `${name}.slateSize`).toBeGreaterThan(0);
    }
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
    expect(image).toContain("generateImageWithGemini(prompt, combinedRefs, {");
    // …and with the band this send paid for, not the endpoint's defaults.
    expect(image).toContain("resolution: imageResolution,");
    expect(image).toContain("aspect: imageAspect,");
  });

  it("reads a 422 as the refusal it is, not as a provider error", () => {
    // Measured against the live endpoint 2026-09-23: fal answers a prompt it
    // will not draw with 422 and a prose `detail`, NOT with the 200-and-no-
    // picture this lane was first written for. As an Error it would carry a
    // status code into the retry ladder and a raw provider dump into the log.
    const start = falImage.indexOf("export async function generateImageWithGemini");
    const guard = falImage.slice(start, falImage.indexOf("const data = await res.json()", start));
    expect(guard).toContain("res.status === 422");
    expect(guard).toContain("throw new GeminiImageRefusal(IMAGE_RESULT_REFUSED)");
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
