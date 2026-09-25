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
import type { HeldText } from "./editor-model";
import { SET_LIMITS, type SetSpec } from "./set-spec";

/** The words of a set that a browser may never write: its title, its description and its labels (marks', then cameras', each sorted). */
export type EditText = { title: string; description: string; labels: string[] };
/** What an Astra change's answer carries for its Undo: the words it replaced, sealed. */
export type EditUndo = { text: EditText; seal: string };

const SEAL_CHARS = 32;

export function editTextOf(spec: SetSpec): EditText {
  const labels = (xs: readonly { label: string }[]) => xs.map((x) => x.label).filter((l) => l.length > 0).sort();
  return { title: spec.title, description: spec.description, labels: [...labels(spec.marks), ...labels(spec.cameras)] };
}

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
