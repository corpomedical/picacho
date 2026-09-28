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
/**
 * The ad rules tripped on the product's own card (a ticked label word or
 * its name), not on the goal: changing the goal would not help, so the
 * words point at the card (planner.ts). The check reads the ad rules and
 * the person's own brand rules together, so the words name both and give
 * no example of either. Planning needs a confirmed card, so the words name
 * the door's own button for editing one ("Edit its card", pressTour.editCard
 * in every language: press-tour-door.test.ts pins the two together).
 */
export const PLAN_REFUSED_LABEL_CLAIM =
  "Your product's name, or a word ticked on its label, can't appear in an ad under our ad rules or your brand rules. On Press Tour, press \"Edit its card\", untick that word under \"Words on the label\" or change the name, then plan again.";
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
/**
 * A still's own line when its repaint (the house's after the check, or the
 * person's) was refused: the ad goes on, and the still keeps its painting.
 */
export const STILL_REPAINT_REFUSED = "This still couldn't be repainted under our content and ad rules, so it keeps the painting it had.";
/**
 * A painted still our checker could not read (the reader was down or out of
 * time): said plainly, never left as a quiet "Not checked" (P1 pre-flight G5).
 */
export const STILL_NOT_CHECKED = "We couldn't check this still just now. Look at it closely yourself: keep it as it is, or repaint it.";
export const SHOT_NOT_IN_AD = "That shot isn't in this ad.";
export const CANCEL_WAIT = "Your stills are being painted. Try again in a moment.";

// --- Why a campaign closed ------------------------------------------------------

export const PAINT_FAILED = "We couldn't paint your stills. Nothing was charged for the ones that didn't paint.";
export const STILL_REFUSED =
  "One of your stills couldn't be shown under our content rules, so this ad stopped. Nothing was charged for the ones that didn't paint.";
/**
 * The same two closings when a still that didn't paint kept its charge:
 * it failed after the picture was asked for, and the refund rules (the
 * automatic_refunds switch, the daily cap) kept the credit. Chosen from
 * what actually came back (campaign-machine.ts failCampaign), so the ad
 * never says "nothing was charged" over a credit it kept.
 */
export const PAINT_FAILED_CHARGED = "We couldn't paint your stills. A still that failed partway through painting was still charged.";
export const STILL_REFUSED_CHARGED =
  "One of your stills couldn't be shown under our content rules, so this ad stopped. A still that failed partway through painting was still charged.";
/**
 * The picture service's OWN safety rule stopped a still that our checks had
 * passed (operator, 2026-09-26: the Climax hoodie ad closed on OpenAI's
 * output-stage block, and the door said nothing of whose rule it was).
 * BEFORE: refused on the request, nothing drawn, the still's credit forced
 * back. AFTER: painted, then blocked; its credit comes back by the ordinary
 * refund rules, so these words say "nothing was charged" only when the ad
 * kept no credit, and the CHARGED twin otherwise (failWords).
 */
export const PICTURE_SERVICE_REFUSED_BEFORE =
  "The picture service we use refused one of your stills under its own safety rules, not ours: our checks had passed it. This ad stopped. Nothing was charged for the ones that didn't paint.";
export const PICTURE_SERVICE_REFUSED_AFTER =
  "The picture service we use painted one of your stills, then blocked it under its own safety rules, not ours: our checks had passed it. This ad stopped. Nothing was charged for the ones that didn't paint.";
export const PICTURE_SERVICE_REFUSED_CHARGED =
  "The picture service we use blocked one of your stills under its own safety rules, not ours: our checks had passed it. This ad stopped. A still that failed partway through painting was still charged.";
/** The three charged closings when MORE than one still kept its charge (failWords picks by the count). */
export const PAINT_FAILED_CHARGED_MANY = "We couldn't paint your stills. The stills that failed partway through painting were still charged.";
export const STILL_REFUSED_CHARGED_MANY =
  "One of your stills couldn't be shown under our content rules, so this ad stopped. The stills that failed partway through painting were still charged.";
export const PICTURE_SERVICE_REFUSED_CHARGED_MANY =
  "The picture service we use blocked one of your stills under its own safety rules, not ours: our checks had passed it. This ad stopped. The stills that failed partway through painting were still charged.";
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
  PLAN_REFUSED_LABEL_CLAIM,
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
  STILL_REPAINT_REFUSED,
  STILL_NOT_CHECKED,
  SHOT_NOT_IN_AD,
  CANCEL_WAIT,
  PAINT_FAILED,
  STILL_REFUSED,
  PAINT_FAILED_CHARGED,
  STILL_REFUSED_CHARGED,
  PICTURE_SERVICE_REFUSED_BEFORE,
  PICTURE_SERVICE_REFUSED_AFTER,
  PICTURE_SERVICE_REFUSED_CHARGED,
  PAINT_FAILED_CHARGED_MANY,
  STILL_REFUSED_CHARGED_MANY,
  PICTURE_SERVICE_REFUSED_CHARGED_MANY,
  CAMPAIGN_EXPIRED,
  BLOCK_PLANNING,
  BLOCK_PAINTING,
  BLOCK_CHECKING,
  BLOCK_FILMING_NOT_OPEN,
] as const;
