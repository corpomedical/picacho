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

// 0.6 credits per output second, rounded up: at the house $0.28/credit basis
// that is $0.168/s of revenue against $0.14/s of provider cost — a uniform
// ~20% margin at every length (5s → 3cr $0.84, 10s → 6cr $1.68, 15s → 9cr
// $2.52, 20s → 12cr $3.36). Audited alongside every other price via the
// tests in upscale.test.ts; change rate and tests together.
export const UPSCALE_CREDITS_PER_SECOND = 0.6;

// Provider input caps (fal API schema, read 2026-09-02): MP4, at most 20
// seconds, at most 50 MB, at most 2K input. Enforced here BEFORE any money
// moves; fal's own rejection (which bills nothing) is the backstop.
export const UPSCALE_MAX_SECONDS = 20;
export const UPSCALE_MAX_BYTES = 50 * 1024 * 1024;

// v1 output target is 1080p. upscale_factor is what the API takes (1.5-3.0),
// so the target divides by the source height — and sources at or above 1080p
// have nothing to gain at this tier (factor would fall below the API minimum
// and the output would bill beyond the 1080p rate the credit price is built
// on). The 2K/4K tiers are a later, separately priced decision.
export const UPSCALE_TARGET_HEIGHT = 1080;
export const UPSCALE_MIN_FACTOR = 1.5;
export const UPSCALE_MAX_FACTOR = 3;
export const UPSCALE_MAX_SOURCE_HEIGHT = 720;

// Engines whose output is NOT the standard 720p the factor math assumes.
// MiniMax H3 renders 768p (fal.ts sends 768p explicitly — see the resolution
// note there): 1080/768 falls below the API's minimum factor, so its output
// would land past 1080p and bill at an unknown tier. Excluded until the 2K
// tier is priced deliberately.
export const UPSCALE_EXCLUDED_MODEL_IDS = new Set(["minimax-h3"]);

// The model id the upscaled row records. Not in VIDEO_MODELS — it is a
// post-process lane, never a composer choice.
export const UPSCALE_MODEL_ID = "flux-upscale";

export function upscaleCreditCost(seconds: number): number {
  return Math.max(1, Math.ceil(seconds * UPSCALE_CREDITS_PER_SECOND));
}

/** The factor that lands an eligible source on the 1080p target. */
export function upscaleFactor(sourceHeight: number): number {
  const exact = UPSCALE_TARGET_HEIGHT / sourceHeight;
  return Math.min(UPSCALE_MAX_FACTOR, Math.max(UPSCALE_MIN_FACTOR, exact));
}

export type UpscaleIneligibility =
  | "not-video"
  | "not-succeeded"
  | "too-long"
  | "already-upscaled"
  | "excluded-engine";

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
  if (row.video_model_id && UPSCALE_EXCLUDED_MODEL_IDS.has(row.video_model_id)) {
    return "excluded-engine";
  }
  return null;
}

/** Upload-lane validation, shared shape: null means eligible. */
export function uploadUpscaleIneligibility(meta: {
  seconds: number;
  bytes: number;
  height: number;
  mimeType: string;
}): "not-mp4" | "too-long" | "too-big" | "too-sharp" | null {
  if (meta.mimeType !== "video/mp4") return "not-mp4";
  if (meta.seconds <= 0 || meta.seconds > UPSCALE_MAX_SECONDS) return "too-long";
  if (meta.bytes <= 0 || meta.bytes > UPSCALE_MAX_BYTES) return "too-big";
  // At or past the target there is nothing to upscale to at this tier.
  if (meta.height > UPSCALE_MAX_SOURCE_HEIGHT) return "too-sharp";
  return null;
}
