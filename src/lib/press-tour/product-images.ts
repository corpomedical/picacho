// Press Tour: a product's pictures, made safe and ordinary before anyone
// sees them (spec §1.1 step 3, critique #33).
//
// For each candidate URL (extract-page.ts ranks them), in order:
//   1. download through safe-fetch (https, public addresses only, pinned,
//      12 MB decoded cap, magic-byte typed; SVG refused with
//      "Upload your logo as a PNG");
//   2. check the bytes again here — the same gate serves photos a person
//      uploads, which never went through safe-fetch — JPEG, PNG, WebP, AVIF;
//   3. read the header with sharp under limitInputPixels (a 60,000 × 60,000
//      PNG of a few hundred bytes is refused from its header, before any
//      pixel is decoded);
//   4. refuse anything under 512 px on the short side (spec: the label must be
//      legible, and Kling keeps only text that is legible in the upload) —
//      and anything the 2048 px long-edge cap in step 5 would take under 512
//      (a strip or banner longer than about 4:1, e.g. 600 × 3000 would come
//      out 410 × 2048), so EVERY kept picture is at least 512 on its short
//      side, not just every downloaded one;
//   5. decode (first frame only; truncated files refused), apply the EXIF
//      rotation, cap the long edge at 2048 px, and re-encode: PNG when the
//      picture has an alpha channel (a cut-out product must keep its
//      transparency), JPEG q92 4:4:4 otherwise. sharp writes no metadata
//      unless asked — EXIF (GPS, camera serials), XMP, IPTC and ICC are all
//      gone, and the pixels are sRGB;
//   6. drop duplicates — the same picture at another size, quality or format
//      (a shop serves one photo at five widths). Two pictures are the same when
//      they have the same bytes, or when ALL of these hold:
//        - the same shape (aspect ratios within 3%);
//        - the same mean colour (within 24, RGB distance), so a red and a blue
//          colourway of one product stay two pictures;
//        - the 64-bit DCT perceptual hash agrees to within 6 bits, counting only
//          bits that are clear of the median. A centred, symmetric packshot has
//          DCT terms that are zero by symmetry; their bits are noise from the
//          JPEG encoder and flip between re-encodes (measured 2026-09-25: a
//          centred disc drifted 6–8 bits between sizes while asymmetric
//          pictures stayed at 0), so they are masked out of the comparison;
//        - and a close look agrees: on 64 × 64 grey thumbnails no 8 × 8 block
//          differs by more than 16 levels on average. The hash only sees low
//          frequencies, so the front and back of one bottle (same silhouette,
//          different label) can hash alike; the block check tells them apart
//          (measured: re-encodes ≤ 6.8, a different label 79–111). The person
//          needs both angles, so a label difference is never a duplicate;
//   7. keep at most 8, in the candidates' order.
//
// Bounded work: at most 16 candidates are tried, 4 at a time, and none is
// started after the 25 s deadline (in-flight ones are aborted then). Once 8
// are kept, nothing new starts. The result is deterministic in the input
// order: a picture is only kept once every candidate before it has settled.
//
// The English sentence for an SVG comes from safe-fetch (SVG_LOGO_REFUSED)
// so the product card and the brand kit say the same thing.
//
// Server-only (sharp, node:crypto). Relative imports only: tested as it is.

import { createHash } from "node:crypto";
import sharp, { type Metadata, type OutputInfo } from "sharp";
import {
  ALLOWED_IMAGE_TYPES,
  SVG_LOGO_REFUSED,
  SafeFetchError,
  safeFetch,
  sniffImageType,
  type SafeFetchErrorCode,
  type SafeFetchOptions,
} from "./safe-fetch";

export const MAX_PRODUCT_IMAGES = 8;
export const MAX_CANDIDATES_TRIED = 16;
export const MIN_SHORT_SIDE = 512;
/** The same ceiling the image-provider normaliser uses (openai-images.ts). */
export const MAX_INPUT_PIXELS = 50_000_000;
export const MAX_LONG_EDGE = 2048;
/** Differing bits among the trusted (masked-in) ones. Re-encodes of one picture land at 0–2. */
export const DUPLICATE_MAX_HASH_DISTANCE = 6;
/** Euclidean distance between mean sRGB colours (0–441). */
export const DUPLICATE_MAX_COLOUR_DISTANCE = 24;
/** Mean absolute grey difference of the worst 8 × 8 block of the 64 × 64 thumbnails (0–255). */
export const DUPLICATE_MAX_BLOCK_DIFFERENCE = 16;
/** Relative difference of width ÷ height. */
export const DUPLICATE_MAX_ASPECT_DIFFERENCE = 0.03;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_DEADLINE_MS = 25_000;
const JPEG_QUALITY = 92;

