// Press Tour: a product's colours, 2 to 4 of them, read from its own photo
// (spec §1.1 step 7; the card's palette is editable, so this is a first
// draft the person corrects, never a verdict).
//
// Local and free: sharp reads the pixels, nothing leaves the server.
//
//   1. Optional crop: a box on the photo (0..1 of each side), e.g. the logo
//      box or a product crop. Without a box the whole picture is read.
//   2. Is there a matte? sharp's stats() says whether any pixel is
//      transparent. A cut-out product (a PNG with its background removed) is
//      all product: every opaque pixel counts, white and black included.
//   3. No matte: the background is still in the picture. A packshot sits on
//      white (or black) far more often than not, and that background would
//      win every count. So the BORDER decides: when at least half the border
//      is near-white, near-white pixels are left out; the same for
//      near-black. A black can on white keeps its black; a white bottle on
//      black keeps its white. When leaving the background out would leave
//      almost nothing (a white product photographed on white), nothing is
//      left out.
//   4. The kept pixels are binned (5 bits a channel) and the bins are
//      grouped greedily, biggest first, by perceptual distance (CIE76 ΔE in
//      Lab): a bin joins the nearest group closer than MERGE_DELTA_E, or
//      starts its own. Shading on one surface lands in one group; red and
//      orange stay two.
//   5. The biggest groups with at least MIN_SHARE of the kept pixels are the
//      palette, biggest first, up to 4. A second colour is always offered
//      when the picture has one at all (MIN_SECOND_SHARE), because the card
//      asks for 2 to 4.
//
// Deterministic: the same picture gives the same palette. The output is
// the form the database stores: lowercase #rrggbb (types.ts HEX_COLOUR).
//
// Input is a NORMALISED picture (product-images.ts normalizeProductImage or
// a logo from brand-kit-import.ts): already upright, metadata stripped. A
// raw upload goes through normalizeProductImage first.
//
// Server-only (sharp). Relative imports only: tested as it is.

import sharp from "sharp";

export const PALETTE_MAX = 4;
export const PALETTE_MIN = 2;
/** The picture is read at this size: enough for colours, cheap to count. */
export const PALETTE_SAMPLE_EDGE = 64;
/** The same ceiling product-images.ts decodes under. */
const MAX_INPUT_PIXELS = 50_000_000;
/** A group needs this share of the kept pixels to be a palette colour. */
export const MIN_SHARE = 0.04;
/** ...except the second colour, offered down to this share (the card asks for at least 2). */
export const MIN_SECOND_SHARE = 0.01;
/** Bins closer than this (CIE76) are one colour. */
export const MERGE_DELTA_E = 18;
/** A border at least this share near-white (or near-black) is a background. */
const BACKGROUND_BORDER_SHARE = 0.5;
/** Leaving the background out must leave at least this share of the pixels, or nothing is left out. */
const MIN_FOREGROUND_SHARE = 0.05;
const MAX_GROUPS = 48;

/** A box on the picture, each value 0..1 of that side (the card's logo box shape). */
export type PaletteBox = { x: number; y: number; w: number; h: number };

export interface PaletteOptions {
  /** Read only this part of the picture. */
  box?: PaletteBox | null;
  /** 1–4. */
  max?: number;
  /** Lower the decode ceiling (never raise it). */
  maxInputPixels?: number;
}

