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
export const SETS_UNAVAILABLE = "Helios 3D isn't available right now.";
export const SETS_NOT_OPEN = "Helios 3D is part of the paid plans. Upgrade in Settings → Plan & billing.";
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
/** A reference photo (reference-actions.ts, 2026-09-21): the picture gate said no. */
export const SET_REF_REFUSED = "This photo can't be used as a reference.";
/** The picture gate could not be asked: nothing was stored. */
export const SET_REF_UNCHECKED = "We couldn't check this photo — try again in a moment.";
/** A set holds SET_REFS_MAX reference photos (set-config.ts). */
/** The burst brake on uploads. */
export const SET_REF_TOO_FAST = "That's a lot of photos at once — try again in a few minutes.";
/** Photos on the set's things (R1, 2026-09-21, element-actions.ts). */
export const SET_ELEMENT_FULL = "This thing has 4 photos — remove one to add another.";
export const SET_ELEMENT_GONE = "That thing changed on the set — tap it again.";
export const SET_ELEMENT_NOT_A_THING = "Photos go on cars and objects — a person comes from their character.";
export const SET_ELEMENTS_TOO_MANY = "A set holds 24 photos on its things — remove one to add another.";
/** A model on a thing (thing-model.ts, model-actions.ts, 2026-09-24). */
export const THING_MODEL_NOT_A_MODEL = "That file isn't a 3D model the stage can keep — pick a .glb file.";
export const THING_MODEL_TOO_BIG = "That model is over 40 MB — export it smaller and try again.";
export const THING_MODEL_ADMINS_ONLY = "Models on things are for admins while we prove them.";
export const THING_MODEL_SAVE_FAILED = "The model couldn't be kept with the set — it's only on this page for now.";
export const THING_MODEL_TOO_FAST = "That's a lot of models at once — try again in a few minutes.";
// A thing rebuilt from its photos (thing-rebuild.ts, 2026-09-24).
export const THING_REBUILD_NO_PHOTOS = "Put a photo on this thing first — Astra rebuilds it from its photos.";
export const THING_REBUILD_DIDNT_FIT = "Astra's new shape didn't fit where the old one stood, so the set is unchanged — try again.";
export const THING_REBUILD_FAILED = "Astra couldn't rebuild this from its photos — try again in a moment.";
export const THING_REBUILD_ADMINS_ONLY = "Rebuilding from photos is for admins while we prove it.";
/**
 * The thing's own blocks are past what one rebuild may send (thing-rebuild.ts
 * THING_REBUILD_MAX_SENT_CHARS, 2026-09-25): said before any photo is read
 * or anything is spent.
 */
export const THING_REBUILD_TOO_BIG = "This thing has too many blocks for Astra to rebuild in one answer — change it with the editor's own tools.";
// A thing's 3D model built from its photo (thing-build.ts, 2026-09-24).
export const THING_BUILD_NO_PHOTO = "Put a photo on this thing first — its model is built from its front photo.";
export const THING_BUILD_FAILED = "The model couldn't be built from this photo — try a clearer photo of the whole thing.";
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
/**
 * A press delivered twice (astra-press.ts, 2026-09-25, Cut 1): the second
 * delivery answers at once and the page reads back what the first one saved.
 * It never says try again — the first delivery may still land.
 */
export const SET_EDIT_STILL_WORKING = "Astra is still on that change — it will show on the set once it's saved.";
/** The page read back a press that ended without saving (astra-follow.ts): nothing changed, and nothing was counted. */
export const SET_EDIT_NOT_SAVED = "Astra didn't change the set this time — it's as it was. Try again when you're ready.";
/** The page could not read back whether a press saved (astra-follow.ts): only a reload can say. Never "try again" — that could spend a second change. */
export const SET_EDIT_UNCHECKED = "We couldn't check whether Astra saved that change — reload the set to see it.";
/**
 * The month's Astra tries are spent: its changes plus SET_EDIT_SPARE_TRIES
 * that didn't land (set-config.ts, 2026-09-25). Astra is billed for every
 * try, so it pauses until the billing period resets.
 */
