// A Set's photo, in the browser (Sets from a photo, docs 3.2, 2026-09-11).
// Browser only; relative imports.
//
// Vercel refuses a request body over 4.5 MB before any of our code runs, so
// the photo is prepared here: turned upright, scaled to at most 2048 px on
// its long side and re-encoded as a JPEG of at most 3 MB — which is 4 MiB of
// base64, the same budget a Set's shot frame already rides in. A canvas
// writes no metadata, so the location data in a phone photo never leaves
// the device; the server re-encodes regardless (photo.ts), and judges the
// photo before anything else sees it.
//
// A refusal here is one of the server's own English sentences (messages.ts),
// so the page localizes it exactly as it localizes the server's.

import { MAX_SET_PHOTO_BYTES, SET_PHOTO_MAX_FILE_BYTES, photoFit } from "./set-config";
import { SET_PHOTO_BAD_SHAPE, SET_PHOTO_TOO_LARGE, SET_PHOTO_TOO_SMALL, SET_PHOTO_UNREADABLE } from "./messages";

const QUALITIES = [0.88, 0.8, 0.7, 0.6];
const JPEG_HEAD = "data:image/jpeg;base64,";

function decodedBytes(dataUri: string): number {
  const b64 = dataUri.slice(dataUri.indexOf(",") + 1);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export async function preparePhoto(
  file: File,
): Promise<{ ok: true; dataUri: string; width: number; height: number } | { ok: false; error: string }> {
  if (file.size > SET_PHOTO_MAX_FILE_BYTES) return { ok: false, error: SET_PHOTO_TOO_LARGE };
  let bitmap: ImageBitmap;
  try {
    // Upright as the camera meant it. A format this browser cannot decode
    // (HEIC outside Safari) throws here.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, error: SET_PHOTO_UNREADABLE };
  }
  try {
    const fit = photoFit(bitmap.width, bitmap.height);
    if (!fit.ok) return { ok: false, error: fit.reason === "small" ? SET_PHOTO_TOO_SMALL : SET_PHOTO_BAD_SHAPE };
    const canvas = document.createElement("canvas");
    canvas.width = fit.width;
    canvas.height = fit.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, error: SET_PHOTO_UNREADABLE };
    // White first: a transparent PNG or WebP would otherwise turn black in a JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, fit.width, fit.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, fit.width, fit.height);
    for (const q of QUALITIES) {
      const dataUri = canvas.toDataURL("image/jpeg", q);
      if (!dataUri.startsWith(JPEG_HEAD)) return { ok: false, error: SET_PHOTO_UNREADABLE };
      if (decodedBytes(dataUri) <= MAX_SET_PHOTO_BYTES) {
        return { ok: true, dataUri, width: fit.width, height: fit.height };
      }
    }
    return { ok: false, error: SET_PHOTO_TOO_LARGE };
  } finally {
    bitmap.close();
  }
}
