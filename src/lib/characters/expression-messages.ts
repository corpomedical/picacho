// Every sentence the expression set's actions return (expression-actions.ts).
// English on the wire, like every server sentence: the page translates each
// through lib/i18n/server-text.ts, and truth-contracts.test.ts reads this
// file to hold the two together. A plain module, so the tests and the page
// can import it — a "use server" file may only export async functions.

export const EXPRESSION_BAD_REQUEST = "That close-up can't be made — refresh and try again.";
export const EXPRESSION_NO_CHARACTER = "Couldn't find that character — refresh and try again.";
export const EXPRESSION_NEEDS_PHOTO = "Add a photo of this character first — its close-ups are made from its photos.";
export const EXPRESSION_NEEDS_DATABASE = "The expression set needs a database update first (character-expression-set.sql).";
export const EXPRESSION_SAVE_FAILED = "Couldn't save that close-up — try again.";
export const EXPRESSION_BAD_UPLOAD = "Couldn't use that photo — upload it again.";
export const EXPRESSION_REMOVE_FAILED = "Couldn't remove that close-up — try again.";