export type ProductImageRejection =
  | "invalid_url" // safe-fetch refused the URL itself
  | "fetch_failed" // DNS, a blocked address, a status, a connection …
  | "timeout" // the fetch or the whole batch ran out of time
  | "too_large" // over the 12 MB decoded cap
  | "svg_refused"
  | "not_an_image"
  | "unsupported_format" // GIF, HEIC and other formats we do not take
  | "too_many_pixels"
  | "too_small" // short side under 512 px
  | "bad_shape" // a strip or banner: under 512 px on the short side once the long edge is capped at 2048
  | "decode_failed" // corrupt or truncated
  | "duplicate";

export class ProductImageError extends Error {
  readonly reason: ProductImageRejection;
  constructor(reason: ProductImageRejection, message?: string) {
    super(message ?? reason);
    this.name = "ProductImageError";
    this.reason = reason;
  }
}

/** What two pictures are compared by. */
export interface PictureFingerprint {
  /** 64-bit DCT perceptual hash, 16 hex characters (storable). */
  hash: string;
  /** Which bits of `hash` are clear of the median and can be trusted, 16 hex characters. */
  mask: string;
  /** Mean sRGB colour (over a white background where transparent). */
  colour: [number, number, number];
  /** Width ÷ height. */
  aspect: number;
  /** 64 × 64 grey thumbnail, row-major, for the close look. */
  thumb: Uint8Array;
  /** sha256 of the ORIGINAL bytes, hex. */
  sha256: string;
}

export interface NormalizedProductImage {
  /** Re-encoded bytes: no metadata, sRGB, long edge ≤ 2048 px. */
  data: Buffer;
  mime: "image/jpeg" | "image/png";
  width: number;
  height: number;
  bytes: number;
  /** Same as fingerprint.hash — the storable perceptual hash. */
  hash: string;
  /** Same as fingerprint.sha256. */
  sha256: string;
  fingerprint: PictureFingerprint;
}

export interface PreparedProductImage extends NormalizedProductImage {
  /** The candidate URL as given. */
  sourceUrl: string;
  /** The URL finally read, after redirects. */
  finalUrl: string;
}

export interface RejectedProductImage {
  url: string;
  reason: ProductImageRejection;
  /** The English sentence a person reads, where one exists (SVG). */
  message: string | null;
  /** For logs: the safe-fetch code, or the kept picture a duplicate matched. */
  detail: string | null;
}

export interface PreparedProductImages {
  images: PreparedProductImage[];
  rejected: RejectedProductImage[];
}

export interface FetchedImage {
  body: Buffer;
  /** The URL finally read. */
  url: string;
}

export interface ProductImageDeps {
  /** Downloads one picture. Defaults to safeFetch(kind "image"); injected in tests. */
  fetchImage?: (url: string, signal: AbortSignal) => Promise<FetchedImage>;
  /** Passed to the default safeFetch (a test's resolver and transport, a lower timeout). */
  fetchOptions?: Omit<SafeFetchOptions, "kind" | "signal">;
  /** 1–8. */
  maxImages?: number;
  /** 1–16. */
  maxCandidates?: number;
  /** 1–8. */
  concurrency?: number;
  /** Whole batch, ms (max 60 s). */
  deadlineMs?: number;
  /** Lower the pixel ceiling (never raise it). */
  maxInputPixels?: number;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Perceptual hash and the close look
// ---------------------------------------------------------------------------

const HASH_SIDE = 32;
const HASH_LOW = 8;
const THUMB_SIDE = 64;
const BLOCK_SIDE = 8;
/** A bit is trusted when its coefficient sits at least this share of the largest deviation away from the median. */
const MASK_SHARE = 0.05;
const MASK_FLOOR = 16;
const COSINES: Float64Array = (() => {
  const table = new Float64Array(HASH_LOW * HASH_SIDE);
  for (let u = 0; u < HASH_LOW; u++) {
    for (let x = 0; x < HASH_SIDE; x++) table[u * HASH_SIDE + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * HASH_SIDE));
  }
  return table;
})();

