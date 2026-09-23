// What a picture's SIZE and SHAPE cost, and which lane offers which
// (2026-09-23, the operator: "Add 4k capabilities to gemini plus aspect
// ratio and any other features they can offer").
//
// Its own alias-free module for the same reason video-resolution.ts is one:
// the rules that decide what a render COSTS must be unit-testable, and
// image-models.ts is imported by modules that pull in provider SDKs. Keyed
// on model id, not a catalogue object, for the same reason.
//
// Every weight here is computed the way every other weight in this codebase
// is: provider cost / $0.28 per credit, rounded UP. Rounding down would sell
// the most expensive option at a loss.

/** Our own spelling. Each lane maps it to whatever its endpoint's enum wants. */
export type ImageResolution = "1K" | "2K" | "4K";
export const IMAGE_RESOLUTIONS: readonly ImageResolution[] = ["1K", "2K", "4K"];

/**
 * Our own spelling for a picture's shape, widest to tallest. The GPT lane
 * offers three of these (its endpoint takes pixel sizes, not ratios); the
 * Nano Banana Pro lane offers all of them.
 */
export type ImageAspect = "21:9" | "16:9" | "3:2" | "4:3" | "5:4" | "1:1" | "4:5" | "3:4" | "2:3" | "9:16";
export const IMAGE_ASPECTS: readonly ImageAspect[] = [
  "21:9",
  "16:9",
  "3:2",
  "4:3",
  "5:4",
  "1:1",
  "4:5",
  "3:4",
  "2:3",
  "9:16",
];

export type ImageResolutionOffer = {
  value: ImageResolution;
  /**
   * What the provider charges for ONE picture at this resolution. Kept here
   * beside the weight so the audit can catch the two disagreeing — the
   * weight is derived from this number and must never drift from it.
   */
  costPerImageUsd: number;
  /** Credits for one render at this resolution: costPerImageUsd / 0.28, rounded up. */
  creditWeight: number;
};

/** The peg every weight in this codebase is peged to (video-models.ts COST_BASIS_USD_PER_CREDIT). */
const USD_PER_CREDIT = 0.28;

const weigh = (usd: number): number => Math.max(1, Math.ceil(usd / USD_PER_CREDIT - 1e-9));

/**
 * Nano Banana Pro, fal's own model page read 2026-09-23, verbatim:
 *   "Your request will cost $0.15 per image. For $1.00, you can run this
 *    model 7 times. 4K outputs will be charged at double the standard rate."
 *
 * So 1K and 2K are THE SAME PRICE — which is why the lane's default is 2K
 * and not the 1K it shipped with: four times the pixels for the same money,
 * and nothing in the pipeline cared which it got.
 *
 *   1K -> $0.15 -> 0.54 -> 1 credit
 *   2K -> $0.15 -> 0.54 -> 1 credit
 *   4K -> $0.30 -> 1.07 -> 2 credits
 *
 * 4K genuinely cannot be one credit: $0.30 against a credit worth $0.28 is a
 * loss on every render, and "an image is always 1 credit" was true only
 * while no lane sold a picture that dear. Two credits is 46% margin, the
 * same shape the $0.15 tiers carry — deliberately NOT derived by scaling a
 * rounded weight, which is the compounding error video-resolution.ts calls
 * out.
 *
 * Google direct is cheaper on both tiers ($0.134 for 1K/2K, $0.24 for 4K,
 * ai.google.dev/gemini-api/docs/pricing, read the same day). It would not
 * change these weights: $0.24 still rounds to 1 credit at 86% of a credit's
 * basis, which is the thin margin this codebase refuses.
 */
const GEMINI_OFFERS: readonly ImageResolutionOffer[] = [
  { value: "1K", costPerImageUsd: 0.15, creditWeight: weigh(0.15) },
  { value: "2K", costPerImageUsd: 0.15, creditWeight: weigh(0.15) },
  { value: "4K", costPerImageUsd: 0.3, creditWeight: weigh(0.3) },
];

/**
 * GPT Image 2.5 sells ONE size band. Its price is per token, not per tier,
 * and the measured range is $0.057 (one input picture) to $0.0909 (a set
 * shot with the expression close-ups) — one credit, comfortably, at every
 * shape it offers. It has no 2K or 4K to offer at all: the endpoint's sizes
 * are 1024x1024, 1536x1024 and 1024x1536.
 */
