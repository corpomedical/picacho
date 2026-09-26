// What a person reads from Press Tour's filming, press wall and cut (Cut 4),
// in English: the wire form. The UI agent maps every sentence here into
// lib/i18n (server-text.ts and the four catalogs) at the end of the cut;
// until then the door shows them as they are. Kept out of
// campaign-messages.ts on purpose: that file's list is pinned sentence by
// sentence against server-text.ts (truth-contracts.test.ts), and these are
// not mapped yet.
//
// Customer-copy rules (spec §0; synthesis S1, S2, S6, N2; operator
// 2026-09-26): no engine, vendor, "server" or resolution; nothing says
// "locked", a free re-shoot or a refund for a miss; a re-film is at the
// shot's normal price; "Not checked" is never a miss.
//
// Pure, alias-free, no imports.

// --- Filming ------------------------------------------------------------------

/** The Film press while the film lane is tripped (checked before anything is reserved). */
export const FILM_BUSY = "Filming is busy. Try again in a few minutes. Nothing was charged. Your stills are saved.";
export const FILM_COULDNT_START = "We couldn't start filming. Nothing was charged. Try again.";
/** A Film or Re-film press that lost its write and could not give every shot back just now: no "nothing was charged". */
export const FILM_NOT_STARTED = "We couldn't start filming. Try again in a moment.";
export const FILM_FREE_SLOT = "Your free daily generation can't pay for filming an ad.";
export const FILM_STILLS_MISSING = "Every shot needs its still before filming. Repaint the one that's missing.";
export const FILM_CANCEL_WAIT = "Your shots are being filmed. Try again in a few minutes.";
/**
 * "Start over" while we still owe the cut (filming charged, the 24 h rule's
 * clock running: checking, cutting, finishing, or a cut parked for the team).
 * Closing then would keep the filming credits AND stop the 24 h rule from
 * ever refunding them, so it waits (fixer 2026-09-26, MONEY-1).
 */
export const CUT_CANCEL_WAIT = "We're still finishing your cut, so this ad can't be closed now. If it isn't done within a day, it closes on its own.";

// --- The press wall -----------------------------------------------------------

export const SHOTS_NOT_FILMED = "Your shots aren't filmed yet.";
export const SHOT_BEING_FILMED = "That shot is being filmed. Wait for it to finish.";
export const TAKE_NOT_READY = "That take isn't ready yet.";
export const TAKE_NOT_IN_SHOT = "That take isn't in this shot.";
export const REFILM_LIMIT = "That shot has been filmed again as many times as it can be. Keep a take or cut the shot.";
export const CUT_LAST_SHOT = "Your ad needs at least one shot. Keep a take instead.";
export const CUT_BEING_MADE = "Your cut is being made. Wait for it to finish.";
export const CUT_NOTHING = "None of your shots has a take to cut yet. Film one again.";

// --- What blocks the next step (CampaignView.blocker) --------------------------

export const BLOCK_FILMING = "We're filming your shots.";
export const BLOCK_READING_SHOTS = "We're checking your shots.";
export const BLOCK_CUTTING = "We're cutting your ad.";
export const BLOCK_FINISHING = "We're finishing your ad.";
/** The cut failed three times in a row: parked for the team, free to try again. */
export const CUT_STALLED = "We couldn't finish the cut, and we're on it. Your shots are in History.";

/** The first shot on the press wall still waiting on the person (maps with the number). */
export function blockDecideShot(shot: number): string {
  return `Decide on shot ${shot} for your cut`;
}

// --- Why an ad closed after filming --------------------------------------------

/**
 * Every shot the ad could cut from was refused under the content rules. A
 * refusal alone no longer closes an ad that still has a usable shot: that
 * shot waits on the press wall, where the person cuts it free or films it
 * again (fixer 2026-09-26, MONEY-2).
 */
export const FILM_REFUSED = "This ad's shots couldn't be shown under our content rules, so it stopped.";
export const FILM_EXPIRED = "This ad waited 7 days for your decision and was closed. Your filmed shots are in History.";
/** The 24 h rule, when the filming credits went back (maps with the number). */
export function cutLateRefunded(credits: number): string {
  return `We couldn't finish your ad within a day. The ${credits} credits for filming went back, and your shots are in History.`;
}
/** The 24 h rule, when nothing could go back (an account whose credits never move, or the refund was held). */
export const CUT_LATE = "We couldn't finish your ad within a day. Your shots are in History, and our team has been told.";

// --- The phone (push keys adReady / adFailed / adFailedRefunded, in the four
// --- languages in lib/push and lib/i18n; campaign-runtime.ts sends them) ------

export const AD_READY_PUSH = { title: "Your ad is ready", body: "Tap to watch it and save it." } as const;
/** An ad closed with nothing given back (PT-R3-04: never "what came back" when nothing did). */
export const AD_FAILED_PUSH = { title: "Your ad couldn't be finished", body: "Tap to see what happened." } as const;
/** An ad closed and credits went back (the 24 h rule refunded filming). */
export const AD_FAILED_REFUNDED_PUSH = { title: "Your ad couldn't be finished", body: "Tap to see what happened and what came back." } as const;

// --- The tag burned into the tagged rendition (design A, "Every honest
// --- state" §6, operator-approved words, one per language). The account's
// --- language when the Film press was made.
export const AI_TAG_TEXT = {
  en: "AI-generated",
  es: "Generado por IA",
  pt: "Gerado por IA",
  it: "Generato con l'IA",
} as const;
export type TagLocale = keyof typeof AI_TAG_TEXT;

/** Every fixed customer sentence above, for the i18n map (the UI agent's list). */
export const FILM_MESSAGES = [
  FILM_BUSY,
  FILM_COULDNT_START,
  FILM_NOT_STARTED,
  FILM_FREE_SLOT,
  FILM_STILLS_MISSING,
  FILM_CANCEL_WAIT,
  CUT_CANCEL_WAIT,
  SHOTS_NOT_FILMED,
  SHOT_BEING_FILMED,
  TAKE_NOT_READY,
  TAKE_NOT_IN_SHOT,
  REFILM_LIMIT,
  CUT_LAST_SHOT,
  CUT_BEING_MADE,
  CUT_NOTHING,
  BLOCK_FILMING,
  BLOCK_READING_SHOTS,
  BLOCK_CUTTING,
  BLOCK_FINISHING,
  CUT_STALLED,
  FILM_REFUSED,
  FILM_EXPIRED,
  CUT_LATE,
] as const;

// --- Admin only (never shown to a customer): why a rendition is unsigned. --------

export const SIGN_NOT_CONFIGURED = "Unsigned: PRESS_C2PA_CERT and PRESS_C2PA_KEY are not set.";
export const SIGN_NO_LIBRARY =
  "Unsigned: the C2PA certificate is set, but no C2PA signing library is installed on the server (package.json has none).";
export const SIGN_NOT_VERIFIED = "Unsigned: the signer answered, but no C2PA manifest could be read back from the file.";
export const SIGN_FAILED = "Unsigned: the signer failed on this file.";
