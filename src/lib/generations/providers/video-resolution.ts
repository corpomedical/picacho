// Output resolution, and what it costs (2026-08-30).
//
// Its own alias-free module so it can be unit-tested — same reasoning as
// frame-url.ts and refund-rules.ts. video-models.ts imports "@/lib/plans"
// partway down for FREE_TIER_VIDEO_MODEL_ID, which vitest (running with no
// config in this repo) cannot resolve, so the rules that decide what a
// render COSTS have to live outside it. Keyed on model id, not a VideoModel
// object, for the same reason.
//
// THE RULE THIS DELIBERATELY CHANGES. video-models.ts records a decision to
// refuse "pricing every model by a duration x resolution matrix rather than
// duration alone". A free 1080p toggle honoured that rule by never changing
// a price. 4K does not: it bills 1.5x with audio, so it needs a real credit
// weight and this module IS that matrix — kept to one small explicit table
// rather than spread through the catalogue, so there is exactly one place to
// read when a provider changes its prices.
//
// Every weight here is computed the same way as every other weight in this
// codebase: provider cost / $0.28 per credit, rounded UP. Rounding down
// would sell the most expensive option in the catalogue at a loss.

// "2k" added 2026-09-01 with the MiniMax H3 lane. Note these are OUR values,
// not the provider's spelling — each branch in fal.ts maps them to whatever
// its own endpoint's enum wants (H3's is "480P" | "768P" | "2K" | "4K", with
// that exact capitalisation).
export type VideoResolution = "1080p" | "2k" | "4k";

export type ResolutionOffer = {
  value: VideoResolution;
  /**
   * Provider cost per second AT THIS RESOLUTION, with audio on. Absent means
   * the provider bills it the same as the model's base costPerSecondUsd.
   * Kept here rather than only in the weights so pricingAudit() can check
   * this row for drift the same way it checks every duration — the weights
   * below are derived from this number, and the two must never disagree.
   */
  costPerSecondUsd?: number;
  /**
   * Total credit weight per duration at this resolution. Absent means the
   * provider bills it IDENTICALLY to the model's default resolution, so the
   * base duration weight already covers it and the upgrade is free.
   */
  weights?: Record<number, number>;
};

// Veo 3.1, verbatim from fal's own model page 2026-08-30:
//   "For every second of video you generate you will be charged $0.20
//    without audio or $0.40 with audio for 720p or 1080p. At 4k, you will
//    be charged $0.40 per second without audio, or $0.60 with."
//
// Audio is on by default for Veo (see generateNativeAudio in fal.ts), so the
// prices that actually apply are $0.40/sec at 720p-or-1080p and $0.60/sec at
// 4K — exactly 1.5x.
//
// 1080p carries no weights: same price as the 720p both Veo endpoints
// default to, so every Veo render before this existed was taking the lower
// resolution at a price that already covered the higher one.
//
// 4K weights, cost / $0.28 rounded up — deliberately derived from the real
// per-second price rather than by scaling the base weight, because the base
// weights were themselves rounded up and compounding that would overcharge:
//   4s -> 4  x $0.60 = $2.40 -> 8.57  -> 9   (base 6)
//   6s -> 6  x $0.60 = $3.60 -> 12.86 -> 13  (base 9; scaling 9 x 1.5 = 14, one credit too many)
//   8s -> 8  x $0.60 = $4.80 -> 17.14 -> 18  (base 12)
// MiniMax H3, verbatim from fal's own model page 2026-09-01:
//   "Video costs $0.05 per second at 480p, $0.06 per second at 768p, $0.13
//    per second at 2K and $0.16 per second at 4K; the first 5 reference
//    images are free and each additional image costs $0.08."
//
// The lane renders at 768P ($0.06/sec), which is what its base weights in
// video-models.ts are built on, so 2K is a genuine paid upgrade rather than
// a free one — no weightless row here.
//
// 2K weights, cost / $0.28 rounded up, derived from the per-second price
// rather than by scaling the base weight (same reasoning as Veo's 4K above —
// the base weights were themselves rounded up and compounding that would
// overcharge):
//    5s -> 5  x $0.13 = $0.65 -> 2.32 -> 3   (base 2)
//   10s -> 10 x $0.13 = $1.30 -> 4.64 -> 5   (base 3; scaling 3 x 2.17 = 7, two credits too many)
//   15s -> 15 x $0.13 = $1.95 -> 6.96 -> 7   (base 4)
//
// 480P ($0.05/sec) is deliberately NOT offered. This module's contract is
// resolutions ABOVE the model's default — a cheaper tier would need a
// negative weight it has no way to express, and the saving is a quarter of
// one credit at 5s, which cannot be charged for anyway.
const OFFERS: Record<string, ResolutionOffer[]> = {
  veo: [
    { value: "1080p" },
    { value: "4k", costPerSecondUsd: 0.6, weights: { 4: 9, 6: 13, 8: 18 } },
  ],
  "minimax-h3": [
    { value: "2k", costPerSecondUsd: 0.13, weights: { 5: 3, 10: 5, 15: 7 } },
  ],
  // Gemini Omni Flash 1.1, verbatim from fal's own model page 2026-09-01:
  //   "Billing is calculated per second of output video, by resolution. For
  //    360p, your request will cost $0.03 per second; for 720p, $0.10 per
  //    second; for 1080p, $0.15 per second; and for 4K, $0.30 per second."
  //
  // The lane renders at 720p, which is what its base weights are built on,
  // so BOTH rows here are paid upgrades — neither is weightless.
  //
  // Weights are cost / $0.28 rounded up, derived from the per-second price
  // rather than scaled off the base weight (same reasoning as Veo's 4K):
  //   1080p  5s -> $0.75 -> 2.68  -> 3   (base 2)
  //   1080p  8s -> $1.20 -> 4.29  -> 5   (base 3)
  //   1080p 10s -> $1.50 -> 5.36  -> 6   (base 4)
  //   4k     5s -> $1.50 -> 5.36  -> 6
  //   4k     8s -> $2.40 -> 8.57  -> 9
  //   4k    10s -> $3.00 -> 10.71 -> 11
  //
  // Ascending order matters — the composer renders these left to right.
  "gemini-omni": [
    { value: "1080p", costPerSecondUsd: 0.15, weights: { 5: 3, 8: 5, 10: 6 } },
    { value: "4k", costPerSecondUsd: 0.30, weights: { 5: 6, 8: 9, 10: 11 } },
  ],
};