function bitsToHex(bits: readonly boolean[]): string {
  let hex = "";
  for (let nibble = 0; nibble < bits.length / 4; nibble++) {
    let value = 0;
    for (let bit = 0; bit < 4; bit++) value = (value << 1) | (bits[nibble * 4 + bit] ? 1 : 0);
    hex += value.toString(16);
  }
  return hex;
}

/**
 * The classic 64-bit pHash of a 32 × 32 greyscale picture (row-major, any
 * scale): the 8 × 8 lowest frequencies of its 2-D DCT, each bit "above the
 * median of the 63 AC terms". `mask` marks the bits whose term is clear of
 * the median (at least 5% of the largest deviation, and above float noise)
 * — the others are noise. The DC bit is never trusted.
 */
export function perceptualHash(gray: ArrayLike<number>): { hash: string; mask: string } {
  if (gray.length !== HASH_SIDE * HASH_SIDE) throw new RangeError("perceptualHash needs 32 x 32 values");
  const rows = new Float64Array(HASH_SIDE * HASH_LOW); // rows[y][u]
  for (let y = 0; y < HASH_SIDE; y++) {
    for (let u = 0; u < HASH_LOW; u++) {
      let sum = 0;
      for (let x = 0; x < HASH_SIDE; x++) sum += gray[y * HASH_SIDE + x] * COSINES[u * HASH_SIDE + x];
      rows[y * HASH_LOW + u] = sum;
    }
  }
  const coefficients = new Float64Array(HASH_LOW * HASH_LOW); // [v][u]
  for (let v = 0; v < HASH_LOW; v++) {
    for (let u = 0; u < HASH_LOW; u++) {
      let sum = 0;
      for (let y = 0; y < HASH_SIDE; y++) sum += rows[y * HASH_LOW + u] * COSINES[v * HASH_SIDE + y];
      coefficients[v * HASH_LOW + u] = sum;
    }
  }
  const ac = Array.from(coefficients.subarray(1)).sort((a, b) => a - b);
  const median = (ac[31] + ac[32]) / 2;
  let spread = 0;
  for (let i = 1; i < coefficients.length; i++) spread = Math.max(spread, Math.abs(coefficients[i] - median));
  // An absolute floor too: on this unnormalised DCT a one-grey-level cosine
  // scores ~256, so 16 is a sixteenth of a level — below it is float noise.
  const floor = Math.max(spread * MASK_SHARE, MASK_FLOOR);
  const bits: boolean[] = [];
  const trusted: boolean[] = [];
  for (let i = 0; i < coefficients.length; i++) {
    bits.push(coefficients[i] > median);
    // The DC bit is 1 for every picture that is not black: it never tells two apart.
    trusted.push(i > 0 && Math.abs(coefficients[i] - median) >= floor);
  }
  return { hash: bitsToHex(bits), mask: bitsToHex(trusted) };
}

const POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
const HEX = /^[0-9a-f]*$/i;

/** Bits that differ between two hashes of equal length (hex); 64 when they cannot be compared. */
export function hammingDistance(a: string, b: string, mask = "f".repeat(a.length)): number {
  if (a.length !== b.length || mask.length !== a.length || !HEX.test(a) || !HEX.test(b) || !HEX.test(mask)) return 64;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    distance += POPCOUNT[(parseInt(a.charAt(i), 16) ^ parseInt(b.charAt(i), 16)) & parseInt(mask.charAt(i), 16)];
  }
  return distance;
}

function andHex(a: string, b: string): string {
  if (a.length !== b.length || !HEX.test(a) || !HEX.test(b)) return "0".repeat(Math.max(a.length, b.length));
  let out = "";
  for (let i = 0; i < a.length; i++) out += (parseInt(a.charAt(i), 16) & parseInt(b.charAt(i), 16)).toString(16);
  return out;
}