type Rgb = [number, number, number];
type Lab = [number, number, number];

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function toHex([r, g, b]: Rgb): string {
  const h = (v: number) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** sRGB (0–255) to CIE Lab under D65. */
export function rgbToLab([r, g, b]: Rgb): Lab {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference. */
export function deltaE(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Near-white: every channel high and little colour in it. */
export function isNearWhite(r: number, g: number, b: number): boolean {
  return Math.min(r, g, b) >= 232 && Math.max(r, g, b) - Math.min(r, g, b) <= 20;
}

/** Near-black: every channel low. */
export function isNearBlack(r: number, g: number, b: number): boolean {
  return Math.max(r, g, b) <= 32;
}

type Group = { weight: number; sum: [number, number, number]; lab: Lab };

/**
 * Pure: the palette of an RGBA pixel buffer (row-major, 4 bytes a pixel).
 * `matte` = the picture has transparency, so every opaque pixel is product.
 */
export function paletteFromPixels(
  rgba: Uint8Array,
  width: number,
  height: number,
  opts: { matte: boolean; max?: number },
): string[] {
  const max = clampInt(opts.max, PALETTE_MAX, 1, PALETTE_MAX);
  const count = Math.min(width * height, Math.floor(rgba.length / 4));
  if (!(width > 0 && height > 0) || count === 0) return [];

  // Which near-white / near-black pixels are background (no matte only).
  let dropWhite = false;
  let dropBlack = false;
  if (!opts.matte) {
    let border = 0;
    let white = 0;
    let black = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (y !== 0 && y !== height - 1 && x !== 0 && x !== width - 1) continue;
        const i = (y * width + x) * 4;
        if (i + 3 >= rgba.length || rgba[i + 3] < 128) continue;
        border++;
        if (isNearWhite(rgba[i], rgba[i + 1], rgba[i + 2])) white++;
        else if (isNearBlack(rgba[i], rgba[i + 1], rgba[i + 2])) black++;
      }
    }
    dropWhite = border > 0 && white / border >= BACKGROUND_BORDER_SHARE;
    dropBlack = border > 0 && black / border >= BACKGROUND_BORDER_SHARE;
  }

  const collect = (skipWhite: boolean, skipBlack: boolean) => {
    const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
    let kept = 0;
    for (let p = 0; p < count; p++) {
      const i = p * 4;
      if (rgba[i + 3] < 128) continue; // transparent: not the product
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      if (skipWhite && isNearWhite(r, g, b)) continue;
      if (skipBlack && isNearBlack(r, g, b)) continue;
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const bin = bins.get(key);
      if (bin) {
        bin.n++;
        bin.r += r;
        bin.g += g;
        bin.b += b;
      } else bins.set(key, { n: 1, r, g, b });
      kept++;
    }
    return { bins, kept };
  };

  let opaque = 0;
  for (let p = 0; p < count; p++) if (rgba[p * 4 + 3] >= 128) opaque++;
  if (opaque === 0) return [];
  let { bins, kept } = collect(dropWhite, dropBlack);
  if ((dropWhite || dropBlack) && kept < opaque * MIN_FOREGROUND_SHARE) ({ bins, kept } = collect(false, false));
  if (kept === 0) return [];

  // Biggest bins first; ties by key, so the order never depends on Map order.
  const ordered = [...bins.entries()].sort((a, b) => b[1].n - a[1].n || a[0] - b[0]);
  const groups: Group[] = [];
  for (const [, bin] of ordered) {
    const mean: Rgb = [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n];
    const lab = rgbToLab(mean);
    let best: Group | null = null;
    let bestDistance = Infinity;
    for (const group of groups) {
      const d = deltaE(group.lab, lab);
      if (d < bestDistance) {
        bestDistance = d;
        best = group;
      }
    }
    if (best && (bestDistance < MERGE_DELTA_E || groups.length >= MAX_GROUPS)) {
      best.weight += bin.n;
      best.sum[0] += bin.r;
      best.sum[1] += bin.g;
      best.sum[2] += bin.b;
      // The group's colour is its pixels' mean; its Lab follows it.
      best.lab = rgbToLab([best.sum[0] / best.weight, best.sum[1] / best.weight, best.sum[2] / best.weight]);
    } else {
      groups.push({ weight: bin.n, sum: [bin.r, bin.g, bin.b], lab });
    }
  }

  groups.sort((a, b) => b.weight - a.weight);
  const out: string[] = [];
  for (const [index, group] of groups.entries()) {
    if (out.length >= max) break;
    const share = group.weight / kept;
    // The biggest group is always a colour; the second is offered down to
    // MIN_SECOND_SHARE; the rest need MIN_SHARE.
    const enough = index === 0 || share >= MIN_SHARE || (index === 1 && out.length === 1 && share >= MIN_SECOND_SHARE);
    if (!enough) continue;
    const hex = toHex([group.sum[0] / group.weight, group.sum[1] / group.weight, group.sum[2] / group.weight]);
    if (!out.includes(hex)) out.push(hex);
  }
  return out;
}

function validBox(box: PaletteBox | null | undefined): PaletteBox | null {
  if (!box || typeof box !== "object") return null;
  const { x, y, w, h } = box;
  const nums = [x, y, w, h];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  if (w <= 0 || h <= 0 || x + w > 1 + 1e-9 || y + h > 1 + 1e-9) return null;
  return box;
}

/**
 * The palette of a normalised picture (optionally one box of it). Returns
 * [] when the bytes cannot be read; never throws.
 */
export async function paletteFromImage(input: Buffer, opts: PaletteOptions = {}): Promise<string[]> {
  if (!Buffer.isBuffer(input) || input.length === 0) return [];
  const limit = clampInt(opts.maxInputPixels, MAX_INPUT_PIXELS, 1, MAX_INPUT_PIXELS);
  const options = { limitInputPixels: limit, failOn: "error" as const };
  try {
    const meta = await sharp(input, options).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) return [];
    const box = validBox(opts.box ?? null);
    let pipeline = sharp(input, options);
    if (box) {
      const left = Math.min(width - 1, Math.floor(box.x * width));
      const top = Math.min(height - 1, Math.floor(box.y * height));
      const cropW = Math.max(1, Math.min(width - left, Math.round(box.w * width)));
      const cropH = Math.max(1, Math.min(height - top, Math.round(box.h * height)));
      pipeline = pipeline.extract({ left, top, width: cropW, height: cropH });
    }
    const region = await pipeline.png().toBuffer();
    // sharp's stats: isOpaque is false when any pixel is transparent — a matte.
    const stats = await sharp(region).stats();
    const { data, info } = await sharp(region)
      // Nearest-neighbour: every sample is a real pixel of the picture. A
      // smoothing kernel would invent the in-between colours along every
      // edge (red on white → pink), and a thin edge can outweigh a small logo.
      .resize(PALETTE_SAMPLE_EDGE, PALETTE_SAMPLE_EDGE, { fit: "inside", withoutEnlargement: true, kernel: "nearest" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return paletteFromPixels(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, {
      matte: stats.isOpaque === false,
      max: opts.max,
    });
  } catch {
    return [];
  }
}