/** Resolutions this model offers above its default, in ascending order. */
export function videoResolutionOffers(modelId: string): ResolutionOffer[] {
  return OFFERS[modelId] ?? [];
}

/**
 * A sharper resolution this model renders at NO EXTRA PROVIDER COST.
 * Kept as its own function because the UI labels a free upgrade differently
 * from a paid one, and because "free" is the claim most worth being sure of.
 */
export function freeHighResolution(modelId: string): VideoResolution | null {
  return videoResolutionOffers(modelId).find((o) => !o.weights)?.value ?? null;
}

/**
 * Server-side gate. NEVER trust a resolution that arrived in form data —
 * same contract as isValidDuration in video-models.ts.
 *
 * Anything this model does not offer resolves to null, and null means "send
 * no resolution parameter at all", leaving the provider on its own default
 * and keeping behaviour byte-identical for anyone who does not ask.
 *
 * The case this exists for beyond validation: someone asks for 4K on Veo,
 * the circuit breaker reroutes them to a healthy model, and the request must
 * not carry a parameter that endpoint has never heard of — nor a credit
 * charge for a resolution it cannot render. Resolving against the FINAL
 * model id makes both impossible.
 */
export function resolveVideoResolution(
  modelId: string,
  requested: string | null | undefined,
): VideoResolution | null {
  if (!requested) return null;
  return videoResolutionOffers(modelId).find((o) => o.value === requested)?.value ?? null;
}

/**
 * The TOTAL credit weight for this render at this resolution, or null when
 * the resolution costs nothing extra and the base duration weight stands.
 *
 * Returns null for an unknown duration too: the caller falls back to
 * getDurationCreditWeight, which has its own default-duration fallback. A
 * missing row must never silently mean "free".
 */
export function resolutionCreditWeight(
  modelId: string,
  resolution: VideoResolution | null | undefined,
  seconds: number,
): number | null {
  if (!resolution) return null;
  const offer = videoResolutionOffers(modelId).find((o) => o.value === resolution);
  return offer?.weights?.[seconds] ?? null;
}

/**
 * What this resolution ADDS to the render, in credits, for display. Zero for
 * a free upgrade. The composer shows this before anything is spent — a paid
 * resolution the person cannot see the price of is exactly the kind of claim
 * this codebase has been cleaning up.
 */
export function resolutionExtraCredits(
  modelId: string,
  resolution: VideoResolution | null | undefined,
  seconds: number,
  baseWeight: number,
): number {
  const total = resolutionCreditWeight(modelId, resolution, seconds);
  return total === null ? 0 : Math.max(0, total - baseWeight);
}