export function colourDistance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The worst 8 × 8 block's mean absolute difference between two 64 × 64 thumbnails. */
export function worstBlockDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== THUMB_SIDE * THUMB_SIDE || b.length !== a.length) return 255;
  const blocks = THUMB_SIDE / BLOCK_SIDE;
  let worst = 0;
  for (let by = 0; by < blocks; by++) {
    for (let bx = 0; bx < blocks; bx++) {
      let sum = 0;
      for (let y = 0; y < BLOCK_SIDE; y++) {
        const row = (by * BLOCK_SIDE + y) * THUMB_SIDE + bx * BLOCK_SIDE;
        for (let x = 0; x < BLOCK_SIDE; x++) sum += Math.abs(a[row + x] - b[row + x]);
      }
      worst = Math.max(worst, sum / (BLOCK_SIDE * BLOCK_SIDE));
    }
  }
  return worst;
}

/** The same picture at another size, quality or format (see the header, step 6). */
export function isSamePicture(a: PictureFingerprint, b: PictureFingerprint): boolean {
  if (a.sha256 === b.sha256) return true;
  if (!(a.aspect > 0) || !(b.aspect > 0) || Math.abs(a.aspect / b.aspect - 1) > DUPLICATE_MAX_ASPECT_DIFFERENCE) return false;
  if (colourDistance(a.colour, b.colour) > DUPLICATE_MAX_COLOUR_DISTANCE) return false;
  if (hammingDistance(a.hash, b.hash, andHex(a.mask, b.mask)) > DUPLICATE_MAX_HASH_DISTANCE) return false;
  return worstBlockDifference(a.thumb, b.thumb) <= DUPLICATE_MAX_BLOCK_DIFFERENCE;
}

/** Fingerprints a (re-encoded) picture: one small decode to 64 × 64 over white. */
export async function fingerprintPicture(data: Buffer, sha256: string): Promise<PictureFingerprint> {
  const { data: raw, info } = await sharp(data)
    .flatten({ background: "#ffffff" })
    .resize(THUMB_SIDE, THUMB_SIDE, { fit: "fill" })
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const meta = await sharp(data).metadata();
  const channels = info.channels;
  const thumb = new Uint8Array(THUMB_SIDE * THUMB_SIDE);
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < thumb.length; i++) {
    const o = i * channels;
    const pr = raw[o];
    const pg = channels >= 3 ? raw[o + 1] : pr;
    const pb = channels >= 3 ? raw[o + 2] : pr;
    thumb[i] = Math.round(0.299 * pr + 0.587 * pg + 0.114 * pb);
    r += pr;
    g += pg;
    b += pb;
  }
  // The 32 × 32 the hash wants is the 64 × 64 averaged in 2 × 2 squares.
  const gray = new Float64Array(HASH_SIDE * HASH_SIDE);
  for (let y = 0; y < HASH_SIDE; y++) {
    for (let x = 0; x < HASH_SIDE; x++) {
      const o = 2 * y * THUMB_SIDE + 2 * x;
      gray[y * HASH_SIDE + x] = (thumb[o] + thumb[o + 1] + thumb[o + THUMB_SIDE] + thumb[o + THUMB_SIDE + 1]) / 4;
    }
  }
  const n = thumb.length;
  const { hash, mask } = perceptualHash(gray);
  return {
    hash,
    mask,
    colour: [Math.round(r / n), Math.round(g / n), Math.round(b / n)],
    aspect: meta.width && meta.height ? meta.width / meta.height : 0,
    thumb,
    sha256,
  };
}

// ---------------------------------------------------------------------------
// One picture
// ---------------------------------------------------------------------------

function isPixelLimit(err: unknown): boolean {
  return /pixel limit/i.test(errorMessage(err));
}

/**
 * Checks, decodes and re-encodes one picture's bytes (from a URL or an
 * upload). Throws ProductImageError with the reason.
 */
