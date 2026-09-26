// What a person reads about a product check (and the card self-test), in
// English. The wire form: every surface that shows one maps it to its
// locale through lib/i18n/server-text.ts, and truth-contracts.test.ts pins
// each mapped sentence against this file.
//
// Customer-copy rules (spec §0, synthesis S1/S4/N2, operator 2026-09-26):
// the fixed verdict words (Match, Didn't match, Not readable, Product
// missing, Not checked, No one in this shot) live in the door's catalogs;
// these are the one-line REASONS beside a verdict. Nothing here says
// "locked", "Product Lock", "every frame", a re-shoot, a refund, an engine
// or a vendor.
//
// Pure, alias-free, no imports.

// --- Product reasons (one per verdict cause) -------------------------------

/** didnt_match: the words read on the product are not the ones it carries. */
export const REASON_LABEL_DIFFERENT = "The words on the label came out different.";
/** didnt_match: the readers agree it is a different product (shape, colours, logo). */
export const REASON_NOT_YOUR_PRODUCT = "This doesn't look like your product.";
/** product_missing: a shot that must show the product doesn't. */
export const REASON_PRODUCT_MISSING = "Your product isn't in this shot.";
/** not_readable: blur. Never a miss. */
export const REASON_BLURRED = "The product is blurred here, so it couldn't be read.";
/** not_readable: too small, or only a corner of it shows. */
export const REASON_TOO_SMALL = "The product is too small here to read.";
/** not_readable: the label is in view but no confirmed word could be read. */
export const REASON_LABEL_UNREADABLE = "The label couldn't be read here.";
/** not_readable: the readers disagree and nothing settles it. */
export const REASON_UNSURE = "We couldn't tell for sure whether this is your product.";
/** not_checked: a reader was unreachable, out of time, or out of balance. */
export const REASON_NOT_CHECKED = "The product couldn't be checked this time.";
/** The shot is planned without the product: nothing to check. */
export const REASON_NOT_IN_PLAN = "This shot isn't meant to show the product.";

// --- Face reasons -----------------------------------------------------------

export const REASON_FACE_DIFFERENT = "The face came out different from your character.";
export const REASON_FACE_NOT_SEEN = "The face can't be seen clearly enough to check.";
export const REASON_FACE_NOT_CHECKED = "The face couldn't be checked this time.";

// --- The card self-test (card-service.ts confirmProductCard) ---------------

/** A reference photo did not read as the product (or the ticked words could not be found on the front). */
export const SELF_TEST_FAILED =
  "We couldn't read your product on every photo you picked. Swap the photos we marked, or check the spelling of the words you ticked.";
/** The checker could not run (a reader unreachable): the card is not confirmed, nothing is lost. */
export const SELF_TEST_UNAVAILABLE = "We couldn't check your photos just now. Try again in a moment.";
/** The day's photo checks are used up. */
export const SELF_TEST_LIMIT = "That's all the photo checks for today. Try again tomorrow.";

/** Every sentence above, for the i18n map and its truth-contract test. */
export const PRODUCT_LOCK_MESSAGES = [
  REASON_LABEL_DIFFERENT,
  REASON_NOT_YOUR_PRODUCT,
  REASON_PRODUCT_MISSING,
  REASON_BLURRED,
  REASON_TOO_SMALL,
  REASON_LABEL_UNREADABLE,
  REASON_UNSURE,
  REASON_NOT_CHECKED,
  REASON_NOT_IN_PLAN,
  REASON_FACE_DIFFERENT,
  REASON_FACE_NOT_SEEN,
  REASON_FACE_NOT_CHECKED,
  SELF_TEST_FAILED,
  SELF_TEST_UNAVAILABLE,
  SELF_TEST_LIMIT,
] as const;
