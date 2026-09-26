// What a person reads from the campaign engine (Cut 2), in English: the
// wire form. Every surface maps these to its locale at display time through
// lib/i18n/server-text.ts, and truth-contracts.test.ts pins each mapped
// sentence against this file, so a reword here without the map fails the
// suite.
//
// Customer-copy rules (spec §0; synthesis S1, S2, S6, N2; operator
// 2026-09-26): no engine, vendor, "server" or resolution; nothing says
// "locked", a free re-shoot or a refund for a miss; the stills are "stills".
//
// Pure, alias-free, no imports.

// --- Planning ----------------------------------------------------------------

export const PLAN_LIMIT = "That's all the ads you can plan today. Try again tomorrow.";
export const PLAN_BUSY = "Planning ads is busy right now. Try again in a few minutes.";
export const PLAN_UNAVAILABLE = "We couldn't plan this ad just now. Nothing was charged. Try again in a moment.";
export const PLAN_REFUSED_AD_RULES =
  "This ad would say something ads can't: a made-up review, a hidden sponsorship, a best-in-class claim or a health claim. Change your goal and plan again.";
export const PLAN_REFUSED_ENDORSEMENT =
  "This ad would show your character as an independent customer or expert vouching for the product. Your character can present the product, not review it. Change your goal and plan again.";
export const PLAN_STALLED = "Planning this ad didn't finish. Nothing was charged. Plan it again.";

// --- What the ad needs before it can go on ------------------------------------

export const CAMPAIGN_BAD_REQUEST = "Something in that request isn't right. Refresh and try again.";
export const PRODUCT_NOT_CONFIRMED = "Confirm your product's card before planning an ad.";
export const CHARACTER_NEEDS_PHOTO = "Add a photo to your character first. Its stills are painted from its photos.";
export const AD_CONSENT_NEEDED = "Tell us who is in your character's photos, and confirm they may appear in your ads.";
export const CAMPAIGN_MOVED_ON = "This ad has moved on. Refresh to see where it is.";
export const CAMPAIGN_CLOSED = "This ad is closed. Start a new one.";

// --- Stills -------------------------------------------------------------------

export const PAINT_FREE_SLOT = "Your free daily generation can't pay for Press Tour stills.";
export const PAINT_OUT_OF_CREDITS = "You don't have enough credits for this. Nothing was charged.";
export const PAINT_COULDNT_START = "We couldn't start painting. Nothing was charged. Try again.";
/** A paint or repaint press that lost its write and could not give every still back just now (PT-12): no "nothing was charged". */
export const PAINT_NOT_STARTED = "We couldn't start painting. Try again in a moment.";
/** A decision or a stop that could not be written (PT-12): nothing was being painted. */
export const CAMPAIGN_SAVE_FAILED = "We couldn't save that just now. Try again.";
/** The ad could not be read just now (PT-12). */
export const CAMPAIGN_READ_FAILED = "We couldn't open this ad just now. Try again.";
export const STILL_IN_PROGRESS = "That still is being painted. Wait for it to finish.";
export const STILL_NOT_READY = "That still isn't painted yet.";
export const STILL_REPAINT_LIMIT = "That still has been repainted as many times as it can be. Keep it, or start a new ad.";
export const SHOT_NOT_IN_AD = "That shot isn't in this ad.";
export const CANCEL_WAIT = "Your stills are being painted. Try again in a moment.";

// --- Why a campaign closed ------------------------------------------------------

export const PAINT_FAILED = "We couldn't paint your stills. Nothing was charged for the ones that didn't paint.";
export const STILL_REFUSED =
  "One of your stills couldn't be shown under our content rules, so this ad stopped. Nothing was charged for the ones that didn't paint.";
export const CAMPAIGN_EXPIRED = "This ad waited 7 days for your decision and was closed. Filming was never charged.";

// --- What blocks the next step (CampaignView.blocker) --------------------------

export const BLOCK_PLANNING = "We're planning your ad.";
export const BLOCK_PAINTING = "We're painting your stills.";
export const BLOCK_CHECKING = "We're checking your stills.";
export const BLOCK_FILMING_NOT_OPEN = "Filming isn't open yet. Your stills are kept.";

/** The first still still waiting on the person (server-text.ts PATTERNS maps it with the number). */
export function blockDecide(shot: number): string {
  return `Decide on shot ${shot} to film`;
}

/** The price the person saw is not the price now (server-text.ts PATTERNS maps it with the number). */
export function priceChanged(credits: number): string {
  return `The price changed to ${credits} credits. Check it and press again.`;
}

/** Every fixed sentence above, for the i18n map and its truth-contract test. */
export const CAMPAIGN_MESSAGES = [
  PLAN_LIMIT,
  PLAN_BUSY,
  PLAN_UNAVAILABLE,
  PLAN_REFUSED_AD_RULES,
  PLAN_REFUSED_ENDORSEMENT,
  PLAN_STALLED,
  CAMPAIGN_BAD_REQUEST,
  PRODUCT_NOT_CONFIRMED,
  CHARACTER_NEEDS_PHOTO,
  AD_CONSENT_NEEDED,
  CAMPAIGN_MOVED_ON,
  CAMPAIGN_CLOSED,
  PAINT_FREE_SLOT,
  PAINT_OUT_OF_CREDITS,
  PAINT_COULDNT_START,
  PAINT_NOT_STARTED,
  CAMPAIGN_SAVE_FAILED,
  CAMPAIGN_READ_FAILED,
  STILL_IN_PROGRESS,
  STILL_NOT_READY,
  STILL_REPAINT_LIMIT,
  SHOT_NOT_IN_AD,
  CANCEL_WAIT,
  PAINT_FAILED,
  STILL_REFUSED,
  CAMPAIGN_EXPIRED,
  BLOCK_PLANNING,
  BLOCK_PAINTING,
  BLOCK_CHECKING,
  BLOCK_FILMING_NOT_OPEN,
] as const;
