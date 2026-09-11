// Every sentence the Sets server code returns (2026-09-10). English is the
// wire format, as everywhere in the app: lib/i18n/server-text.ts maps each
// one to the four catalogs at display time, and truth-contracts.test.ts pins
// this file's sentences against that map — reword one here and the suite
// fails until the map and the catalogs follow.
//
// A plain module because "use server" files may export only async
// functions.

import type { SetKind } from "./types";

export const SETS_SESSION_EXPIRED = "Your session expired — please log in again.";
export const SETS_UNAVAILABLE = "Sets aren't available right now.";
export const SETS_NOT_OPEN = "Sets are in private testing and aren't part of any plan yet.";
export const SETS_SUSPENDED = "This account is suspended.";
export const SET_NOT_FOUND = "That set isn't available.";
export const SET_NOT_READY = "This set is still being built.";

export const SET_BRIEF_TOO_SHORT = "Describe the place in a few more words.";
export const SET_BRIEF_TOO_LONG = "Keep the description under 500 characters.";
export const SET_BUILD_TOO_FAST = "You're building sets quickly — give it a minute and try again.";
export const SET_BUILD_COULDNT_START = "The set couldn't be started — try again in a moment.";
/** Pattern: localizeServerText reads the count back out of it. */
export function setMonthlyCapMessage(used: number): string {
  if (used === 1) return SET_MONTHLY_CAP_ONE;
  return `You've built ${used} sets this billing month — the limit on your plan. It resets with your billing period.`;
}
export const SET_MONTHLY_CAP_ONE =
  "You've built 1 set this billing month — the limit on your plan. It resets with your billing period.";

export const SET_BUILD_FAILED = "This set couldn't be built, and the build is back in your allowance. Try describing the place differently.";
export const SET_BUILD_REFUSED = "This set couldn't be built from that description. The build is back in your allowance.";
export const SET_BUILD_LOST = "This build took too long and was lost. The build is back in your allowance — try again.";
/** Our side or OpenAI's failed, not the description: nothing to reword. */
export const SET_BUILD_FAILED_RETRY = "This set couldn't be built this time, and the build is back in your allowance. Try again in a moment.";

export const SET_FRAME_UNREADABLE = "That frame couldn't be read — try again.";
export const SET_FRAME_TOO_LARGE = "That frame is too large — try again.";
export const SET_FRAME_SAVE_FAILED = "Couldn't save the frame — try again.";
export const SET_PICK_CHARACTER = "Pick one of your characters to shoot in this set.";
export const SET_SHOOT_TOO_FAST = "You're shooting quickly — give it a moment.";
export const SET_DELETE_FAILED = "Couldn't delete this set — try again.";
export const SET_SAVE_FAILED = "Couldn't save that — try again.";

// Sets from a photo (docs 3.2, 2026-09-11). The first four are said by the
// browser as well as the server (photo-client.ts reads the photo before it
// is sent), so both are localized by the one map.
export const SET_PHOTO_UNREADABLE = "That photo couldn't be read — try a JPEG, PNG or WebP.";
export const SET_PHOTO_TOO_LARGE = "That photo is too large — try a smaller one.";
export const SET_PHOTO_TOO_SMALL = "That photo is too small — use one at least 640 pixels on its shorter side.";
export const SET_PHOTO_BAD_SHAPE = "That photo is too wide or too tall — use an ordinary photo, not a panorama.";
// One sentence for every refusal of a photo — our picture check's, or
// OpenAI's refusing the build — so it never says which reader refused. True
// on every path: a refused build is released or never counts.
export const SET_PHOTO_REFUSED = "This photo can't be used to build a set. Nothing came off your allowance.";
export const SET_PHOTO_UNCHECKED = "We couldn't check this photo, so no set was started. Try again in a moment.";
/** Admins only (photo sets are admins-only): the columns the build writes are not there yet. */
export const SET_PHOTO_NEEDS_DATABASE = "Photo sets need a database update first (astra-photo-sets.sql).";
export const SET_PHOTO_SAVE_FAILED = "Couldn't save the photo — try again.";
export const SET_PHOTO_BUILD_FAILED =
  "This set couldn't be built from that photo, and the build is back in your allowance. A photo that shows more of the place may work better.";

/**
 * A failed build's stored reason → the sentence shown for it. Only an
 * answer that came back unusable (invalid, or too long to finish) is a
 * reason to describe the place differently — or, for a photo build, to try
 * a photo that shows more of it; a start, save, poll or provider failure is
 * ours, and says try again.
 */
export function setFailureMessage(failure: string | null | undefined, kind: SetKind = "text"): string {
  if (failure === "refused") return kind === "photo" ? SET_PHOTO_REFUSED : SET_BUILD_REFUSED;
  if (failure === "lost" || failure === "expired") return SET_BUILD_LOST;
  if (failure === "invalid" || failure === "incomplete") return kind === "photo" ? SET_PHOTO_BUILD_FAILED : SET_BUILD_FAILED;
  return SET_BUILD_FAILED_RETRY;
}
