// The people (cut D of closing the gap, 2026-09-17): where the figure LOOKS
// and the PATH it walks. An eye-line is a sentence the picture model reads
// — into the camera, at one of the set's things, or at a point — and a
// line the stage draws from the eyes. A path is the way the figure walks
// between where a beat opens and where it ends: waypoints on the ground
// the previz follows and the sequencer shows; the clip's two frames carry
// it, so it needs no words. Pure, and type-only from set-spec: set-spec's
// layout reads a gaze through here, so nothing here may import it at run
// time.

import type { SetElement } from "./elements";
import type { SetObject, SetSpec } from "./set-spec";

export type Gaze = { at: "camera" } | { at: "object"; index: number } | { at: "point"; x: number; z: number };

/** How far a point may stand from the set's middle, metres — the film's own reach. */
const REACH_M = 200;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? r3(Math.min(REACH_M, Math.max(-REACH_M, v))) : null);

/** A stored or sent gaze, or null: a thing it names must exist. */
export function normaliseGaze(v: unknown, objects: number): Gaze | null {
  if (!v || typeof v !== "object") return null;
  const g = v as Record<string, unknown>;
  if (g.at === "camera") return { at: "camera" };
  if (g.at === "object" && typeof g.index === "number" && Number.isInteger(g.index) && g.index >= 0 && g.index < objects) return { at: "object", index: g.index };
  if (g.at === "point") {
    const x = num(g.x);
    const z = num(g.z);
    if (x !== null && z !== null) return { at: "point", x, z };
  }
  return null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The set's things as the words need them (elements.ts setElements): what each is, and which blocks it is made of. */
export type NamedThings = readonly Pick<SetElement, "kind" | "members">[];

/**
 * How a thing is named to the models: its shape and its size, the way the
 * scene tree names it (furniture.ts says the same). With the set's things
 * handed in (Helios Cut 2, step 9, 2026-09-25), a block of the set's ONLY
 * car is "the car", and of its only vehicle "the vehicle": the model draws
 * a car there, and "the box 4.4 × 1.2 × 1.9 m" is a block it was told
 * never to draw. With two cars, which one is only in the geometry, so the
 * geometry stays (set-shot-prompt.ts SET_POSE_WORDS_OPEN gates who gets it).
 */
function thing(o: SetObject, index: number, els?: NamedThings): string {
  const el = els?.find((e) => e.members.some(([m]) => m === index));
  if (els && el && (el.kind === "car" || el.kind === "vehicle") && els.filter((e) => e.kind === el.kind).length === 1) return `the ${el.kind}`;
  return `the ${o.shape} ${r1(o.size[0])} × ${r1(o.size[1])} × ${r1(o.size[2])} m`;
}

/** Which way a point lies from the figure, by the figure's own front. */
export function sideOf(mark: { x: number; z: number; facingDeg: number }, point: { x: number; z: number }): "ahead" | "left" | "right" | "behind" {
  const dx = point.x - mark.x;
  const dz = point.z - mark.z;
  if (Math.hypot(dx, dz) < 0.05) return "ahead";
  const bearing = (Math.atan2(dx, dz) * 180) / Math.PI;
  let rel = ((bearing - mark.facingDeg) % 360 + 360) % 360;
  if (rel > 180) rel -= 360;
  if (Math.abs(rel) <= 45) return "ahead";
  if (Math.abs(rel) >= 135) return "behind";
  // Facing +Z at 0°, +X is to the figure's left as the camera sees the world's axes: a positive bearing is to the left.
  return rel > 0 ? "left" : "right";
}

/**
 * The eye-line as a sentence. `lead` opens it: "They look" for a still,
 * "By the end of the shot they look" for a take. Empty with no gaze, or a
 * thing the set no longer has. `els`, the set's things, lets a look at the
 * only car say "the car" (thing above); without it, the words are as they
 * always were.
 */
export function gazeWords(
  gaze: Gaze | null,
  spec: Pick<SetSpec, "objects">,
  mark: { x: number; z: number; facingDeg: number },
  lead: "still" | "take" = "still",
  els?: NamedThings,
): string {
  if (!gaze) return "";
  const open = lead === "take" ? "By the end of the shot they look" : "They look";
  if (gaze.at === "camera") return `${open} straight into the camera, eyes to the lens.`;
  if (gaze.at === "object") {
    const o = spec.objects[gaze.index];
    return o ? `${open} at ${thing(o, gaze.index, els)}, their eyes on it.` : "";
  }
  const d = r1(Math.hypot(gaze.x - mark.x, gaze.z - mark.z));
  const side = sideOf(mark, gaze);
  const where = side === "ahead" ? "straight ahead of them" : side === "behind" ? "back over their shoulder" : `off to their ${side}`;
  return `${open} ${where}, at something ${d} m away, out of the frame.`;
}

/** The waypoints a figure walks through, in order, on the ground. */
export type Path = { x: number; z: number }[];
export const PATH_MAX_POINTS = 6;

export function normalisePath(v: unknown): Path {
  if (!Array.isArray(v)) return [];
  const out: Path = [];
  for (const p of v) {
    if (out.length >= PATH_MAX_POINTS) break;
    if (!p || typeof p !== "object") continue;
    const x = num((p as Record<string, unknown>).x);
    const z = num((p as Record<string, unknown>).z);
    if (x !== null && z !== null) out.push({ x, z });
  }
  return out;
}

type Pt = { x: number; z: number };

/** The whole walk, metres, from where it opens through the points to where it ends. */
export function pathLength(from: Pt, points: readonly Pt[], to: Pt): number {
  const stops = [from, ...points, to];
  let len = 0;
  for (let i = 1; i < stops.length; i++) len += Math.hypot(stops[i].x - stops[i - 1].x, stops[i].z - stops[i - 1].z);
  return Math.round(len * 100) / 100;
}

/** Where the figure stands a share `e` (0–1) of the way along the walk, by distance, and which way it is walking (degrees, the mark's own facing rule: +Z is 0). */
export function alongPath(from: Pt, points: readonly Pt[], to: Pt, e: number): { x: number; z: number; facingDeg: number | null } {
  const stops = [from, ...points, to];
  const total = pathLength(from, points, to);
  const target = Math.min(1, Math.max(0, e)) * total;
  let walked = 0;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (seg === 0) continue;
    if (walked + seg >= target || i === stops.length - 1) {
      const u = Math.min(1, (target - walked) / seg);
      const facing = ((Math.atan2(b.x - a.x, b.z - a.z) * 180) / Math.PI + 360) % 360;
      return { x: r3(a.x + (b.x - a.x) * u), z: r3(a.z + (b.z - a.z) * u), facingDeg: Math.round(facing * 10) / 10 };
    }
    walked += seg;
  }
  return { x: to.x, z: to.z, facingDeg: null };
}
