// The human ruler (2026-09-15). A photo build sized a sitting room's
// furniture by how much of the frame it filled instead of what it was: the
// sofa's seat landed at 0.84 m — hip height on the 1.70 m figure — and the
// coffee table at 0.60 m, nearly a double bed across. The stage drew it
// faithfully, the engine split the difference, and the person came out
// bigger than the room (docs/ASTRA_SETS.md). The build rules now carry an
// anthropometric ruler; this helper is the SECOND line — a deliberately
// conservative read of an already-built spec, so the page can offer the fix.
//
// Conservative on purpose, and only a HINT, never a gate: it looks for
// seat-shaped slabs — thin, sofa-sized boxes — resting well above where a
// person could sit, and speaks only when it finds more than one. A dining
// table's top at 0.75 m is one such slab and stays quiet; a bed is too
// thick to match; a bar full of stools could false-alarm, which is why the
// line it feeds is dismissible. Pure and relative-import only.

import type { SetSpec } from "./set-spec";

/** A standing adult, and the seat range a person's knees agree with. */
export const HUMAN_HEIGHT_M = 1.7;
const SEAT_TOP_MAX_M = 0.62;

const SLAB_MAX_THICKNESS_M = 0.3;
const SLAB_LONG_MIN_M = 0.9;
const SLAB_SHORT_MIN_M = 0.45;
// 1.0, not higher: a car is also thin furniture-sized slabs — the race-track
// fixture's engine cover tops at 1.07 m and its wing at 1.31 m — and a seat
// nobody could need above a metre is not what this line is for.
const SUSPECT_TOP_MAX_M = 1.0;
const SUSPECT_MIN_COUNT = 2;

/**
 * True when the built furniture reads oversized against a person: two or
 * more seat-shaped slabs top out above where anyone could sit. The one
 * documented failure (seat 0.84 m, three cushions) fires it; a lone table
 * top, a bed, or an honest room does not.
 */
export function oversizedSeating(spec: SetSpec): boolean {
  let suspects = 0;
  for (const o of spec.objects) {
    if (o.shape !== "box") continue;
    const [sx, sy, sz] = o.size;
    if (sy > SLAB_MAX_THICKNESS_M) continue;
    const long = Math.max(sx, sz);
    const short = Math.min(sx, sz);
    if (long < SLAB_LONG_MIN_M || short < SLAB_SHORT_MIN_M) continue;
    const top = o.position[1] + sy / 2;
    if (top > SEAT_TOP_MAX_M && top <= SUSPECT_TOP_MAX_M) suspects++;
  }
  return suspects >= SUSPECT_MIN_COUNT;
}
