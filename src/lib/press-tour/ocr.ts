// Press Tour: the words printed on a product, read from its photos, as
// CANDIDATES the person ticks and corrects (spec §1.1 step 5).
//
// Google Cloud Vision TEXT_DETECTION over REST with GOOGLE_VISION_API_KEY
// (no SDK: one fetch per photo). $1.50 per 1,000 photos read (spec §1.1),
// at most OCR_MAX_IMAGES a product: ≤ 5 × $0.0015 = $0.0075 (synthesis §3.3).
//
// Nothing here decides anything. OCR proposes; the PERSON ticks the words
// that must appear and fixes their spelling, or ticks "No readable text on
// this product". Only confirmed words are ever judged later. So the rules
// below only tidy what is shown:
//   - each line of text read becomes one candidate, cleaned: Unicode NFC
//     (full-width Latin read as ordinary letters, ™ and ® left as printed),
//     control / invisible / bidi characters removed, spaces collapsed, stray
//     punctuation trimmed from both ends;
//   - at least 2 letters or digits, at most 80 characters (the card's limit
//     for one label string, types.ts CARD_LIMITS.labelString) — longer lines
//     are paragraphs (ingredients, legal text), not the words on the front;
//   - duplicates dropped ignoring case; the words seen on the most photos
//     first, then in reading order; at most 24.
//
// When GOOGLE_VISION_API_KEY is not set this answers { configured: false }
// and sends nothing: the card then asks the person to type the words
// themselves. A key that is set but refused, a busy service or a network
// failure is { configured: true, ok: false } with a reason, never a throw.
//
// Photos travel as bytes in the request body (never a link to them), the
// key in the X-Goog-Api-Key header (never in the URL, where proxies and
// logs keep it).
//
// Text read from a photo is data. It is shown to the person as candidates;
// nothing here hands it to a model.
//
// Server-only (sharp). Relative imports only: tested as it is.

import sharp from "sharp";
import { CARD_LIMITS } from "./types";

export const OCR_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
export const OCR_MAX_IMAGES = 5;
/** The photo is sent at most this big on its long edge: labels stay legible, the request stays small. */
export const OCR_IMAGE_EDGE = 2048;
/** A re-encoded photo bigger than this is not sent (Vision's JSON request limit sits above it, base64 included). */
export const OCR_MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const OCR_TIMEOUT_MS = 15_000;
export const CANDIDATES_MAX = 24;
export const CANDIDATE_MIN_ALNUM = 2;
export const CANDIDATE_MAX_CHARS = CARD_LIMITS.labelString;
/** Lines read per photo, at most (a page of small print is not a label). */
const MAX_LINES_PER_IMAGE = 200;
const MAX_INPUT_PIXELS = 50_000_000;

export type LabelReading =
  | { configured: false }
  | {
      configured: true;
      ok: true;
      /** What the card offers to tick, best first. */
      candidates: string[];
      /** Every cleaned line read, per photo sent (in order). For the later checks that compare against ALL text on the product. */
      lines: string[][];
      /** Photos Vision read (for the cost log). */
      imagesRead: number;
    }
  | { configured: true; ok: false; reason: "refused" | "busy" | "unavailable"; candidates: [] };

export interface OcrDeps {
  /** Defaults to process.env.GOOGLE_VISION_API_KEY. */
  apiKey?: string | null;
  timeoutMs?: number;
}

// Control characters (C0 except none — lines are split first — DEL, C1),
// zero-width and invisible formatting, bidi overrides and isolates, the BOM,
// and Unicode tag characters.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­͏؜᠎​-‏‪-‮⁠-⁯﻿]/g;
const TAG_CHARACTERS = /[\u{e0000}-\u{e007f}]/gu;
// Trimmed from both ends: punctuation and symbols, except the few a label
// really ends with (100%, ACME®, NO.1™, C+, WOW!, WHY?).
const EDGE_JUNK = /^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu;
const KEEP_AT_END = /[%®™©+!?]+$/u;

function alnumCount(s: string): number {
  let n = 0;
  for (const ch of s) if (/[\p{L}\p{N}]/u.test(ch)) n++;
  return n;
}

/** One line as a candidate, or null when it is not one (too short, too long, no letters or digits). */
export function normaliseLabelCandidate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw
    .normalize("NFC")
    // Full-width Latin (Ａ, １) as the ordinary letters; NFKC would do it but
    // would also turn ™ into "TM" and ® into "(R)", which is not what is printed.
    .replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ")
    .replace(INVISIBLE, " ")
    .replace(TAG_CHARACTERS, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  const tail = KEEP_AT_END.exec(s)?.[0] ?? "";
  s = s.replace(EDGE_JUNK, "");
  if (s && tail && !s.endsWith(tail)) s = `${s}${tail}`;
  s = s.trim();
  if (alnumCount(s) < CANDIDATE_MIN_ALNUM) return null;
  if (Array.from(s).length > CANDIDATE_MAX_CHARS) return null;
  return s;
}

