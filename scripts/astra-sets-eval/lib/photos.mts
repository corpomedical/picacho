// A Set's photo, prepared the way production prepares it before Astra or
// the picture check sees it (Sets from a photo, docs/ASTRA_SETS.md 3.2).
// The product's own steps, in order:
//
//   the browser   photo-client.ts preparePhoto: upright, scaled to fit
//                 (photoFit: at most 2048 px on the long side, never
//                 enlarged; at least 640 px on the short side; at most
//                 2.4:1), drawn on white, a JPEG of at most 3 MB (quality
//                 0.88, then 0.8, 0.7, 0.6). A canvas cannot run in Node, so
//                 sharp stands in for it with the same fit, ground and ladder.
//   the server    parseSetPhotoDataUri (a JPEG data URI of at most 3 MB that
//                 opens like a JPEG), then normaliseSetPhoto (sharp: upright,
//                 at most 2048 px, sRGB JPEG with NO metadata) — both
//                 unchanged. Its bytes are what Astra is sent (photoDataUrl,
//                 inline) and what the picture check judges.
//
// PhotoStore hands a build its photo only when the bytes still hash to what
// was first sent: photo.ts photoForRetry's rule, so a retry resends the same
// photo or nothing, and here the run stops rather than send another.

import { MAX_SET_PHOTO_BYTES, SET_PHOTO_MAX_FILE_BYTES, photoFit } from "../../../src/lib/sets/set-config.ts";
import { normaliseSetPhoto, parseSetPhotoDataUri, photoDataUrl } from "../../../src/lib/sets/photo.ts";
import { SET_PHOTO_BAD_SHAPE, SET_PHOTO_TOO_LARGE, SET_PHOTO_TOO_SMALL, SET_PHOTO_UNREADABLE } from "../../../src/lib/sets/messages.ts";
import type { PhotoSource } from "./build-flow.mts";
import { HarnessError } from "./util.mts";

/** photo-client.ts's JPEG qualities, tried in order until the photo fits in 3 MB. */
export const BROWSER_QUALITIES = [0.88, 0.8, 0.7, 0.6] as const;

export type PreparedPhoto = { photoId: string; jpeg: Buffer; dataUrl: string; width: number; height: number; sha256: string };
/** What a run's manifest records of each photo it sent: never the bytes (an A run keeps them in its photos/, `file`). */
export type PhotoFile = { sha256: string; width: number; height: number; file?: string };

type Sharp = (typeof import("sharp"))["default"];

async function loadSharp(): Promise<Sharp> {
  try {
    return (await import("sharp")).default;
  } catch {
    throw new HarnessError("sharp is not installed: the eval cannot prepare photos (npm ci)");
  }
}

/**
 * The browser's step (photo-client.ts preparePhoto), sharp standing in for
 * createImageBitmap and the canvas: the file as a JPEG data URI the server
 * will accept, or the sentence the browser would show.
 */
export async function browserPrepare(file: Buffer): Promise<{ ok: true; dataUri: string; width: number; height: number } | { ok: false; error: string }> {
  if (file.byteLength > SET_PHOTO_MAX_FILE_BYTES) return { ok: false, error: SET_PHOTO_TOO_LARGE };
  const sharp = await loadSharp();
  let upright: { data: Buffer; info: { width: number; height: number; channels: number } };
  try {
    // Upright as the camera meant it (imageOrientation: "from-image"), as
    // raw pixels, so the only lossy step is the JPEG below.
    upright = await sharp(file, { limitInputPixels: 50_000_000, failOn: "error" }).rotate().raw().toBuffer({ resolveWithObject: true });
  } catch {
    return { ok: false, error: SET_PHOTO_UNREADABLE };
  }
  const fit = photoFit(upright.info.width, upright.info.height);
  if (!fit.ok) return { ok: false, error: fit.reason === "small" ? SET_PHOTO_TOO_SMALL : SET_PHOTO_BAD_SHAPE };
  const raw = { width: upright.info.width, height: upright.info.height, channels: upright.info.channels as 1 | 2 | 3 | 4 };
  for (const q of BROWSER_QUALITIES) {
    // White first: a transparent PNG or WebP would otherwise turn black in a JPEG.
    const jpeg = await sharp(upright.data, { raw })
      .resize(fit.width, fit.height, { fit: "fill" })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: Math.round(q * 100) })
      .toBuffer();
    if (jpeg.byteLength <= MAX_SET_PHOTO_BYTES) return { ok: true, dataUri: `data:image/jpeg;base64,${jpeg.toString("base64")}`, width: fit.width, height: fit.height };
  }
  return { ok: false, error: SET_PHOTO_TOO_LARGE };
}

/** A corpus photo through the browser's step and the server's own: the bytes Astra would get, or the product's refusal. */
export async function preparePhoto(photoId: string, file: Buffer): Promise<{ ok: true; photo: PreparedPhoto } | { ok: false; error: string }> {
  const browser = await browserPrepare(file);
  if (!browser.ok) return browser;
  const parsed = parseSetPhotoDataUri(browser.dataUri);
  if (!parsed.ok) return parsed;
  const n = await normaliseSetPhoto(parsed.bytes);
  if (!n.ok) return n;
  return { ok: true, photo: { photoId, jpeg: n.jpeg, dataUrl: photoDataUrl(n.jpeg), width: n.width, height: n.height, sha256: n.sha256 } };
}

/** The run's photos, by id: the re-encoded bytes, never re-read mid-build. */
export class PhotoStore {
  private readonly byId = new Map<string, PreparedPhoto>();

  add(p: PreparedPhoto): void {
    this.byId.set(p.photoId, p);
  }

  get(photoId: string): PreparedPhoto | undefined {
    return this.byId.get(photoId);
  }

  get size(): number {
    return this.byId.size;
  }

  /** A build's photo as a data URL — only the bytes it first sent (photo.ts photoForRetry). Anything else stops the run. */
  dataUrlFor(src: PhotoSource): string {
    const p = this.byId.get(src.photoId);
    if (!p) throw new HarnessError(`photo ${src.photoId} is not loaded in this run`);
    if (p.sha256 !== src.sha256) throw new HarnessError(`photo ${src.photoId} no longer hashes to the bytes its build first sent: nothing is resent`);
    return p.dataUrl;
  }
}
