// Product checks, T1: the words read on a frame against the words that must
// be on the product (spec §1.8 T1; synthesis v2 #7).
//
// Two questions, answered separately and by arithmetic alone:
//
//   1. MATCH. Does one of the person's confirmed label strings appear in
//      what was read? "Appears" is approximate substring matching: the
//      confirmed string is aligned against the whole reading (all lines
//      joined, so a label read as two lines still counts) with free start
//      and end, and the similarity is 1 − edits / length of the confirmed
//      string. At or above LABEL_MATCH_SIMILARITY (0.85) it is there.
//
//   2. CONFLICT. Was anything read that the product does not carry? A line
//      conflicts when it has at least CONFLICT_MIN_LETTERS letters and
//      appears (similarity at least CONFLICT_SIMILARITY, 0.5) in NONE of:
//      the confirmed strings, and ALL the text read from the product's own
//      reference photos (v2 #7: an ingredients line or a size on the back
//      is on the product even though nobody ticked it). Numbers alone never
//      conflict: a price, a volume or a date read at an angle is not a
//      different product.
//
// Normalising, both sides: Unicode NFKD, diacritics dropped, case folded,
// everything but letters and digits removed. "Café Crème 12 fl. oz" and
// "CAFE CREME 12FLOZ" are the same string.
//
// Pure, alias-free, no imports: tested as it is.

/** A confirmed string counts as read at or above this similarity (spec §1.8). */
export const LABEL_MATCH_SIMILARITY = 0.85;
/** A line read that appears nowhere on the product below this similarity is conflicting text (spec §1.8). */
export const CONFLICT_SIMILARITY = 0.5;
/** A conflicting line needs at least this many letters (spec §1.8: "a string of 3+ characters"; digits alone never conflict). */
export const CONFLICT_MIN_LETTERS = 3;
/** Longest string compared, after normalising (a label line is at most 80 characters, ocr.ts). */
const MAX_NEEDLE = 120;
/** Longest text searched, after normalising (every line of five reference photos fits). */
const MAX_HAYSTACK = 12_000;

/** Letters and digits only, diacritics dropped, case folded. */
export function normaliseForMatch(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en")
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function letterCount(s: string): number {
  let n = 0;
  for (const ch of s) if (/\p{L}/u.test(ch)) n++;
  return n;
}

/** Plain edit distance (insert, delete, substitute), on code points. */
export function editDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  let prev = new Array<number>(y.length + 1);
  let cur = new Array<number>(y.length + 1);
  for (let j = 0; j <= y.length; j++) prev[j] = j;
  for (let i = 1; i <= x.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const sub = prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1);
      cur[j] = Math.min(sub, prev[j] + 1, cur[j - 1] + 1);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[y.length];
}

/** 1 − distance / the longer length: 1 is identical, 0 shares nothing. Both already normalised. */
export function similarity(a: string, b: string): number {
  const longer = Math.max(Array.from(a).length, Array.from(b).length);
  if (longer === 0) return 1;
  return 1 - editDistance(a, b) / longer;
}

/**
 * How well `needle` appears somewhere inside `haystack` (both normalised):
 * the fewest edits that turn needle into any stretch of haystack (Sellers'
 * approximate substring match: the stretch may start and end anywhere), as
 * 1 − edits / needle length. 1 = it is there exactly; an empty needle is
 * trivially there; an empty haystack holds nothing.
 */
export function appearsIn(needle: string, haystack: string): number {
  const n = Array.from(needle).slice(0, MAX_NEEDLE);
  const h = Array.from(haystack).slice(0, MAX_HAYSTACK);
  if (n.length === 0) return 1;
  if (h.length === 0) return 0;
  // Column over the haystack: row 0 is all zeros (a match may start anywhere).
  let prev = new Array<number>(h.length + 1).fill(0);
  let cur = new Array<number>(h.length + 1);
  for (let i = 1; i <= n.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= h.length; j++) {
      const sub = prev[j - 1] + (n[i - 1] === h[j - 1] ? 0 : 1);
      cur[j] = Math.min(sub, prev[j] + 1, cur[j - 1] + 1);
    }
    [prev, cur] = [cur, prev];
  }
  let best = Infinity;
  for (let j = 0; j <= h.length; j++) if (prev[j] < best) best = prev[j];
  return Math.max(0, 1 - best / n.length);
}

export type LabelReadout = {
  /** The best similarity any confirmed string reached in what was read; null when there are no confirmed strings. */
  best: number | null;
  /** The confirmed string that reached it. */
  bestString: string | null;
  /** True when some confirmed string is there (best ≥ LABEL_MATCH_SIMILARITY). */
  matched: boolean;
  /** The first line read that the product does not carry (as read, trimmed to 80), or null. */
  conflict: string | null;
  /** Every line read, as read (for the record). */
  lines: string[];
};

function cleanLines(lines: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  for (const line of lines ?? []) {
    if (typeof line !== "string") continue;
    const t = line.replace(/\s+/g, " ").trim();
    if (t) out.push(Array.from(t).slice(0, 80).join(""));
    if (out.length >= 200) break;
  }
  return out;
}

/**
 * T1 for one frame: the lines read on it against the card's confirmed
 * strings and every line read on the product's own photos.
 */
export function readLabel(input: {
  lines: readonly unknown[] | null | undefined;
  expected: readonly string[];
  referenceText: readonly string[];
}): LabelReadout {
  const lines = cleanLines(input.lines);
  const read = lines.map(normaliseForMatch).join("");
  const expected = input.expected.map((s) => ({ raw: s, norm: normaliseForMatch(s) })).filter((e) => e.norm.length > 0);

  let best: number | null = null;
  let bestString: string | null = null;
  for (const e of expected) {
    const s = appearsIn(e.norm, read);
    if (best === null || s > best) {
      best = s;
      bestString = e.raw;
    }
  }

  // Everything the product is known to carry, as one text: a line read that
  // straddles two of its lines still appears in it.
  const corpus = [...expected.map((e) => e.norm), ...input.referenceText.map(normaliseForMatch)].join("");
  let conflict: string | null = null;
  for (const line of lines) {
    const norm = normaliseForMatch(line);
    if (letterCount(norm) < CONFLICT_MIN_LETTERS) continue;
    if (appearsIn(norm, corpus) < CONFLICT_SIMILARITY) {
      conflict = line;
      break;
    }
  }

  return {
    best: best === null ? null : Math.round(best * 1000) / 1000,
    bestString,
    matched: best !== null && best >= LABEL_MATCH_SIMILARITY,
    conflict,
    lines,
  };
}
