// The set check (cut 5 of "out of this world", 2026-09-17): what a build
// can get wrong that no rule of the normaliser catches, read off the set's
// own boxes. Found while drawing canvas page J: the operator's race track
// had a 20 m end wall standing through the car — a repeat offset of 50
// where 104 was meant — and every shot of it was sunless. A wall through a
// car is a thing the eye misses in a sketch and the picture model draws
// faithfully. Pure: the editor lists the findings and selects what each
// names; nothing here changes the set.
//
// Four findings, in the order the list shows them:
//   through — something big stands through something small (a wall through
//     a car): the big one spans eight times the small one and at least
//     8 m, covers nearly half the small one's volume, and goes at least a
//     hand's width (THROUGH_DEPTH_M) into it. Wheels in a body, seats on a
//     tier and panes in a frame are none of that; a shutter set flush into
//     its wall, half its 12 cm inside, is not either; nor is a tree or a
//     step planted in a dune — a sphere or a cone is terrain or foliage,
//     never a wall, on either side.
//   camera-inside — a camera stands inside a thing.
//   mark-inside — a mark stands inside a thing (the normaliser moves marks
//     out; a hand can put one back).
//   sunk — a thing's bottom is well below the ground.
// Every shape is read as its axis-aligned box after rotation; a sheet is
// never a finding, on either side.

import type { SetObject, SetSpec } from "./set-spec";
import { rotationXYZ } from "./marks";

export type SetFinding =
  | { kind: "through"; big: number; small: number; share: number }
  | { kind: "camera-inside"; camera: number; object: number }
  | { kind: "mark-inside"; mark: number; object: number }
  | { kind: "sunk"; object: number; depthM: number };

export const THROUGH_SPAN_RATIO = 8;
export const THROUGH_MIN_SPAN_M = 8;
export const THROUGH_SHARE = 0.45;
/** How far the big one must go into the small one, metres: a hand's width. */
export const THROUGH_DEPTH_M = 0.25;
export const SUNK_M = 0.3;

type Box = { object: number; shape: SetObject["shape"]; min: [number, number, number]; max: [number, number, number]; span: number; volume: number };

/** Every instance of every solid as its world box; sheets left out. */
export function setBoxes(spec: SetSpec): Box[] {
  const out: Box[] = [];
  spec.objects.forEach((o, i) => {
    if (o.shape === "plane") return;
    // rotationXYZ takes radians; the set writes degrees.
    const R = rotationXYZ(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG);
    const h = [o.size[0] / 2, o.size[1] / 2, o.size[2] / 2];
    // The rotated box's half extents: |R| · h.
    const e = [0, 1, 2].map((r) => Math.abs(R[r][0]) * h[0] + Math.abs(R[r][1]) * h[1] + Math.abs(R[r][2]) * h[2]);
    const count = o.repeat?.count ?? 1;
    const step = o.repeat?.offset ?? [0, 0, 0];
    for (let k = 0; k < count; k++) {
      const c = [o.position[0] + step[0] * k, o.position[1] + step[1] * k, o.position[2] + step[2] * k];
      out.push({
        object: i,
        shape: o.shape,
        min: [c[0] - e[0], c[1] - e[1], c[2] - e[2]],
        max: [c[0] + e[0], c[1] + e[1], c[2] + e[2]],
        span: Math.max(o.size[0], o.size[1], o.size[2]),
        volume: Math.max(1e-6, o.size[0] * o.size[1] * o.size[2]),
      });
    }
  });
  return out;
}

/** The overlap's volume and its thinnest extent (how deep one goes into the other), or null apart. */
const overlap = (a: Box, b: Box): { volume: number; depth: number } | null => {
  let v = 1;
  let depth = Infinity;
  for (let i = 0; i < 3; i++) {
    const d = Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]);
    if (d <= 0) return null;
    v *= d;
    depth = Math.min(depth, d);
  }
  return { volume: v, depth };
};
const DEG = Math.PI / 180;
const wallLike = (b: Box) => b.shape === "box" || b.shape === "cylinder";
const thingLike = (b: Box) => b.shape === "box" || b.shape === "cylinder" || b.shape === "capsule";
const inside = (p: [number, number, number], b: Box): boolean => p.every((v, i) => v >= b.min[i] && v <= b.max[i]);

export function checkSet(spec: SetSpec): SetFinding[] {
  const boxes = setBoxes(spec);
  const out: SetFinding[] = [];
  const seen = new Set<string>();
  for (const big of boxes) {
    if (big.span < THROUGH_MIN_SPAN_M || !wallLike(big)) continue;
    for (const small of boxes) {
      if (small.object === big.object || !thingLike(small) || big.span < THROUGH_SPAN_RATIO * small.span) continue;
      const key = `${big.object}:${small.object}`;
      if (seen.has(key)) continue;
      const o = overlap(big, small);
      if (!o || o.depth < THROUGH_DEPTH_M) continue;
      const share = o.volume / small.volume;
      if (share >= THROUGH_SHARE) {
        seen.add(key);
        out.push({ kind: "through", big: big.object, small: small.object, share: Math.round(Math.min(1, share) * 100) / 100 });
      }
    }
  }
  spec.cameras.forEach((c, ci) => {
    const hit = boxes.find((b) => inside([c.position[0], c.position[1], c.position[2]], b));
    if (hit) out.push({ kind: "camera-inside", camera: ci, object: hit.object });
  });
  spec.marks.forEach((m, mi) => {
    const hit = boxes.find((b) => b.max[1] - b.min[1] >= 0.6 && inside([m.x, 0.9, m.z], b));
    if (hit) out.push({ kind: "mark-inside", mark: mi, object: hit.object });
  });
  const sunk = new Set<number>();
  for (const b of boxes) {
    if (b.min[1] < -SUNK_M && !sunk.has(b.object)) {
      sunk.add(b.object);
      out.push({ kind: "sunk", object: b.object, depthM: Math.round(-b.min[1] * 10) / 10 });
    }
  }
  return out;
}