export const SET_EDIT_TRIES_USED =
  "Too many of this month's Astra changes didn't land, so Astra is paused on your sets until your billing period resets. The editor's own tools still work.";
/**
 * OpenAI never made the job (providers/astra.ts neverBilled; Helios Cut 4,
 * step A2, 2026-09-26): nothing was billed, so the change AND the try come
 * back. Said only then — a try that may have been billed keeps its row.
 */
export const SET_EDIT_UNAVAILABLE = "Astra can't be reached right now — nothing was used. Try again in a few minutes.";
/**
 * The gate couldn't read Astra's answer (content-policy.ts "unavailable";
 * critic item 2): Astra answered and was billed, so the try stays counted,
 * but the set is unchanged and its change went back.
 */
export const SET_EDIT_ANSWER_UNCHECKED = "We couldn't check Astra's answer, so the set is unchanged and no change was used. Try again in a moment.";
/**
 * The month's limiter refused a change while the month's own count reads
 * under the cap, or can't be read (Helios Cut 4, step A4, 2026-09-26): the
 * limiter fails closed, so it may be an outage, not a spent month. Sent with
 * no count, so the page keeps its own.
 */
export const SET_EDIT_COUNT_UNREAD = "We couldn't check your Astra changes — try again in a moment.";
/** The working copy is past what Astra can answer whole (set-config.ts SET_EDIT_MAX_SPEC_CHARS). */
export const SET_EDIT_TOO_BIG = "This set has grown too big for Astra to rewrite in one answer — change it with the editor's own tools.";
/**
 * Pattern: localizeServerText reads the count back out of it (set-config.ts
 * SET_EDITS_MONTHLY_LIMITS). Changes "made", not "asked for", since
 * 2026-09-25: only a change that saves counts.
 */
export function setEditMonthlyCapMessage(used: number): string {
  if (used === 1) return SET_EDIT_MONTHLY_CAP_ONE;
  return `You've made ${used} changes with Astra this billing month — the limit on your plan. It resets with your billing period; the editor's own tools still work.`;
}
export const SET_EDIT_MONTHLY_CAP_ONE =
  "You've made 1 change with Astra this billing month — the limit on your plan. It resets with your billing period; the editor's own tools still work.";

// Takes (2026-09-15): a clip from one still to a newly shot end frame.
export const SET_TAKE_BAD_START = "That still can't start a take — pick another.";
/** A take's end frame did not pass its checks, so no clip was asked for (2026-09-21); the still's own reason rides beside it. */
export const SET_TAKE_END_FAILED = "The end frame didn't pass, so the take didn't start.";
/**
 * The end frame is kept and its clip was not started or charged (reworded
 * 2026-09-25, Cut 1): the old words asked for the take again, which shoots
 * and charges a new end frame when only the clip needs rendering. The page
 * offers the clip on its own; a film renders it alone on its next Render.
 */
export const SET_TAKE_FAILED = "The end frame is in, but its clip couldn't start and wasn't charged — render the clip again in a moment.";
/** A film's beat stopped before its end frame was shot, free: the film's look could not be made (2026-09-21). */
export const SET_TAKE_LOOK_DROPPED = "This beat stopped before its end frame was shot: the film's look couldn't be made this time. Nothing was charged — press Render to try again.";
/**
 * The same for a look the person picked that can never be made from its
 * still (a lasting reason, actions.ts LASTING_LOOK_DROPS; 2026-09-25): "try
 * again" looped the film on the same refusal.
 */
export const SET_TAKE_LOOK_CANT = "This beat stopped before its end frame was shot: the look picked for the film can't be made from that still. Nothing was charged — pick another look for the film, or none.";
/** The same, for a reference photo picked as the film's look. */
/** A film's beat whose thing's photo sheet was not drawn (R1, 2026-09-21): stopped before anything is shot. */
export const SET_TAKE_ELEMENT_DROPPED = "This beat stopped before its end frame was shot: a photo on one of its things couldn't be drawn this time. Nothing was charged — press Render to try again.";
/** A shot of a character whose photos have no likeness answer (R1.12, likeness.ts): the figure's card asks it. */
export const SET_LIKENESS_NEEDED = "Tell us who is in this character's photos before shooting: open the person's card on the stage.";
/**
 * A film's end frame under the identity bar: its clip is not made
 * (2026-09-21). Said when the frame's charge stands, or can't be read back
 * (2026-09-25: it never claims a refund it can't confirm).
 */
