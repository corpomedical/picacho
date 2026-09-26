// What Press Tour says through MCP — to the model in Claude or ChatGPT, and
// to the person on Picacho's card inside them. English: the wire form (the
// model answers in the person's language; the card's own words live in
// widget-text.ts for the UI agent to map).
//
// Rules (spec §4.6; ChatGPT app guidelines; synthesis S1, S4, S6, N2):
// no plans, prices in money, upgrade or checkout wording anywhere; when
// credits run out, say so plainly and stop there. No machinery words
// (engine, lane, server, resolution), nothing "locked", no free re-shoot or
// refund promise. Stills are "stills"; the checks read "moments".
//
// Pure, alias-free, no imports.

// --- Access -------------------------------------------------------------------

export const PRESS_MCP_OFF = "Press Tour isn't available here right now.";
/** The free first ad is claimed on picacho.ai only (spec §4.3: no trial spending through MCP). */
export const PRESS_MCP_TRIAL_ONLY = "Press Tour isn't open to this account in other apps yet.";
export const PRESS_MCP_FAILED = "Something went wrong on our side. Try again in a moment.";
/** A spending step failed in a way that may or may not have charged. */
export const PRESS_MCP_SPEND_UNSURE =
  "Something went wrong starting that step, and it may have started anyway. Open the ad again to see where it is before pressing anything.";

// --- Arguments ----------------------------------------------------------------

export const PLAN_ID_REQUIRED = "plan_id is required: it comes from draft_ad_plan.";
export const CHARACTER_REQUIRED = "character_id is required: pick one from list_characters.";
export const PRODUCT_REQUIRED = "Send product_id (from import_product or get_brand_kit) or the product's page address as product_url.";
export const PRODUCT_URL_REQUIRED = "url is required: the address of the product's page.";
export const LENGTH_INVALID = "length_seconds must be 10, 15 or 30.";
export const NETWORKS_INVALID = "networks must list one or more of: x, tiktok, instagram, threads.";
export const DECISIONS_INVALID = 'decisions must list shots with a choice of "approve" or "keep".';

// --- The one-time code only Picacho's card holds (v2 #5) -----------------------

export const NONCE_REQUIRED = "Paid steps are started from Picacho's card, with a tap. Ask the person to use the card.";
export const NONCE_USED = "That tap was already used. The card shows where the ad is now.";
export const NONCE_EXPIRED = "This card is out of date. It has been refreshed; check it and tap again.";
export const NONCE_WRONG = "That card belongs to a different ad. Open this ad's card and tap there.";

// --- States -----------------------------------------------------------------------

export const PRODUCT_NEEDS_SETUP =
  "This product needs its card set up in Picacho before an ad can be painted: tick the words printed on it and confirm you may advertise it.";
export const PRODUCT_NOT_FOUND_BY_URL =
  "Picacho doesn't have this product yet. Read it with import_product, then the person confirms its card in Picacho.";
export const PRODUCT_DRAFT_READY =
  "The product's card is drafted. The person confirms it in Picacho (the words on the label, and that they may advertise it) before an ad can be painted.";
export const PRODUCT_READY = "The product's card is confirmed and ready for an ad.";
export const FILMING_IN_PICACHO = "Filming isn't open here yet. The approved stills are kept; filming continues in Picacho.";
export const POST_IN_PICACHO =
  "Nothing was posted. Posting happens on Picacho's press line, where the person checks each post and sends it.";
export const POST_NOT_READY = "The ad isn't finished yet. The chosen networks are saved for when it is.";
/** The fixed checks line on the card (the count is the still's own: one still, one reading). */
export const CHECKS_LINE = "Face and product, checked on every still";
/** The launch policy line (quote.ts PRESS_POLICY: no re-shoot, no refund for a miss). */
export const POLICY_LINE = "If a filmed shot doesn't match, you choose: keep it, cut it, or film it again at the normal price.";

/** Out of credits, plainly (spec §4.6), with no link to buy anything. */
export function shortOfCredits(needed: number, have: number): string {
  return `This step needs ${needed} credits; the account has ${have}.`;
}

/** What the model is told the ad is doing, one line per stage. */
export const STAGE_LINES: Record<string, string> = {
  draft: "The ad is being planned.",
  planned: "The plan is ready. Nothing is painted yet: stills come first, then the person's OK.",
  painting: "The stills are being painted.",
  checking_keyframes: "The stills are being checked.",
  awaiting_approval: "The stills are painted and checked. The person approves or keeps each one on the card.",
  animating: "The shots are being filmed.",
  checking_shots: "The filmed shots are being checked.",
  assembling: "The ad is being cut together.",
  signing: "The ad is being finished.",
  ready: "The ad is ready. Posting happens on Picacho's press line.",
  failed: "This ad stopped.",
  cancelled: "This ad was stopped.",
  expired: "This ad waited too long for a decision and was closed.",
};

/** Every fixed sentence above, for the i18n map and its truth-contract test. */
export const PRESS_MCP_MESSAGES = [
  PRESS_MCP_OFF,
  PRESS_MCP_TRIAL_ONLY,
  PRESS_MCP_FAILED,
  PRESS_MCP_SPEND_UNSURE,
  PLAN_ID_REQUIRED,
  CHARACTER_REQUIRED,
  PRODUCT_REQUIRED,
  PRODUCT_URL_REQUIRED,
  LENGTH_INVALID,
  NETWORKS_INVALID,
  DECISIONS_INVALID,
  NONCE_REQUIRED,
  NONCE_USED,
  NONCE_EXPIRED,
  NONCE_WRONG,
  PRODUCT_NEEDS_SETUP,
  PRODUCT_NOT_FOUND_BY_URL,
  PRODUCT_DRAFT_READY,
  PRODUCT_READY,
  FILMING_IN_PICACHO,
  POST_IN_PICACHO,
  POST_NOT_READY,
  CHECKS_LINE,
  POLICY_LINE,
  ...Object.values(STAGE_LINES),
] as const;
