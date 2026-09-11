// Part E's ground truth for one reference photo, from the ORIGINAL file —
// before the product's preparation strips its EXIF (photo.ts
// normaliseSetPhoto keeps no metadata). sharp reads the stored size, the
// orientation and the raw EXIF block; exif-fov.mts reads the lens from that
// block, holds it against match.json, and against the frame the EXIF says
// the camera wrote (a picture cut from a larger frame keeps its lens).
//
//   truth = verticalFovDegFrom35mm(35 mm focal length, the stored width and
//           height, the file's orientation)
//
// The vertical field of view of the photo as it is SEEN (upright), which is
// what both builders are sent — the preparation turns it upright and only
// scales it (aspectHeld checks that) — and what their answer's
// vertical_fov_deg describes: "across the picture's HEIGHT, as the picture
// is given" (match-shot.ts).

import type { MatchRow } from "./corpus.mts";
import { mergeExif, readExifFocal, uprightSize, verticalFovDegFrom35mm, type ExifFocal, type FocalTruth } from "./exif-fov.mts";
import { HarnessError } from "./util.mts";

export type PhotoTruth = FocalTruth & {
  /** The pixels as stored, and as seen. */
  stored: { width: number; height: number };
  upright: { width: number; height: number };
  /** The file's own orientation (1 when it has none): what the preparation turns the photo by. */
  orientation: number;
  /** What the file's own EXIF says. */
  file: ExifFocal;
  /** Null when no 35 mm-equivalent focal length is known: the photo is outside the FOV bar. */
  exifFovDeg: number | null;
};

type Sharp = (typeof import("sharp"))["default"];

async function loadSharp(): Promise<Sharp> {
  try {
    return (await import("sharp")).default;
  } catch {
    throw new HarnessError("sharp is not installed: the eval cannot read a photo's EXIF (npm ci)");
  }
}

/** A photo's ground truth, from its original bytes and what match.json declares. Refuses a file sharp cannot read. */
export async function photoTruth(photoId: string, original: Buffer, declared: MatchRow["exif"]): Promise<PhotoTruth> {
  const sharp = await loadSharp();
  let meta: Awaited<ReturnType<ReturnType<Sharp>["metadata"]>>;
  try {
    meta = await sharp(original, { limitInputPixels: false }).metadata();
  } catch {
    throw new HarnessError(`match photo ${photoId}: its file could not be read`);
  }
  if (!meta.width || !meta.height) throw new HarnessError(`match photo ${photoId}: its file has no size`);
  const stored = { width: meta.width, height: meta.height };
  const orientation = meta.orientation && meta.orientation >= 1 && meta.orientation <= 8 ? meta.orientation : 1;
  const file = readExifFocal(meta.exif ?? null);
  const focal = mergeExif(declared, file, orientation, stored);
  return {
    ...focal,
    stored,
    upright: uprightSize(stored.width, stored.height, orientation),
    orientation,
    file,
    exifFovDeg: focal.focal35mm === null ? null : verticalFovDegFrom35mm(focal.focal35mm, stored.width, stored.height, orientation),
  };
}
