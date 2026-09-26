// Undo that gives back Astra's words too (Helios Cut 2, step 2, 2026-09-25 —
// operator: "Run, keep going.").
//
// An Astra change rewrites the set whole — its title, its description and
// the labels of its marks and cameras included — and every later still reads
// that description into its prompt (actions.ts shootStill). The changed
// line's Undo saved the set as it stood before, but through the editor's
// autosave rule (editor-model.ts holdEditedText), which keeps the title,
// the description and the labels of the copy on the server — Astra's. So an
// undone "add a row of flags" took the flags away and kept "a race track
// lined with flags" in every still that followed (critic item 4).
//
// The browser may not write set text: a page's copy is only geometry until
// the server says otherwise (editor-actions.ts's trust boundary). So the
// server SEALS the text it handed Astra: an HMAC over the set, the person
// and the words, which the page carries and sends back with Undo. A seal
// that opens proves this server wrote these words for this set and this
// person — words that were gated when they were first written — and Undo
// may put them back. Stateless, as live/actions.ts seals a direction: no
// table, no SQL, no new secret.
//
// Server-only (node:crypto). The page imports its types alone.

import { createHmac, timingSafeEqual } from "node:crypto";
import { editTextOf, type EditText, type HeldText } from "./editor-model";
import { SET_EDIT_MAX_CHARS } from "./set-config";
import { editMeaningOf } from "./set-edit-prompt";
import { cleanText, SET_LIMITS, type SetSpec } from "./set-spec";

// The words' shape and reading live in editor-model.ts, where the page can
// name them too (Helios Cut 4, step A6); passed on from here as before.
export { editTextOf, type EditText };
/**
 * A copy's words, sealed: what an Astra change's answer carries for its Undo
 * (the words it replaced), and — since Helios Cut 4, step A6 — what every
 * spec the server hands the page carries for its own words, so a later save
 * of a copy with those words can bring them back.
 */
export type EditUndo = { text: EditText; seal: string };

const SEAL_CHARS = 32;

/** The signing key, as the rest of the app's seals take it; null when there is none, and then nothing is sealed or opened. */
function sealKey(): string | null {
  const key = process.env.MEDIA_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return key.length > 0 ? key : null;
}

function sealWith(key: string, setId: string, userId: string, text: EditText): string {
  // One key order, whatever order the object came in.
  const words = JSON.stringify({ title: text.title, description: text.description, labels: text.labels });
  return createHmac("sha256", key).update(`set-edit-text:v1:${setId}:${userId}:${words}`).digest("base64url").slice(0, SEAL_CHARS);
}

/** The seal over a set's words, for this set and this person; null with no key (Undo then keeps the words on the server, and says so). */
export function sealEditText(setId: string, userId: string, text: EditText): string | null {
  const key = sealKey();
  return key === null ? null : sealWith(key, setId, userId, text);
}

/** A change's Undo: the words of the copy Astra was handed, sealed — null when nothing can be sealed. */
export function editUndoOf(setId: string, userId: string, handed: SetSpec): EditUndo | null {
  const text = editTextOf(handed);
  const seal = sealEditText(setId, userId, text);
  return seal === null ? null : { text, seal };
}

/**
 * A browser's words, held to the shape a set's words have (set-spec.ts
 * SET_LIMITS): anything else is not a set's text, and no seal is checked
 * for it. Counted by code point, as normaliseSetSpec cuts them.
 */
export function readEditText(value: unknown): EditText | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { title, description, labels } = value as Record<string, unknown>;
  const fits = (v: unknown, max: number): v is string => typeof v === "string" && Array.from(v).length <= max;
  if (!fits(title, SET_LIMITS.titleChars) || !fits(description, SET_LIMITS.descriptionChars)) return null;
  if (!Array.isArray(labels) || labels.length > SET_LIMITS.maxMarks + SET_LIMITS.maxCameras) return null;
  if (!labels.every((l) => fits(l, SET_LIMITS.labelChars))) return null;
  return { title, description, labels: [...labels] };
}

/** Whether `seal` is this server's seal over exactly these words, for this set and this person. Timing-safe; false with no key. */
export function openEditSeal(setId: string, userId: string, text: EditText, seal: unknown): boolean {
  const key = sealKey();
  if (key === null || typeof seal !== "string" || seal.length !== SEAL_CHARS) return false;
  const expected = Buffer.from(sealWith(key, setId, userId, text));
  const given = Buffer.from(seal);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Sealed words as holdEditedText reads a stored copy: they stand first, so
 * the title and the description come back, and each label may go back on a
 * mark or a camera, as it could in the copy it came from.
 */
export function heldTextOf(text: EditText): HeldText {
  return { title: text.title, description: text.description, marks: text.labels.map((label) => ({ label })), cameras: [] };
}

/**
 * The words an Undo may put back, from what the page sent: the text, read
 * to its shape, and only when its seal opens. Null for anything else — the
 * Undo then keeps the server's words, as every save does.
 */
export function sealedEditText(setId: string, userId: string, undo: unknown): EditText | null {
  if (!undo || typeof undo !== "object") return null;
  const { text, seal } = undo as { text?: unknown; seal?: unknown };
  const read = readEditText(text);
  return read !== null && openEditSeal(setId, userId, read, seal) ? read : null;
}

// ---------------------------------------------------------------------------
// The chat reader's meaning of a set change (review of Cut 2, R1, 2026-09-25).
//
// A set change asked in the chat reaches Astra with the reader's short
// English gloss of the person's words, and a refusal that gloss earns on its
// own is logged under the reader and never counts against the person
// (editor-actions.ts editSetWithAstra). The gloss must therefore be the
// READER's — never a field any browser can fill with its own words to have
// their refusals logged as the model's (refusal-attribution.ts: "NOT A
// REQUEST FIELD"). So the server that read the message (words-actions.ts
// readShotTurn) seals the words and the gloss it wrote, for this set and
// this person; editSetWithAstra takes the gloss only when that seal opens
// for exactly the words it is asked to change, and otherwise sends and
// judges the person's words alone, as before step 10.
// ---------------------------------------------------------------------------

/** The words and the gloss as editSetWithAstra reads them: the request held to Astra's 300, the gloss to its 200. */
function meaningParts(said: string, meaning: string): string {
  return JSON.stringify([cleanText(said, SET_EDIT_MAX_CHARS), editMeaningOf(meaning)]);
}

/** The reader's seal over a set change's words and its gloss; null with no key or no gloss (then no gloss rides). */
export function sealReaderMeaning(setId: string, userId: string, said: string, meaning: string | null): string | null {
  const key = sealKey();
  if (key === null || !meaning || editMeaningOf(meaning).length === 0) return null;
  return createHmac("sha256", key).update(`set-edit-meaning:v1:${setId}:${userId}:${meaningParts(said, meaning)}`).digest("base64url").slice(0, SEAL_CHARS);
}

/** Whether `seal` is the reader's seal over exactly these words and this gloss, for this set and this person. Timing-safe; false with no key. */
export function openReaderMeaning(setId: string, userId: string, said: string, meaning: string, seal: unknown): boolean {
  if (typeof seal !== "string" || seal.length !== SEAL_CHARS) return false;
  const expected = sealReaderMeaning(setId, userId, said, meaning);
  if (expected === null) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(seal);
  return a.length === b.length && timingSafeEqual(a, b);
}
