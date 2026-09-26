// T0's local half: the frame made ready, the reader's box turned into
// pixels, the product cropped out with sharp (spec §1.8 T0: "the judge
// returns a product bounding box … and Picacho crops locally with sharp").
//
// Boxes arrive the way the vision reader draws them: [ymin, xmin, ymax,
// xmax], each on a 0–1000 scale of the picture (Gemini's documented object
// detection format, read 2026-09-26 at ai.google.dev/gemini-api/docs/
// image-understanding). Everything here keeps boxes as 0..1 shares of the
// frame (product-lock.ts Box), so the coverage rule reads the same whatever
// the frame's size.
//
// Server-only (sharp). Relative imports only: tested as it is.

import sharp from "sharp";
import type { Box } from "./product-lock";

/** A frame is sent to the readers at most this big on its long edge. */
export const FRAME_EDGE = 1536;
/** A crop is made at least this big on its long edge (small labels read better enlarged), at most FRAME_EDGE. */
export const CROP_MIN_EDGE = 768;
/** Room kept round the product in the crop, as a share of the box on each side. */
export const CROP_PAD = 0.06;
const MAX_INPUT_PIXELS = 50_000_000;

/** The reader's [ymin, xmin, ymax, xmax] on 0–1000 as a Box, or null when it is not one. */
export function boxFromReading(raw: unknown): Box | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const nums = raw.map((n) => (typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN));
  if (!nums.every((n) => Number.isFinite(n))) return null;
  // Differences taken on the 0–1000 scale first, so 600 − 100 is exactly 0.5.
  const [ymin, xmin, ymax, xmax] = nums.map((n) => Math.max(0, Math.min(1000, n)));
  if (xmax <= xmin || ymax <= ymin) return null;
  return { x: xmin / 1000, y: ymin / 1000, w: (xmax - xmin) / 1000, h: (ymax - ymin) / 1000 };
}

/** The box's share of the frame, 0..1. */
export function coverageOf(box: Box | null): number | null {
  if (!box) return null;
  return Math.max(0, Math.min(1, box.w * box.h));
}

/** The box grown by `pad` of its own size on every side, kept inside the frame. */
export function padBox(box: Box, pad: number = CROP_PAD): Box {
  const x0 = Math.max(0, box.x - box.w * pad);
  const y0 = Math.max(0, box.y - box.h * pad);
  const x1 = Math.min(1, box.x + box.w * (1 + pad));
  const y1 = Math.min(1, box.y + box.h * (1 + pad));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A box in whole pixels of a width × height picture, at least 1 × 1 and inside it. */
export function boxToPixels(box: Box, width: number, height: number): { left: number; top: number; width: number; height: number } {
  const left = Math.min(width - 1, Math.max(0, Math.floor(box.x * width)));
  const top = Math.min(height - 1, Math.max(0, Math.floor(box.y * height)));
  const right = Math.min(width, Math.max(left + 1, Math.ceil((box.x + box.w) * width)));
  const bottom = Math.min(height, Math.max(top + 1, Math.ceil((box.y + box.h) * height)));
  return { left, top, width: right - left, height: bottom - top };
}

export type PreparedFrame = { bytes: Buffer; width: number; height: number };

/** A picture as the readers get it: upright, flattened on white, JPEG, long edge ≤ `edge`. Null when it cannot be read. */
export async function prepareFrame(input: Buffer, edge: number = FRAME_EDGE): Promise<PreparedFrame | null> {
  try {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .rotate()
      .resize(edge, edge, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
    if (!info.width || !info.height) return null;
    return { bytes: data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

/**
 * The product cut out of a prepared frame: the box padded, then scaled so
 * its long edge is between CROP_MIN_EDGE and FRAME_EDGE (a small label is
 * enlarged for the word reader). Null when it cannot be cut.
 */
export async function cropFrame(frame: PreparedFrame, box: Box): Promise<PreparedFrame | null> {
  try {
    const px = boxToPixels(padBox(box), frame.width, frame.height);
    const long = Math.max(px.width, px.height);
    const target = Math.max(CROP_MIN_EDGE, Math.min(FRAME_EDGE, long));
    const { data, info } = await sharp(frame.bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .extract(px)
      .resize(target, target, { fit: "inside" })
      .jpeg({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

/**
 * The tight box round a segmentation's kept pixels (alpha above half), as a
 * share of the picture — the SAM fallback's answer read back. Null when
 * nothing was kept.
 */
export async function boxFromMask(png: Buffer): Promise<Box | null> {
  try {
    const { data, info } = await sharp(png, { limitInputPixels: MAX_INPUT_PIXELS }).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (data[row + x] > 127) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    return { x: x0 / width, y: y0 / height, w: (x1 - x0 + 1) / width, h: (y1 - y0 + 1) / height };
  } catch {
    return null;
  }
}

/** Base64 of a JPEG, as the readers take inline pictures. */
export function jpegBase64(bytes: Buffer): string {
  return bytes.toString("base64");
}

/** A data: URL of a JPEG (the face scorer takes pictures as URLs). */
export function jpegDataUrl(bytes: Buffer): string {
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}
