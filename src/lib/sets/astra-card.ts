// The Astra card (Helios Cut 2, 2026-09-25 — operator: "Run, keep going.").
//
// A change to the set ITSELF — add a row of flags, recolour the barriers —
// is Astra's: a rewrite of the whole set that Picacho pays for ($0.31
// measured, $0.62 worst, set-config.ts) and one of the person's changes for
// the month (SET_EDITS_MONTHLY_LIMITS), counted only if it saves (Cut 1).
// Until this cut the conversation sent a message it read as a set change
// straight to Astra, with no press and no count shown, in every mode. Now
// it is always a card first — in every mode, for every account, admins
// included (the owner's decision 1) — that quotes exactly the words Astra
// will read and says what it uses. Nothing is spent until its button.
//
// Pure and client-safe, relative imports only: astra-change-card.tsx draws
// it, the tests read it.

import { SET_EDIT_MAX_CHARS, SET_EDIT_MAX_SPEC_CHARS } from "./set-config";
import { cleanText, type SetSpec } from "./set-spec";

/**
 * Which sentence the card says (§3.2 of the Cut 2 spec):
 * - none: the month's changes are used up, or the plan has none — no button;
 * - tooBig: the set is too big for Astra to answer whole — no button;
 * - askOpen: an account with no monthly cap (admins);
 * - askUnknown: a cap, but the count could not be read;
 * - askLast / ask: one left, or n left.
 */
export type AstraCardKind = "ask" | "askLast" | "askOpen" | "askUnknown" | "none" | "tooBig";

export function astraCardKind(input: { editsLeft: number | null; editsCap: number; tooBig: boolean }): AstraCardKind {
  const { editsLeft, editsCap, tooBig } = input;
  if (editsCap === 0 || editsLeft === 0) return "none";
  if (tooBig) return "tooBig";
  if (editsCap < 0) return "askOpen";
  if (editsLeft === null) return "askUnknown";
  return editsLeft === 1 ? "askLast" : "ask";
}

/** Whether the card offers its button: never when nothing can come of the press. */
export const astraCardCanGo = (kind: AstraCardKind): boolean => kind !== "none" && kind !== "tooBig";

/**
 * The words Astra will read, cleaned exactly as editSetWithAstra cleans an
 * instruction (SET_EDIT_MAX_CHARS, 300), and whether the person wrote more
 * than that. A v1 message may run to 600 characters (SHOT_WORDS_MAX_CHARS):
 * the card quotes only what Astra is sent and says the rest was cut, so a
 * press is never asked for on words Astra will not see (check of the spec,
 * item 9).
 */
export function astraCardWords(said: string): { quoted: string; cut: boolean } {
  const quoted = cleanText(said, SET_EDIT_MAX_CHARS);
  const whole = cleanText(said, Number.MAX_SAFE_INTEGER);
  return { quoted, cut: quoted.length < whole.length };
}

/** Whether a working copy is past what Astra can answer whole: editSetWithAstra's own test, run on the page. */
export function astraTooBig(spec: SetSpec): boolean {
  return JSON.stringify(spec).length > SET_EDIT_MAX_SPEC_CHARS;
}
