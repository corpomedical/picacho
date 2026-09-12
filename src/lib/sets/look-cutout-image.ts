// A look's cutout, laid out (Astra Sets, 2026-09-12): what SAM 2 kept of an
// earlier still (providers/fal-segment.ts) on a plain grey ground, cropped
// to the objects. This picture is the look — never the still itself
// (look-cutout.ts says why). Relative imports only, sharp loaded when
// needed (as photo.ts does), so the test suite loads this file as it is.
//
// WHAT IS LEFT OF THE STILL. SAM 2 answers with the whole still, every pixel
// outside the mask made transparent — transparent, not erased: those pixels
// keep their colour underneath. Laying the picture on grey by its alpha is
// what removes them, so nothing outside the mask reaches the cutout at all.
// JPEG then drops the alpha along with any metadata.
//
// NEVER THE PERSON. A mask can take in the person too, when they stand in
// front of, beside or on what the boxes were drawn round. So the person's
// region of the still (look-cutout.ts: the grey figure's place on screen,
// grown well past it) is made transparent before anything else, whatever
// SAM 2 kept there: it is grey in the cutout, and the mask's share and the
// crop are measured without it.
//
// WHEN IT IS NO LOOK. A mask under LOOK_MIN_MASK_SHARE of the frame caught
// nothing worth keeping (SAM found no object in the boxes). A mask over
// LOOK_MAX_MASK_SHARE took the ground, the walls or the sky along with the
// objects: sent, it would be most of the earlier still again, which is the
// one thing the look must never be. Either way the shot goes without it.

import type { FrameBox } from "./look-cutout";

/** The ground the objects are laid on: the "plain grey ground" the look's sentence names (set-shot-prompt.ts). */
export const LOOK_GROUND = "#808080";
/** Under this share of the frame, the mask caught nothing worth keeping. */
export const LOOK_MIN_MASK_SHARE = 0.01;
/** Over this share of the frame, the mask took the place along with its objects. */
export const LOOK_MAX_MASK_SHARE = 0.75;
/** Room left round the mask's box, as a share of the still's longer side. */
export const LOOK_CROP_MARGIN = 0.03;
export const LOOK_CUTOUT_QUALITY = 90;
/** A pixel counts as kept at or above this alpha (SAM 2's masks are 0 or 255). */
const KEPT_ALPHA = 128;

export type LookCutoutImage =
  | { ok: true; jpeg: Buffer; width: number; height: number; share: number }
  | { ok: false; reason: "unreadable" | "empty" | "whole" };

/** The mask's box and its share of the frame, from a picture's alpha. */
export function maskExtent(
  alpha: (i: number) => number,
  width: number,
  height: number,
): { share: number; box: { left: number; top: number; right: number; bottom: number } | null } {
  let kept = 0;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha(y * width + x) < KEPT_ALPHA) continue;
      kept += 1;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  const share = width > 0 && height > 0 ? kept / (width * height) : 0;
  return { share, box: kept > 0 ? { left, top, right: right + 1, bottom: bottom + 1 } : null };
}

/**
 * Make every pixel of `region` (0–1 across and down the picture, rounded
 * outward to whole pixels) transparent, in place, in raw pixels whose last
 * channel is alpha.
 */
export function clearRegion(data: Buffer, width: number, height: number, channels: number, region: FrameBox): void {
  const x0 = Math.max(0, Math.floor(region.u0 * width));
  const x1 = Math.min(width, Math.ceil(region.u1 * width));
  const y0 = Math.max(0, Math.floor(region.v0 * height));
  const y1 = Math.min(height, Math.ceil(region.v1 * height));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) data[(y * width + x) * channels + channels - 1] = 0;
  }
}

/**
 * SAM 2's answer (a PNG with alpha) → the cutout: the kept pixels outside
 * the person's region on LOOK_GROUND, cropped to their box plus
 * LOOK_CROP_MARGIN, as a JPEG. Never throws; `ok: false` says why it is no
 * look (see the header).
 */
export async function composeLookCutout(png: Buffer, person: FrameBox | null): Promise<LookCutoutImage> {
  let sharp: (typeof import("sharp"))["default"];
  try {
    ({ default: sharp } = await import("sharp"));
  } catch {
    console.error("[sets] sharp unavailable; no look cutouts");
    return { ok: false, reason: "unreadable" };
  }
  try {
    const { data, info } = await sharp(png, { limitInputPixels: 25_000_000, failOn: "error" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    // ensureAlpha leaves grey + alpha (2) or colour + alpha (4).
    const channels = info.channels as 2 | 4;
    if (person) clearRegion(data, width, height, channels, person);
    const { share, box } = maskExtent((i) => data[i * channels + channels - 1], width, height);
    if (!box || share < LOOK_MIN_MASK_SHARE) return { ok: false, reason: "empty" };
    if (share > LOOK_MAX_MASK_SHARE) return { ok: false, reason: "whole" };
    const margin = Math.round(LOOK_CROP_MARGIN * Math.max(width, height));
    const left = Math.max(0, box.left - margin);
    const top = Math.max(0, box.top - margin);
    const right = Math.min(width, box.right + margin);
    const bottom = Math.min(height, box.bottom + margin);
    // From the pixels as cleared above, never from SAM 2's PNG again.
    const out = await sharp(data, { raw: { width, height, channels } })
      .extract({ left, top, width: right - left, height: bottom - top })
      .flatten({ background: LOOK_GROUND })
      .jpeg({ quality: LOOK_CUTOUT_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, jpeg: out.data, width: out.info.width, height: out.info.height, share };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
