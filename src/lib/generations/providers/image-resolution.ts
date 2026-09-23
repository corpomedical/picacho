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
 * How hard the model works on one picture (2026-09-24, the operator: "Give
 * the user the option to chose from High to max. Only for paid
 * subscribers"). GPT Image 2.5's own enum is low/medium/high/xhigh/max/auto;
 * only the three at the top are offered, because the lane has rendered at
 * `high` since it shipped and nothing below it is an upgrade.
 *
 * "auto" is never offered and never sent, for the reason openai-images.ts
 * pins it: the model picks, and the same request came back anywhere between
 * 196 and 1,756 output image tokens. One setting, one price.
 */
export type ImageQuality = "high" | "xhigh" | "max";
export const IMAGE_QUALITIES: readonly ImageQuality[] = ["high", "xhigh", "max"];

export type ImageQualityOffer = {
  value: ImageQuality;
  /** The worst this tier is expected to cost for one picture — see the table below. */
  costPerImageUsd: number;
  creditWeight: number;
  /** false where the figure is a bound rather than something an invoice has shown. */
  measured: boolean;
  /** Paid plans only, per the operator. Enforced server-side, not just hidden. */
  paidOnly: boolean;
};

/**
 * THE MONEY, and what is and is not measured.
 *
 * MEASURED, from our own rows (the `usage` every OpenAI answer carries, read
 * since 2026-09-14): at `high`, 1024x1024, a picture costs $0.0531 with no
 * reference photo and $0.0611 with one, and $0.0909 for a Set shot carrying
 * the expression close-ups — 1,756 output image tokens, or 1,372 with more
 * input. Output bills at $30 per million tokens.
 *
 * NOT MEASURED, because OpenAI does not publish it: how many output tokens
 * `xhigh` and `max` spend. Their own pricing page says the GPT Image 2
 * calculator does not estimate 2.5's consumption, so the only honest source
 * is an invoice, and no request has been sent at either tier.
 *
 * So these two weights are BOUNDS, not measurements, and they are set the
 * way this codebase sets every weight — so that being wrong costs us
 * nothing:
 *
 *   high   1,756 tok x $30/1M                  = $0.053  -> 1 credit
 *   xhigh  assume up to 3x high, at 3:2 (1.5x) = $0.237  -> 1 credit
 *   max    assume up to 4x high, at 3:2 (1.5x) = $0.316  -> 2 credits
 *
 * The 3x/4x figures come from the only published precedent for this shape —
 * gpt-image-1's own low/medium/high token counts at 1024x1024 rose roughly
 * fourfold across two steps — and the 1.5x is real: 1536x1024 is 1.5 times
 * the square's pixels, and this lane offers that shape.
 *
 * What this means in practice: `xhigh` cannot lose money unless it costs
 * more than four times `high`, and `max` is charged two credits until an
 * invoice says otherwise. MEASURE BOTH AND COME BACK — a probe of two
 * renders reads the real `usage` off the answers, and if `max` lands under
 * $0.28 this table should drop it to one credit rather than keep overcharging.
 */
const GPT_QUALITY_OFFERS: readonly ImageQualityOffer[] = [
  { value: "high", costPerImageUsd: 0.0909, creditWeight: 1, measured: true, paidOnly: false },
  { value: "xhigh", costPerImageUsd: 0.237, creditWeight: weigh(0.237), measured: false, paidOnly: true },
  { value: "max", costPerImageUsd: 0.316, creditWeight: weigh(0.316), measured: false, paidOnly: true },
];

/**
 * Lanes with no quality control of their own. fal's Nano Banana Pro endpoint
 * takes no such parameter — its schema is prompt, image_urls, resolution,
 * aspect_ratio, output_format, seed, safety_tolerance, system_prompt — so
 * offering one there would be a control that changes nothing.
 */
const NO_QUALITY: readonly ImageQualityOffer[] = [];

const QUALITIES: Record<string, readonly ImageQualityOffer[]> = {
  "gpt-image": GPT_QUALITY_OFFERS,
  gemini: NO_QUALITY,
  flux: NO_QUALITY,
};

/** What a picture renders at when nobody picks: the tier this lane has always used. */
export const DEFAULT_IMAGE_QUALITY: ImageQuality = "high";

/** Every quality this lane sells, cheapest first; empty where the lane has no such control. */
export function imageQualityOffers(modelId: string): readonly ImageQualityOffer[] {
  return QUALITIES[modelId] ?? NO_QUALITY;
}

/** Whether this lane can render at that quality at all. */
export function offersImageQuality(modelId: string, quality: string): quality is ImageQuality {
  return imageQualityOffers(modelId).some((o) => o.value === quality);
}

/** Whether that tier needs a paid plan (the operator: "Only for paid subscribers"). */
export function imageQualityIsPaidOnly(modelId: string, quality: string): boolean {
  return imageQualityOffers(modelId).some((o) => o.value === quality && o.paidOnly);
}


/**
 * Credits for ONE render at this quality. A lane with no quality control
 * costs 1 from this dimension — it is priced by its size instead.
 */
export function imageQualityCreditWeight(modelId: string, quality: string | null | undefined): number {
  const offers = imageQualityOffers(modelId);
  if (offers.length === 0) return 1;
  const wanted = offers.find((o) => o.value === quality);
  if (wanted) return wanted.creditWeight;
  return offers.find((o) => o.value === DEFAULT_IMAGE_QUALITY)?.creditWeight ?? 1;
}

/**
 * What ONE picture costs in credits, both dimensions together.
 *
 * Every lane today is priced along exactly ONE of them — Nano Banana Pro by
 * its size (4K doubles), GPT Image by its quality (the model's own enum, one
 * size band) — so the larger of the two weights IS the price, and the other
 * dimension contributes its floor of 1. A test asserts that no lane tiers
 * both; the day one does, this has to become a real cost product rather than
 * a max, or a 4K-at-max render would be charged as if it were only one of
 * the two.
 */
export function imageRenderCreditWeight(
  modelId: string,
  resolution: string | null | undefined,
  quality: string | null | undefined,
): number {
  return Math.max(imageResolutionCreditWeight(modelId, resolution), imageQualityCreditWeight(modelId, quality));
}

/** True when a lane charges more for BOTH a bigger size and a harder render — see imageRenderCreditWeight. */
export function laneTiersBothDimensions(modelId: string): boolean {
  const sizes = new Set(imageResolutionOffers(modelId).map((o) => o.creditWeight));
  const qualities = new Set(imageQualityOffers(modelId).map((o) => o.creditWeight));
  return sizes.size > 1 && qualities.size > 1;
}

/**
 * Every offer priced at or under one credit's cost basis, and every weight
 * covering its own cost. The image half of pricingAudit() — called by the
 * test, so a provider price edited here without its weight fails the build.
 */
export function imagePricingAudit(): { modelId: string; band: string; costUsd: number; weight: number; ok: boolean }[] {
  const rows = Object.entries(OFFERS).flatMap(([modelId, offers]) =>
    offers.map((o) => ({
      modelId,
      band: o.value as string,
      costUsd: o.costPerImageUsd,
      weight: o.creditWeight,
      ok: o.creditWeight * USD_PER_CREDIT >= o.costPerImageUsd,
    })),
  );
  const qualityRows = Object.entries(QUALITIES).flatMap(([modelId, offers]) =>
    offers.map((o) => ({
      modelId,
      band: o.value as string,
      costUsd: o.costPerImageUsd,
      weight: o.creditWeight,
      ok: o.creditWeight * USD_PER_CREDIT >= o.costPerImageUsd,
    })),
  );
  return [...rows, ...qualityRows];
}