export const SET_TAKE_OFF_FACE = "This beat's end frame scored under your identity bar, so its clip wasn't made and only the frame was charged. Press Render to shoot it again.";
/** The same when the identity gate settled the frame and refunded it (its row's credits_used is 0; 2026-09-25). */
export const SET_TAKE_OFF_FACE_REFUNDED = "This beat's end frame scored under your identity bar, so its clip wasn't made and the frame was refunded. Press Render to shoot it again.";
/** The same for an end frame kept from an earlier render: nothing was shot, so nothing was charged (2026-09-25). */
export const SET_TAKE_OFF_FACE_KEPT_END = "This beat's end frame scored under your identity bar, so its clip wasn't made and nothing was charged. Press Render to shoot the beat again.";
/** A film's beat asked for with another person than its start still shows (2026-09-21). Nothing shot or charged. */
export const SET_TAKE_OTHER_PERSON = "This film opens on a still of someone else, so this beat wasn't shot and nothing was charged. Reload the page: the film is shot with the person in its opening still.";
/**
 * A single take or a clip rendered again, asked for with another person
 * than its start still shows (2026-09-25): the
 * engine morphs one person into the other, charged in full. Nothing shot or
 * charged.
 */
export const SET_TAKE_START_OTHER_PERSON = "This take starts on a still of someone else, so it wasn't shot and nothing was charged. Pick that person, or start from a still of the one you picked.";
/**
 * A film beat whose clip is rendered again on its kept end frame, and that
 * frame shows another person than the film's (review, 2026-09-25: it used to
 * say "This film opens on a still of someone else… Reload the page", which a
 * reload never cured). Nothing shot or charged; the page drops the end, so
 * the next Render shoots the beat whole.
 */
export const SET_TAKE_END_OTHER_PERSON = "This beat's end frame shows someone else, so its clip wasn't made and nothing was charged. Press Render to shoot the beat again.";
/** The same for a clip tried again on its take's end still (2026-09-25). Nothing shot or charged. */
export const SET_TAKE_RETRY_END_OTHER_PERSON = "This take ends on a still of someone else, so its clip wasn't made and nothing was charged. Shoot a new take with the person you picked.";
/**
 * Takes and films are every paid plan's (set-config.ts setTakesEligible,
 * 2026-09-19 "Open to all plans"): said before anything is shot, never
 * after a still has been paid for. Reachable only with no paid plan at all.
 */
export const SET_TAKE_NEEDS_PLAN = "Takes and films are part of the paid plans. Upgrade in Settings → Plan & billing.";
/** A film beat's clip rendered again on its own end still, and that still is gone (film.ts filmJobs). */
export const SET_TAKE_BAD_END = "That beat's end frame is gone — render again to shoot a new one.";
/**
 * The take limiter (take.ts SET_TAKES_PER_10_MIN), counted only at a
 * press's first paid step, and once per film Render (2026-09-25): said
 * before anything of this press is charged.
 */
export const SET_TAKE_TOO_FAST = "You're starting takes and films quickly — try again in a few minutes. Nothing was charged.";
/**
 * A still whose preparation (the look's cutout and sheet) left too little of
 * the request's 300 s for its render (set-config.ts SET_STILL_START_BY_MS,
 * 2026-09-25). Nothing was reserved; the sheet it made is kept, so the next
 * press is quicker.
 */
export const SET_SHOT_NO_TIME = "Getting this shot ready took too long, so it wasn't shot and nothing was charged — try again.";
/**
 * A press delivered twice whose first delivery was still working when the
 * second one's clock ran out (press.ts, 2026-09-25). It never says it
 * failed: the first delivery's still or take lands in the set and History.
 */
export const SET_PRESS_RUNNING = "Still rendering — it will appear here when it lands, and nothing more is charged.";

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
