// The origin a media URL must carry before it is handed to a provider that
// DOWNLOADS it (2026-09-04).
//
// Its own alias-free module so it can be unit-tested — same reasoning as
// frame-url.ts and refund-rules.ts. job-runner.ts imports the whole provider
// chain through "@/" aliases, which vitest (running with no config here)
// cannot resolve, so the rule itself has to live outside it.
//
// WHY THIS EXISTS. Since persistGeneratedVideo (2026-09-04) a finished video
// is ours: generations.result_url and generation_jobs.payload.videoUrl both
// hold the relative form, "/api/media/generated-videos/<user>/<uuid>.mp4?v=…".
// That is correct for storage and for the app, which serves relative media
// URLs everywhere. It is NOT a thing fal.ai can fetch from its own network,
// and two call sites in job-runner handed it straight over:
//
//   * submitLipSyncJob's video_url — fal ACCEPTS the submit and then fails
//     the download, so every spoken line shipped silent (422
//     file_download_error, reproduced on minimax-h3 and gemini-omni).
//   * extractVideoFrame's video_url — canExtractFrameFrom rejects anything
//     not starting with "http", so identity scoring returned null and the
//     whole block was skipped, silently and without a log line.
//
// Absolutizing is sufficient: /api/media takes no session. The route does a
// bucket whitelist plus a constant-time HMAC compare, and the HMAC covers
// only "bucket/path" — so it is neither host-bound nor expiring, and fal
// already downloads absolutized /api/media reference IMAGES successfully in
// these very same generations.

import { absolutizeMediaUrl } from "../../media/url";

// Matches origin.ts's own last-resort fallback. Both picacho.io and
// picacho.ai are live; picacho.io is the one NEXT_PUBLIC_SITE_URL is
// documented to be set to.
const CANONICAL_ORIGIN = "https://picacho.io";

/**
 * The origin to build provider-facing media URLs on.
 *
 * DELIBERATELY NOT getOrigin(). getOrigin() is the right answer for a
 * user-facing redirect and the wrong one here, for two independent reasons:
 *
 * 1. It reads headers(), a request-scoped API. advanceGeneration has four
 *    drivers — the poll server action, fal's webhook, byteplus's webhook, and
 *    reapStaleJobs — and the reaper is a background sweeper that only happens
 *    to be invoked from a request today. The day it moves to a cron or a
 *    queue, headers() throws; and at the lip-sync call site that throw lands
 *    in the catch that ships the video silent and refunds the surcharge —
 *    i.e. exactly the bug this module fixes, resurrected in a form that looks
 *    like a provider fault instead of a bug. A request-free basis cannot fail
 *    that way.
 * 2. What getOrigin() computes is "the host this browser came in on", because
 *    a redirect has to keep the Supabase auth cookie. fal has no cookie and
 *    no session. What it needs is a host reachable from ITS network, and
 *    NEXT_PUBLIC_SITE_URL is already the project's assertion of exactly that:
 *    webhookUrl() in fal.ts builds fal's callback from this same variable. If
 *    fal can POST to `${NEXT_PUBLIC_SITE_URL}/api/webhooks/fal`, it can GET
 *    `${NEXT_PUBLIC_SITE_URL}/api/media/…`.
 *
 * Nothing is lost by leaving the request's host: the media signature covers
 * only bucket+path, so it verifies identically on picacho.io and picacho.ai.
 *
 * A *.vercel.app value is ignored for the same reason origin.ts ignores it —
 * a deployment URL is not a stable public identity for this app.
 */
export function providerMediaOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured && !configured.includes(".vercel.app")) {
    return configured.replace(/\/$/, "");
  }
  return CANONICAL_ORIGIN;
}

/**
 * The form of a stored media URL to hand a provider that will download it.
 *
 * Use ONLY for the value crossing the wire. The relative form is what gets
 * persisted as result_url / payload.videoUrl, and must stay relative — the
 * app serves media relatively everywhere, and toMediaUrl() re-signs the
 * relative form on every render so a signing-key rotation heals in place.
 *
 * Anything already absolute (a provider CDN URL, from the persist-failed
 * fallback path) passes through untouched.
 */
export function providerDownloadUrl(url: string): string {
  return absolutizeMediaUrl(url, providerMediaOrigin());
}