export async function normalizeProductImage(input: Buffer, opts: { maxInputPixels?: number } = {}): Promise<NormalizedProductImage> {
  if (!Buffer.isBuffer(input) || input.length === 0) throw new ProductImageError("not_an_image");
  const sniffed = sniffImageType(input);
  if (sniffed === "image/svg+xml") throw new ProductImageError("svg_refused", SVG_LOGO_REFUSED);
  if (sniffed === null) throw new ProductImageError("not_an_image");
  if (!ALLOWED_IMAGE_TYPES.has(sniffed)) throw new ProductImageError("unsupported_format", `${sniffed} is not accepted`);

  const limit = clampInt(opts.maxInputPixels, MAX_INPUT_PIXELS, 1, MAX_INPUT_PIXELS);
  const options = { limitInputPixels: limit, failOn: "error" as const, sequentialRead: true };

  let meta: Metadata;
  try {
    meta = await sharp(input, options).metadata();
  } catch (err) {
    throw new ProductImageError(isPixelLimit(err) ? "too_many_pixels" : "decode_failed", errorMessage(err));
  }
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new ProductImageError("decode_failed", "no dimensions");
  if (width * height > limit) throw new ProductImageError("too_many_pixels");
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  if (shortSide < MIN_SHORT_SIDE) throw new ProductImageError("too_small");
  // sharp rounds the capped short side (measured 2026-09-25: 513 × 2053 →
  // 512 × 2048, 600 × 3000 → 410 × 2048), so round the same way here.
  if (longSide > MAX_LONG_EDGE && Math.round((shortSide * MAX_LONG_EDGE) / longSide) < MIN_SHORT_SIDE) {
    throw new ProductImageError(
      "bad_shape",
      `${width} x ${height} would be under ${MIN_SHORT_SIDE} px on its short side after the ${MAX_LONG_EDGE} px cap`,
    );
  }
  if (!["jpeg", "png", "webp", "heif", "avif"].includes(String(meta.format))) {
    throw new ProductImageError("unsupported_format", `decoded as ${String(meta.format)}`);
  }

  let data: Buffer;
  let info: OutputInfo;
  const withAlpha = meta.hasAlpha === true;
  try {
    const pipeline = sharp(input, options)
      .rotate() // honour the EXIF orientation; the EXIF itself is not written back
      .resize({ width: MAX_LONG_EDGE, height: MAX_LONG_EDGE, fit: "inside", withoutEnlargement: true });
    const encoded = withAlpha
      ? pipeline.png()
      : pipeline.jpeg({ quality: JPEG_QUALITY, chromaSubsampling: "4:4:4" });
    ({ data, info } = await encoded.toBuffer({ resolveWithObject: true }));
  } catch (err) {
    throw new ProductImageError(isPixelLimit(err) ? "too_many_pixels" : "decode_failed", errorMessage(err));
  }
  // Belt and braces for the shape check above: what leaves here is never
  // under 512 on its short side, whatever rounding the resize chose.
  if (Math.min(info.width, info.height) < MIN_SHORT_SIDE) {
    throw new ProductImageError("too_small", `re-encoded to ${info.width} x ${info.height}`);
  }

  const sha256 = createHash("sha256").update(input).digest("hex");
  let fingerprint: PictureFingerprint;
  try {
    fingerprint = await fingerprintPicture(data, sha256);
  } catch (err) {
    throw new ProductImageError("decode_failed", errorMessage(err));
  }
  return {
    data,
    mime: withAlpha ? "image/png" : "image/jpeg",
    width: info.width,
    height: info.height,
    bytes: data.length,
    hash: fingerprint.hash,
    sha256,
    fingerprint,
  };
}

// ---------------------------------------------------------------------------
// The batch
// ---------------------------------------------------------------------------

const URL_CODES: ReadonlySet<SafeFetchErrorCode> = new Set([
  "invalid_url",
  "scheme_not_allowed",
  "port_not_allowed",
  "credentials_in_url",
  "host_not_allowed",
]);

function rejectionFromFetch(url: string, err: unknown, signal: AbortSignal): RejectedProductImage {
  if (err instanceof SafeFetchError) {
    const code = err.code;
    const reason: ProductImageRejection =
      code === "svg_refused"
        ? "svg_refused"
        : code === "too_large"
          ? "too_large"
          : code === "not_an_image"
            ? "not_an_image"
            : code === "content_type_not_allowed"
              ? "unsupported_format"
              : code === "timeout" || code === "aborted"
                ? "timeout"
                : URL_CODES.has(code)
                  ? "invalid_url"
                  : "fetch_failed";
    return { url, reason, message: reason === "svg_refused" ? SVG_LOGO_REFUSED : null, detail: code };
  }
  if (signal.aborted) return { url, reason: "timeout", message: null, detail: "deadline" };
  return { url, reason: "fetch_failed", message: null, detail: errorMessage(err).slice(0, 200) };
}

type Outcome = { ok: true; image: PreparedProductImage } | { ok: false; rejection: RejectedProductImage };

function defaultFetchImage(options: ProductImageDeps["fetchOptions"]): (url: string, signal: AbortSignal) => Promise<FetchedImage> {
  return async (url, signal) => {
    const result = await safeFetch(url, { ...(options ?? {}), kind: "image", signal });
    return { body: result.body, url: result.url };
  };
}