/**
 * Pure: the candidates from each photo's lines. A word seen on more photos
 * ranks higher (it is on the product, not on one photo's backdrop); ties
 * keep reading order. Case-blind duplicates keep their first spelling.
 */
export function proposeLabelCandidates(perImage: readonly (readonly string[])[]): string[] {
  const seen = new Map<string, { text: string; photos: Set<number>; first: number }>();
  let order = 0;
  for (const [photo, lines] of perImage.entries()) {
    for (const line of lines.slice(0, MAX_LINES_PER_IMAGE)) {
      const text = normaliseLabelCandidate(line);
      if (!text) continue;
      const key = text.toLocaleLowerCase("en");
      const entry = seen.get(key);
      if (entry) entry.photos.add(photo);
      else seen.set(key, { text, photos: new Set([photo]), first: order++ });
    }
  }
  return [...seen.values()]
    .sort((a, b) => b.photos.size - a.photos.size || a.first - b.first)
    .slice(0, CANDIDATES_MAX)
    .map((e) => e.text);
}

/**
 * Pure: the lines Vision read in one photo's response, cleaned, or null
 * when the response carries an error or is not a response at all. Reads
 * fullTextAnnotation.text, else the first textAnnotation (the whole text).
 */
export function linesFromResponse(response: unknown): string[] | null {
  if (!response || typeof response !== "object") return null;
  const r = response as { error?: unknown; fullTextAnnotation?: { text?: unknown }; textAnnotations?: unknown };
  if (r.error && typeof r.error === "object") return null;
  let text: unknown = r.fullTextAnnotation?.text;
  if (typeof text !== "string" && Array.isArray(r.textAnnotations)) {
    const first = r.textAnnotations[0] as { description?: unknown } | undefined;
    text = first?.description;
  }
  if (typeof text !== "string") return [];
  const out: string[] = [];
  for (const line of text.slice(0, 64 * 1024).split(/\r?\n/)) {
    const cleaned = normaliseLabelCandidate(line);
    if (cleaned) out.push(cleaned);
    if (out.length >= MAX_LINES_PER_IMAGE) break;
  }
  return out;
}

/** A photo as Vision is sent it: upright, flattened on white, JPEG, long edge ≤ 2048. Null when it cannot be read. */
async function ocrBytes(input: Buffer): Promise<Buffer | null> {
  try {
    const out = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .rotate()
      .resize(OCR_IMAGE_EDGE, OCR_IMAGE_EDGE, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 90 })
      .toBuffer();
    return out.length <= OCR_MAX_IMAGE_BYTES ? out : null;
  } catch {
    return null;
  }
}

type OneRead = { lines: string[] } | { failure: "refused" | "busy" | "unavailable" };

async function readOne(bytes: Buffer, apiKey: string, timeoutMs: number): Promise<OneRead> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OCR_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        requests: [{ image: { content: bytes.toString("base64") }, features: [{ type: "TEXT_DETECTION" }] }],
      }),
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) return { failure: "refused" };
    if (res.status === 429) return { failure: "busy" };
    if (!res.ok) return { failure: "unavailable" };
    const data = (await res.json()) as { responses?: unknown[] } | null;
    const lines = linesFromResponse(Array.isArray(data?.responses) ? data.responses[0] : null);
    return lines ? { lines } : { failure: "unavailable" };
  } catch {
    return { failure: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads the text on up to OCR_MAX_IMAGES photos (normalised product
 * pictures) and proposes label candidates. Never throws.
 */
export async function readLabelText(images: readonly Buffer[], deps: OcrDeps = {}): Promise<LabelReading> {
  const apiKey = (deps.apiKey === undefined ? process.env.GOOGLE_VISION_API_KEY : deps.apiKey)?.trim();
  if (!apiKey) return { configured: false };
  const timeoutMs = Math.min(OCR_TIMEOUT_MS, Math.max(1, Math.floor(deps.timeoutMs ?? OCR_TIMEOUT_MS)));

  const photos = (Array.isArray(images) ? images : []).filter((b) => Buffer.isBuffer(b) && b.length > 0).slice(0, OCR_MAX_IMAGES);
  const prepared = (await Promise.all(photos.map(ocrBytes))).filter((b): b is Buffer => b !== null);
  if (prepared.length === 0) return { configured: true, ok: true, candidates: [], lines: [], imagesRead: 0 };

  const reads = await Promise.all(prepared.map((bytes) => readOne(bytes, apiKey, timeoutMs)));
  const lines: string[][] = [];
  const failures: ("refused" | "busy" | "unavailable")[] = [];
  for (const read of reads) {
    if ("lines" in read) lines.push(read.lines);
    else failures.push(read.failure);
  }
  if (lines.length === 0) {
    const reason = failures.includes("refused") ? "refused" : failures.includes("busy") ? "busy" : "unavailable";
    console.error(`[press-tour] label reading failed on every photo (${reason})`);
    return { configured: true, ok: false, reason, candidates: [] };
  }
  console.info(`[press-tour] label reading: ${lines.length} photo(s) read at $0.0015 each`);
  return { configured: true, ok: true, candidates: proposeLabelCandidates(lines), lines, imagesRead: lines.length };
}
