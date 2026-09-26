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

import type { Messages } from "../i18n/messages/en";
import { fill } from "./fill";
import { SET_EDIT_MAX_CHARS, SET_EDIT_MAX_SPEC_CHARS } from "./set-config";
import { cleanText, withoutNames, type SetSpec } from "./set-spec";

/**
 * Which sentence the card says (§3.2 of the Cut 2 spec):
 * - none: the month's changes are used up, or the plan has none — no button;
 * - paused: the month's tries are spent, so Astra is paused on this
 *   person's sets until the billing period resets (Helios Cut 4, step A3,
 *   data.ts astraTriesPaused) — no button; it said "1 of your n changes
 *   left" and offered a press the server then refused;
 * - tooBig: the set is too big for Astra to answer whole — no button;
 * - askOpen: an account with no monthly cap (admins);
 * - askUnknown: a cap, but the count could not be read;
 * - askLast / ask: one left, or n left.
 * The order is the server's: the month's changes are counted before its tries.
 */
export type AstraCardKind = "ask" | "askLast" | "askOpen" | "askUnknown" | "none" | "paused" | "tooBig";

export function astraCardKind(input: { editsLeft: number | null; editsCap: number; tooBig: boolean; paused?: boolean }): AstraCardKind {
  const { editsLeft, editsCap, tooBig } = input;
  if (editsCap === 0 || editsLeft === 0) return "none";
  if (input.paused === true) return "paused";
  if (tooBig) return "tooBig";
  if (editsCap < 0) return "askOpen";
  if (editsLeft === null) return "askUnknown";
  return editsLeft === 1 ? "askLast" : "ask";
}

/** Whether the card offers its button: never when nothing can come of the press. */
export const astraCardCanGo = (kind: AstraCardKind): boolean => kind !== "none" && kind !== "paused" && kind !== "tooBig";

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

/** Whether a working copy is past what Astra can answer whole: editSetWithAstra's own test, run on the page — on the copy as sent, without its names (Helios Cut 4, step B1). */
export function astraTooBig(spec: SetSpec): boolean {
  return JSON.stringify(withoutNames(spec)).length > SET_EDIT_MAX_SPEC_CHARS;
}

/**
 * The card's sentence in the person's language: the kind's own wording,
 * with the words Astra will read quoted (astraCardWords). "paused" says the
 * server's own sentence for it (`paused`: serverText.setEditTriesUsed in the
 * person's catalog), word for word what the press would answer. Filled in one
 * pass (fill.ts), so a "{n}" or a "$&" they typed is quoted as they typed it
 * (review of Cut 2, W4: formatMsg read "$'" in their words as a pattern). The
 * card (astra-change-card.tsx) and the chat's reply (turn-reply.ts) both
 * say it through here, so they can never say it differently.
 */
export function astraCardLine(
  copy: Pick<Messages["sets"]["reply"], "astraAsk" | "astraAskLast" | "astraAskOpen" | "astraAskUnknown" | "astraNone" | "astraTooBig">,
  input: { kind: AstraCardKind; words: string; editsLeft: number | null; editsCap: number; build: string; paused: string },
): string {
  const words = astraCardWords(input.words).quoted;
  switch (input.kind) {
    case "none":
      return fill(copy.astraNone, { build: input.build, words });
    case "paused":
      return input.paused;
    case "tooBig":
      return fill(copy.astraTooBig, { build: input.build, words });
    case "askOpen":
      return fill(copy.astraAskOpen, { words });
    case "askUnknown":
      return fill(copy.astraAskUnknown, { cap: input.editsCap, words });
    case "askLast":
      return fill(copy.astraAskLast, { words });
    case "ask":
      return fill(copy.astraAsk, { n: input.editsLeft ?? 0, words });
  }
}

/**
 * What "Rebuild from its photos" uses, said under its button (Helios Cut 4,
 * step A10), from the card's own kinds (astraCardKind with the set's size
 * left out: a rebuild sends its thing, never the set, thing-rebuild.ts). A
 * rebuild is one of the month's Astra changes, counted only if it saves,
 * exactly as a change to the set is (editor-actions.ts
 * rebuildThingFromPhotos). "paused" says the server's own sentence, as the
 * card does. Null for an account with no cap (admins): nothing to count.
 */
export function rebuildUsesLine(
  copy: Pick<Messages["sets"]["cast"], "rebuildUses" | "rebuildUsesLast" | "rebuildUsesUnknown" | "rebuildUsesNone">,
  input: { kind: AstraCardKind; editsLeft: number | null; editsCap: number; paused: string },
): string | null {
  switch (input.kind) {
    case "none":
      return copy.rebuildUsesNone;
    case "paused":
      return input.paused;
    case "askOpen":
    case "tooBig":
      return null;
    case "askUnknown":
      return fill(copy.rebuildUsesUnknown, { cap: input.editsCap });
    case "askLast":
      return copy.rebuildUsesLast;
    case "ask":
      return fill(copy.rebuildUses, { n: input.editsLeft ?? 0 });
  }
}
