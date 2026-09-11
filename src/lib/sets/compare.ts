// The photo beside camera 1 (Sets from a photo, docs 3.2, 2026-09-11). Pure,
// so the geometry is tested rather than eyeballed.
//
// The set page draws camera 1's view at the PHOTO's shape, so the two can be
// laid side by side and read against each other. The stage's canvas has its
// own shape, so the view is cropped out of it: the largest rectangle of the
// photo's aspect, centred.
//
// three.js's field of view is VERTICAL. Where the photo is no wider than the
// canvas, the crop is the canvas's full height and camera 1's own fovDeg is
// exactly right. Where the photo is wider, the crop is a band shorter than
// the canvas — and a band of a render drawn at fovDeg spans less than fovDeg.
// So the camera drawing it is widened until the band spans camera 1's fovDeg:
//   tan(fov' / 2) = tan(fov / 2) × canvasH / bandH

export type CompareCrop = { sx: number; sy: number; sw: number; sh: number; fovScale: number };

export function compareCrop(canvasW: number, canvasH: number, photoAspect: number): CompareCrop {
  const full: CompareCrop = { sx: 0, sy: 0, sw: canvasW, sh: canvasH, fovScale: 1 };
  if (!(canvasW > 0) || !(canvasH > 0) || !Number.isFinite(photoAspect) || photoAspect <= 0) return full;
  if (photoAspect <= canvasW / canvasH) {
    const sw = canvasH * photoAspect;
    return { sx: (canvasW - sw) / 2, sy: 0, sw, sh: canvasH, fovScale: 1 };
  }
  const sh = canvasW / photoAspect;
  return { sx: 0, sy: (canvasH - sh) / 2, sw: canvasW, sh, fovScale: canvasH / sh };
}

/** The vertical field of view whose central `1 / scale` of the height spans `fovDeg`. */
export function widenFovDeg(fovDeg: number, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0 || scale === 1) return fovDeg;
  const half = (fovDeg * Math.PI) / 360;
  return (Math.atan(Math.tan(half) * scale) * 360) / Math.PI;
}

/** The output size of a crop drawn with its long side at `px`. */
export function compareOutputSize(sw: number, sh: number, px: number): { width: number; height: number } {
  if (!(sw > 0) || !(sh > 0)) return { width: px, height: px };
  return sw >= sh
    ? { width: px, height: Math.max(1, Math.round((px * sh) / sw)) }
    : { width: Math.max(1, Math.round((px * sw) / sh)), height: px };
}
