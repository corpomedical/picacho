// The page's book of sealed words (Helios Cut 4, step A6, 2026-09-26 —
// operator: "resume").
//
// Every save a browser makes goes through holdEditedText (editor-model.ts),
// which keeps the server's title, description and labels — a browser may
// move and recolour, never write. So a step back in Build over an Astra
// change brought the pieces back and kept Astra's new words: "lined with
// flags" stayed in the description every later still reads. The set page's
// Undo already sends a seal the server made over the words of the copy
// before the change (edit-seal.ts, Helios Cut 2), and the server puts those
// words back when the seal opens.
//
// This is the page's side of the same proof, for any copy: every seal the
// server hands is filed under the words it seals, and a save of a copy
// with those words sends it. The page never makes or checks a seal — only
// the server can, and a seal it cannot open changes nothing. Keyed by the
// words themselves, never by a history step, so trimming the history or
// two steps with the same words can never send the wrong seal.
//
// Pure and client-safe, relative imports only.

import type { EditUndo } from "./edit-seal";
import { editTextOf, type EditText } from "./editor-model";
import type { SetSpec } from "./set-spec";

/** Seals the server handed this page, filed by the words each one seals. */
export type SealBook = Map<string, EditUndo>;

/** The one key for a set of words, whichever object they came in. */
function keyOf(text: EditText): string {
  return JSON.stringify({ title: text.title, description: text.description, labels: text.labels });
}

/** The key of a copy's words. */
export function wordsKey(spec: Pick<SetSpec, "title" | "description" | "marks" | "cameras">): string {
  return keyOf(editTextOf(spec));
}

/** A book holding the seals given (the ones the page was drawn with). */
export function sealBookOf(...seals: (EditUndo | null | undefined)[]): SealBook {
  const book: SealBook = new Map();
  for (const seal of seals) fileSeal(book, seal);
  return book;
}

/** File a seal the server handed (null or anything malformed is left out). */
export function fileSeal(book: SealBook, seal: EditUndo | null | undefined): void {
  if (!seal || typeof seal.seal !== "string" || !seal.text || typeof seal.text !== "object") return;
  const { title, description, labels } = seal.text;
  if (typeof title !== "string" || typeof description !== "string" || !Array.isArray(labels)) return;
  book.set(keyOf(seal.text), seal);
}

/** The seal the server handed for exactly this copy's words, or null when it handed none. */
export function sealFor(book: SealBook, spec: Pick<SetSpec, "title" | "description" | "marks" | "cameras">): EditUndo | null {
  return book.get(wordsKey(spec)) ?? null;
}

/** Whether two copies have the same words (a data comparison: title, description, labels). */
export function sameWords(a: Pick<SetSpec, "title" | "description" | "marks" | "cameras">, b: Pick<SetSpec, "title" | "description" | "marks" | "cameras">): boolean {
  return wordsKey(a) === wordsKey(b);
}
