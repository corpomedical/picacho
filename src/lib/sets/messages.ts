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
export const SETS_UNAVAILABLE = "Helios isn't available right now.";
export const SETS_NOT_OPEN = "Helios is part of the paid plans. Upgrade in Settings → Usage & plan.";
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

// The Recce (board K cut 1, 2026-09-17): a set from a clip. The first three
// are said by the browser as well as the server (recce-client.ts reads the
// clip before anything is sent), so both are localized by the one map. What
// goes wrong with the chosen frame itself speaks in the photo sentences
// above — a recce IS a photo build once its frame is chosen.
export const SET_CLIP_UNREADABLE = "That clip couldn't be read — try an MP4, MOV or WebM.";
export const SET_CLIP_LENGTH = "The clip must be between 3 and 30 seconds.";
export const SET_CLIP_TOO_LARGE = "That clip is too large — try a shorter or smaller one.";
/** The reader failed or answered no shape: nothing spent, nothing stored. */
export const SET_RECCE_COULDNT_READ = "The clip couldn't be read this time — try again in a moment.";
// One sentence for every refusal of a clip — the words the read produced,
// the chosen frame, or OpenAI refusing the build — so it never says which
// reader refused. True on every path: released, or never counted.
export const SET_RECCE_REFUSED = "This clip can't be used to build a set. Nothing came off your allowance.";
/** Admins only (recces are admins-only): the column the build writes is not there yet. */
export const SET_RECCE_NEEDS_DATABASE = "Clip sets need a database update first (astra-recce.sql).";

// Match this shot (docs 3.2, 2026-09-11). The picture's own problems (can't
// be read, too small, too large, the wrong shape) are the photo sentences
// above, from the same checks. A match takes nothing off any allowance, so
// none of these says anything about one. One sentence for every refusal —
// the picture check's, or OpenAI's refusing the read — as for a photo.
export const SET_MATCH_REFUSED = "This picture can't be used to match a shot.";
export const SET_MATCH_UNCHECKED = "We couldn't check this picture, so no shot was matched. Try again in a moment.";
/** The answer came back unusable: another picture may read better. */
export const SET_MATCH_FAILED = "Astra couldn't read a camera from that picture — try another.";
/** Our side or OpenAI's failed, not the picture: the same one, again. */
export const SET_MATCH_COULDNT_READ = "The shot's camera couldn't be read this time — try again in a moment.";
export const SET_MATCH_TOO_FAST = "You're matching shots quickly — try again in a little while.";
export const SET_MATCH_TIMED_OUT = "Reading that shot's camera took too long — try again in a moment.";

// The Set Editor's Astra edits (2026-09-14) — the prompt bar's line when a
// change could not land. The person's own words refused by the gate say the
// gate's sentence; these cover Astra's side.
export const SET_EDIT_FAILED = "Astra couldn't make that change — try saying it differently.";
export const SET_EDIT_REFUSED = "That change can't be made here.";
export const SET_EDIT_TOO_FAST = "You're changing the set quickly — give it a moment.";
/** The rig check (rig-check.ts): never a gate — the still is kept either way. */
export const SET_RIG_CHECK_FAILED = "The rig check couldn't read this still — the still is kept as it is.";
export const SET_RIG_CHECK_TOO_FAST = "You're checking stills quickly — give it a moment.";
export const SET_EDIT_TIMED_OUT = "That change took too long — try again in a moment.";
/** The working copy is past what Astra can answer whole (set-config.ts SET_EDIT_MAX_SPEC_CHARS). */
export const SET_EDIT_TOO_BIG = "This set has grown too big for Astra to rewrite in one answer — change it with the editor's own tools.";
/** Pattern: localizeServerText reads the count back out of it (set-config.ts SET_EDITS_MONTHLY_LIMITS). */
export function setEditMonthlyCapMessage(used: number): string {
  if (used === 1) return SET_EDIT_MONTHLY_CAP_ONE;
  return `You've asked Astra for ${used} changes this billing month — the limit on your plan. It resets with your billing period; the editor's own tools still work.`;
}
export const SET_EDIT_MONTHLY_CAP_ONE =
  "You've asked Astra for 1 change this billing month — the limit on your plan. It resets with your billing period; the editor's own tools still work.";

// Takes (2026-09-15): a clip from one still to a newly shot end frame.
export const SET_TAKE_BAD_START = "That still can't start a take — pick another.";
export const SET_TAKE_FAILED = "The end frame is in, but the take couldn't start — try the take again in a moment.";
/**
 * Takes and films are every paid plan's (set-config.ts setTakesEligible,
 * 2026-09-19 "Open to all plans"): said before anything is shot, never
 * after a still has been paid for. Reachable only with no paid plan at all.
 */
export const SET_TAKE_NEEDS_PLAN = "Takes and films are part of the paid plans. Upgrade in Settings → Usage & plan.";
/** A film beat's clip rendered again on its own end still, and that still is gone (film.ts filmJobs). */
export const SET_TAKE_BAD_END = "That beat's end frame is gone — render again to shoot a new one.";

/**
 * A read that did not come back → the sentence shown, by the provider's
 * failure kind (providers/astra.ts), or "invalid" for an answer that came
 * back but is not a camera. The rule setFailureMessage keeps: only an answer
 * that came back unusable (invalid, or too long to finish) asks for another
 * picture; a start or poll failure — no key, a rate limit, an outage, a job
 * that expired or failed — is ours or OpenAI's, and says try again.
 */
export function matchFailureMessage(failure: string): string {
  if (failure === "refused") return SET_MATCH_REFUSED;
  if (failure === "invalid" || failure === "incomplete") return SET_MATCH_FAILED;
  return SET_MATCH_COULDNT_READ;
}

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