async function prepareOne(
  url: string,
  fetchImage: (url: string, signal: AbortSignal) => Promise<FetchedImage>,
  signal: AbortSignal,
  maxInputPixels: number,
): Promise<Outcome> {
  let fetched: FetchedImage;
  try {
    fetched = await fetchImage(url, signal);
  } catch (err) {
    return { ok: false, rejection: rejectionFromFetch(url, err, signal) };
  }
  try {
    const image = await normalizeProductImage(fetched.body, { maxInputPixels });
    return { ok: true, image: { ...image, sourceUrl: url, finalUrl: fetched.url || url } };
  } catch (err) {
    const reason = err instanceof ProductImageError ? err.reason : "decode_failed";
    return {
      ok: false,
      rejection: { url, reason, message: reason === "svg_refused" ? SVG_LOGO_REFUSED : null, detail: errorMessage(err).slice(0, 200) },
    };
  }
}

/**
 * Downloads, checks, cleans and de-duplicates a product's candidate pictures,
 * keeping at most 8 in the order given. Never throws for a bad candidate:
 * every candidate before the one that filled the 8th place, and not kept, is
 * in `rejected` with its reason (as is every one the deadline stopped). Once
 * 8 are kept, candidates after the 8th — including any already in flight —
 * are neither kept nor listed: they were not needed.
 */
export async function prepareProductImages(urls: readonly string[], deps: ProductImageDeps = {}): Promise<PreparedProductImages> {
  const maxImages = clampInt(deps.maxImages, MAX_PRODUCT_IMAGES, 1, MAX_PRODUCT_IMAGES);
  const maxCandidates = clampInt(deps.maxCandidates, MAX_CANDIDATES_TRIED, 1, MAX_CANDIDATES_TRIED);
  const concurrency = clampInt(deps.concurrency, DEFAULT_CONCURRENCY, 1, 8);
  const deadlineMs = clampInt(deps.deadlineMs, DEFAULT_DEADLINE_MS, 1, 60_000);
  const maxInputPixels = clampInt(deps.maxInputPixels, MAX_INPUT_PIXELS, 1, MAX_INPUT_PIXELS);
  const fetchImage = deps.fetchImage ?? defaultFetchImage(deps.fetchOptions);

  const queue: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(urls) ? urls : []) {
    if (typeof raw !== "string") continue;
    const url = raw.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    queue.push(url);
    if (queue.length >= maxCandidates) break;
  }

  const kept: PreparedProductImage[] = [];
  const rejected: RejectedProductImage[] = [];
  const outcomes: Array<Outcome | undefined> = new Array<Outcome | undefined>(queue.length);
  let nextToStart = 0;
  let nextToCommit = 0;

  // Commit strictly in input order, so the result does not depend on which
  // download happened to finish first.
  const commitReady = () => {
    while (nextToCommit < queue.length && outcomes[nextToCommit] !== undefined) {
      const outcome = outcomes[nextToCommit] as Outcome;
      nextToCommit++;
      if (kept.length >= maxImages) continue;
      if (!outcome.ok) {
        rejected.push(outcome.rejection);
        continue;
      }
      const twin = kept.find((k) => isSamePicture(k.fingerprint, outcome.image.fingerprint));
      if (twin) {
        rejected.push({ url: outcome.image.sourceUrl, reason: "duplicate", message: null, detail: twin.sourceUrl });
        continue;
      }
      kept.push(outcome.image);
    }
  };

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), deadlineMs);
  const worker = async () => {
    for (;;) {
      if (kept.length >= maxImages || deadline.signal.aborted) return;
      const index = nextToStart++;
      if (index >= queue.length) return;
      outcomes[index] = await prepareOne(queue[index], fetchImage, deadline.signal, maxInputPixels);
      commitReady();
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
  } finally {
    clearTimeout(timer);
  }
  commitReady();

  // Candidates the deadline stopped before they started.
  if (deadline.signal.aborted && kept.length < maxImages) {
    for (let i = nextToCommit; i < queue.length; i++) {
      if (outcomes[i] === undefined) rejected.push({ url: queue[i], reason: "timeout", message: null, detail: "not_started" });
    }
  }
  return { images: kept, rejected };
}
