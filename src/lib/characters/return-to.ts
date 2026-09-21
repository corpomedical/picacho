// Where a character form goes back to after Save (R1, 2026-09-21, "Who
// plays this person?"): only a Helios set's own page, by its id — never an
// address from outside, another path of the app, or anything that walks up
// a folder. Anything else is no return at all.

const SET_PAGE = /^\/app\/sets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The set page to go back to, or null. */
export function safeReturnTo(raw: unknown): string | null {
  return typeof raw === "string" && SET_PAGE.test(raw) ? raw : null;
}
