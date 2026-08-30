// Frame-grab rules for video identity scoring (2026-08-30).
//
// Its own alias-free module so it can be unit-tested — same reasoning as
// refund-rules.ts and report-constants.ts. fal.ts imports the whole provider
// chain through "@/" aliases, which vitest (running with no config here)
// cannot resolve, so anything worth a test has to live outside it.

// WHICH FRAME, AND WHY IT IS NOT THE FIRST ONE.
//
// Four of the seven video lanes anchor identity by handing the model the
// character's reference photo AS the opening frame — mechanism "first-frame"
// for kling-o3 and kling-2.5, see MODEL_CAPABILITIES in send-plan.ts. On
// those lanes frame one IS the identity photo, so scoring it would compare
// the photo against itself, return ~100 every time, and produce a number
// that looks like proof while measuring nothing at all.
//
// The middle frame is the first point where the model has had to hold the
// face on its own. fal's extract-frame endpoint takes an enum, and "middle"
// is one of its three allowed values ("first" | "middle" | "last");
// "first" is the endpoint default, which is precisely the trap.
export const IDENTITY_FRAME_TYPE = "middle";

// fal.ai DOWNLOADS the URL from its own servers, so it has to be absolute
// and publicly reachable.
//
// Two kinds of stored result_url are neither, and both are real rows in the
// generations table right now:
//
//   * "mock://generated-result" — written by the mock pipeline whenever the
//     real_ai_providers flag is off. Verified against fal.ai on 2026-08-30:
//     this exact value returns 422 file_download_error.
//   * "/api/media/…" — a relative path through our own media route.
//
// isRenderableUrl() in lib/media/url.ts is deliberately NOT reused for this:
// it accepts the relative form, which is exactly the case that has to be
// rejected here.
export function canExtractFrameFrom(url: string | null | undefined): boolean {
  return Boolean(url && url.startsWith("http"));
}
