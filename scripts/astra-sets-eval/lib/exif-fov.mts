// Part E's ground truth: a photo's vertical field of view from its EXIF
// 35 mm-equivalent focal length. Pure.
//
// "35 mm equivalent" is defined on the DIAGONAL: a lens is called f35 when
// it gives the field of view that focal length gives on a 36 × 24 mm frame,
// whose diagonal is 43.27 mm. So the equivalent sensor height for an image
// of w × h pixels is 43.27 × h / √(w² + h²), and
//
//   vertical FOV = 2 · atan(hEq / (2 · f35))
//
// EXIF orientations 5–8 are rotated a quarter turn: width and height swap.

export const FULL_FRAME_DIAGONAL_MM = Math.hypot(36, 24);

export function verticalFovDegFrom35mm(f35: number, widthPx: number, heightPx: number, orientation = 1): number {
  if (!(f35 > 0) || !(widthPx > 0) || !(heightPx > 0)) throw new Error("focal length and image size must be positive");
  const rotated = orientation >= 5 && orientation <= 8;
  const w = rotated ? heightPx : widthPx;
  const h = rotated ? widthPx : heightPx;
  const hEq = (FULL_FRAME_DIAGONAL_MM * h) / Math.hypot(w, h);
  return (2 * Math.atan(hEq / (2 * f35)) * 180) / Math.PI;
}
