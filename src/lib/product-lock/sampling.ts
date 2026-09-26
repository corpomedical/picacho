// Which moments of a filmed shot are read (spec §1.8 "Sampling"; synthesis
// S1: customer copy says "Checked at 3 moments per shot", and the count it
// prints comes from the record, never from static copy).
//
//   a 5 s shot: 3 moments — 0.4 s in, the middle, 0.4 s before the end.
//   t = 0 is skipped: on an image-to-video lane it IS the approved still,
//   which was checked before any video money moved.
//   a packshot: one moment more (4), spread evenly over the same span.
//
// Pure, alias-free.

/** Moments read in an ordinary shot. */
export const MOMENTS_PER_SHOT = 3;
/** Moments read in a packshot (spec §1.8: "Packshots get one extra frame"). */
export const MOMENTS_PER_PACKSHOT = 4;
/** How far in from each end the first and last moments sit. */
export const MOMENT_EDGE_SECONDS = 0.4;

/**
 * The times (seconds, 2 decimals) to read in a shot `seconds` long. A clip
 * too short to hold the edges is read once, in its middle; a clip of no
 * known length is not read at all.
 */
export function momentTimes(seconds: number, opts: { packshot?: boolean } = {}): number[] {
  if (!Number.isFinite(seconds) || seconds <= 0) return [];
  const count = opts.packshot ? MOMENTS_PER_PACKSHOT : MOMENTS_PER_SHOT;
  const first = MOMENT_EDGE_SECONDS;
  const last = seconds - MOMENT_EDGE_SECONDS;
  const round = (t: number) => Math.round(t * 100) / 100;
  if (last - first < 0.2) return [round(seconds / 2)];
  const step = (last - first) / (count - 1);
  return Array.from({ length: count }, (_, i) => round(first + step * i));
}
