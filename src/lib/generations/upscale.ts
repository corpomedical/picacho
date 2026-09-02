// Video upscaling via FLUX Video Upscale (Black Forest Labs, FLUX-3-powered,
// released 2026-08-20; fal endpoint blackforestlabs/flux-video-upscale).
// Operator-approved from the design boards on the canvas ("Build it",
// 2026-09-02); validated with a live probe on a real Eva render the same day.
//
// THE ONE RULE THAT MUST NEVER CHANGE: creativity is pinned to 0 (precise
// mode). fal's DEFAULT is 1 — the creative mode whose own vendor docs say it
// "can change or replace identity". This product's entire pitch is that the
// face survives; the creative mode is never exposed, never configurable,
// never an experiment flag.
//
// Money (read from fal's model page 2026-09-02): billed per second of
// DELIVERED output — $0.14/s at 1080p precise. Nothing delivered, nothing
// billed, which is why every failed/cancelled upscale force-refunds in
// job-runner.ts: a failed upscale provably cost us zero.

export const UPSCALE_ENDPOINT = "blackforestlabs/flux-video-upscale";
export const UPSCALE_LABEL = "FLUX Video Upscale";

// Credits per output second, rounded up, one rate per output tier — both at
// the same ~20% margin over fal's per-second precise-mode prices at the
// house $0.28/credit basis (prices read from fal's model page 2026-09-02):
//   1080p: $0.14/s provider → 0.6 cr/s ($0.168/s revenue; 10s → 6cr $1.68)
//   4K:    $0.55/s provider → 2.4 cr/s ($0.672/s revenue; 10s → 24cr $6.72)
// The 2K tier ($0.25/s) is deliberately not offered — a middle option that
// mostly cannibalizes the two honest ends. Audited by upscale.test.ts;
// change a rate and its tests together.
export type UpscaleTier = "1080p" | "4k";

export const UPSCALE_TIERS: Record<
  UpscaleTier,
  { targetHeight: number; creditsPerSecond: number; label: string }
> = {
  "1080p": { targetHeight: 1080, creditsPerSecond: 0.6, label: "1080p" },
  "4k": { targetHeight: 2160, creditsPerSecond: 2.4, label: "4K" },
};

// Provider input caps (fal API schema, read 2026-09-02): MP4, at most 20
// seconds, at most 50 MB, at most 2K input. Enforced here BEFORE any money
// moves; fal's own rejection (which bills nothing) is the backstop.
export const UPSCALE_MAX_SECONDS = 20;
export const UPSCALE_MAX_BYTES = 50 * 1024 * 1024;

// upscale_factor is what the API takes (1.5-3.0), so a tier is AVAILABLE
// for a source exactly when targetHeight/sourceHeight sits inside that
// window — the factor is then sent exactly, never clamped, so the output
// always lands on the tier whose rate priced the job:
//   1080p: sources 360-720p   (720p renders → factor 1.5)
//   4K:    sources 720-1440p  (720p renders → factor 3 = 3840×2160, 8.3MP,
//          comfortably under the API's ~14.4MP frame cap)
// fal's input cap is 2K (1440p), so past 1440p nothing is offered at all.
export const UPSCALE_MIN_FACTOR = 1.5;
export const UPSCALE_MAX_FACTOR = 3;
export const UPSCALE_MAX_INPUT_HEIGHT = 1440;

// What each engine actually renders at, for takes (uploads are probed).
// Everything standard is 720p; MiniMax H3 sends 768p explicitly (see the
// resolution note in fal.ts) — which the 4K window covers (2160/768 ≈ 2.8)
// even though the 1080p window cannot (1080/768 < 1.5).
export const ENGINE_SOURCE_HEIGHT_DEFAULT = 720;
export const ENGINE_SOURCE_HEIGHTS: Record<string, number> = {
  "minimax-h3": 768,
};

// The model id the upscaled row records. Not in VIDEO_MODELS — it is a
// post-process lane, never a composer choice.
export const UPSCALE_MODEL_ID = "flux-upscale";

export function upscaleCreditCost(seconds: number, tier: UpscaleTier): number {
  return Math.max(1, Math.ceil(seconds * UPSCALE_TIERS[tier].creditsPerSecond));
}

/** The exact factor that lands a source on a tier's target — only valid for
 *  tiers availableUpscaleTiers() returned for that height. */
export function upscaleFactor(sourceHeight: number, tier: UpscaleTier): number {
  return UPSCALE_TIERS[tier].targetHeight / sourceHeight;
}

/** Which output tiers this source height can honestly reach (factor inside
 *  the API window, so the delivered output bills at the priced tier). */
export function availableUpscaleTiers(sourceHeight: number): UpscaleTier[] {
  if (sourceHeight <= 0 || sourceHeight > UPSCALE_MAX_INPUT_HEIGHT) return [];
  const out: UpscaleTier[] = [];
  for (const tier of ["1080p", "4k"] as const) {
    const factor = UPSCALE_TIERS[tier].targetHeight / sourceHeight;
    // Tiny epsilon so exact boundaries (2160/1440 = 1.5, 1080/360 = 3)
    // survive floating point.
    if (factor >= UPSCALE_MIN_FACTOR - 1e-9 && factor <= UPSCALE_MAX_FACTOR + 1e-9) out.push(tier);
  }
  return out;
}

/** A take's source height, from the engine that rendered it. */
export function takeSourceHeight(videoModelId: string | null): number {
  return (videoModelId && ENGINE_SOURCE_HEIGHTS[videoModelId]) || ENGINE_SOURCE_HEIGHT_DEFAULT;
}

export type UpscaleIneligibility =
  | "not-video"
  | "not-succeeded"
  | "too-long"
  | "already-upscaled";

/**
 * Whether a finished take may be upscaled. Pure so both the History page
 * (which decides whether to show the action) and the server action (which
 * decides whether to take the money) run the same rule.
 */
export function takeUpscaleIneligibility(row: {
  content_type: string | null;
  status: string | null;
  video_duration_seconds: number | null;
  video_model_id: string | null;
  source_generation_id?: string | null;
}): UpscaleIneligibility | null {
  if (row.content_type !== "video") return "not-video";
  if (row.status !== "succeeded") return "not-succeeded";
  const seconds = row.video_duration_seconds ?? 0;
  if (seconds <= 0 || seconds > UPSCALE_MAX_SECONDS) return "too-long";
  // No upscaling an upscale: the second pass would pay full price to
  // regenerate detail the first pass already invented.
  if (row.video_model_id === UPSCALE_MODEL_ID) return "already-upscaled";
  if (row.source_generation_id) return "already-upscaled";
  return null;
}

/** Upload-lane validation, shared shape: null means eligible for at least
 *  one tier (which tiers exactly: availableUpscaleTiers(height)). */
export function uploadUpscaleIneligibility(meta: {
  seconds: number;
  bytes: number;
  height: number;
  mimeType: string;
}): "not-mp4" | "too-long" | "too-big" | "too-sharp" | null {
  if (meta.mimeType !== "video/mp4") return "not-mp4";
  if (meta.seconds <= 0 || meta.seconds > UPSCALE_MAX_SECONDS) return "too-long";
  if (meta.bytes <= 0 || meta.bytes > UPSCALE_MAX_BYTES) return "too-big";
  // Past fal's 2K input cap no tier is reachable.
  if (availableUpscaleTiers(meta.height).length === 0) return "too-sharp";
  return null;
}