const GPT_OFFERS: readonly ImageResolutionOffer[] = [
  { value: "1K", costPerImageUsd: 0.0909, creditWeight: 1 },
];

/** FLUX.2 Pro, the admin-only fallback lane: one band, unchanged. */
const FLUX_OFFERS: readonly ImageResolutionOffer[] = [
  { value: "1K", costPerImageUsd: 0.04, creditWeight: 1 },
];

const OFFERS: Record<string, readonly ImageResolutionOffer[]> = {
  gemini: GEMINI_OFFERS,
  "gpt-image": GPT_OFFERS,
  flux: FLUX_OFFERS,
};

/**
 * The shapes a lane can actually render.
 *
 * GPT's three come from its endpoint's size enum (1:1 = 1024x1024, 3:2 =
 * 1536x1024, 2:3 = 1024x1536) — anything else it simply cannot do, so
 * offering it would be a control that lies. Nano Banana Pro takes fal's
 * whole aspect_ratio enum minus "auto", which this lane never sends: auto
 * follows the first input picture, which is how a square shot came back in
 * the shape of a character's anchor photo (fixed 2026-09-23).
 */
const ASPECTS: Record<string, readonly ImageAspect[]> = {
  gemini: IMAGE_ASPECTS,
  "gpt-image": ["3:2", "1:1", "2:3"],
  flux: ["1:1"],
};

/** The lane's default shape. Square everywhere: it is what every take has always been. */
export const DEFAULT_IMAGE_ASPECT: ImageAspect = "1:1";

/**
 * The lane's default size. 2K on Nano Banana Pro because fal charges the
 * same for it as for 1K (see GEMINI_OFFERS); 1K everywhere else, which is
 * the only band those lanes have.
 */
export function defaultImageResolution(modelId: string): ImageResolution {
  return modelId === "gemini" ? "2K" : "1K";
}

/** Every size this lane sells, cheapest first. Unknown lane: the one-band default. */
export function imageResolutionOffers(modelId: string): readonly ImageResolutionOffer[] {
  return OFFERS[modelId] ?? GPT_OFFERS;
}

/** Every shape this lane can render, widest first. */
export function imageAspectOffers(modelId: string): readonly ImageAspect[] {
  return ASPECTS[modelId] ?? ASPECTS["gpt-image"];
}

/** Whether this lane can render that shape at all. */
export function offersImageAspect(modelId: string, aspect: string): aspect is ImageAspect {
  return (imageAspectOffers(modelId) as readonly string[]).includes(aspect);
}

/** Whether this lane sells that size at all. */
export function offersImageResolution(modelId: string, resolution: string): resolution is ImageResolution {
  return imageResolutionOffers(modelId).some((o) => o.value === resolution);
}

/**
 * Credits for ONE render at this size on this lane. Falls back to the
 * lane's default band for anything it does not sell, so a request naming a
 * size that lane has no offer for is priced — and rendered — as the default,
 * never as free.
 */
export function imageResolutionCreditWeight(modelId: string, resolution: string | null | undefined): number {
  const offers = imageResolutionOffers(modelId);
  const wanted = offers.find((o) => o.value === resolution);
  if (wanted) return wanted.creditWeight;
  const fallback = offers.find((o) => o.value === defaultImageResolution(modelId)) ?? offers[0];
  return fallback?.creditWeight ?? 1;
}

/**
 * Every offer priced at or under one credit's cost basis, and every weight
 * covering its own cost. The image half of pricingAudit() — called by the
 * test, so a provider price edited here without its weight fails the build.
 */
export function imagePricingAudit(): { modelId: string; resolution: ImageResolution; costUsd: number; weight: number; ok: boolean }[] {
  return Object.entries(OFFERS).flatMap(([modelId, offers]) =>
    offers.map((o) => ({
      modelId,
      resolution: o.value,
      costUsd: o.costPerImageUsd,
      weight: o.creditWeight,
      ok: o.creditWeight * USD_PER_CREDIT >= o.costPerImageUsd,
    })),
  );
}
