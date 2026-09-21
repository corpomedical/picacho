// Who is in a character's photos (2026-09-21, Helios R1). Reference photos
// can put a person's character into any set, so Picacho asks once who is in
// the photos, keeps the answer with the exact photos it was given for, and
// asks again when the photos change (the operator's decision). Pure: the
// form, the set page, the actions and the tests share it; the table lives
// in likeness-store.ts alone.

/** The notice the answer was given under: set by the server, never by the page. */
export const LIKENESS_NOTICE_VERSION = "2026-09-21";
/** How it was given: a choice among the answers, ticked. */
export const LIKENESS_METHOD = "checkbox";
/** The three answers, in the order the form shows them. */
export const LIKENESS_ANSWERS = ["me", "permission", "not_a_person"] as const;
export type LikenessAnswer = (typeof LIKENESS_ANSWERS)[number];
/** Where it was given. */
export type LikenessPlace = "character_form" | "helios_cast" | "character_page";

/** An answer as sent, or null for anything else. */
export function parseLikeness(raw: unknown): LikenessAnswer | null {
  return typeof raw === "string" && (LIKENESS_ANSWERS as readonly string[]).includes(raw) ? (raw as LikenessAnswer) : null;
}

/**
 * The photos an answer is about, as one short key: the stored paths,
 * sorted (a new order is the same photos), FNV-1a over them. Any photo
 * added or taken away is another key, and asks again.
 */
export function photosHash(paths: readonly string[]): string {
  const text = [...paths].sort().join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${paths.length}-${h.toString(16).padStart(8, "0")}`;
}

/** The latest answer kept for a character, as the store reads it. */
export type LikenessRecord = { answer: LikenessAnswer; photosHash: string; consentedAt: string };

/**
 * Whether a character must be asked before its photos are used: it has
 * photos, and no answer was kept for exactly these photos.
 */
export function needsLikenessAnswer(i: { paths: readonly string[]; record: LikenessRecord | null }): boolean {
  if (i.paths.length === 0) return false;
  return !i.record || i.record.photosHash !== photosHash(i.paths);
}
