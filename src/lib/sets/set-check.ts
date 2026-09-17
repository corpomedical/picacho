// The set check (cut 5 of "out of this world", 2026-09-17): what a build
// can get wrong that no rule of the normaliser catches, read off the set's
// own shapes. Found while drawing canvas page J: the operator's race track
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
//
// EVERY SHAPE IS READ AS ITSELF, TURNED (2026-09-18). It used to be read as
// the axis-aligned box around it, which reports what is not there: two 12 m
// walls turned 45° have boxes 8.8 m across, so a crate 4 m clear of both was
// "through" them with a share of 1.00 where the truth is 0.00; and a ball
// resting on the ground, turned about any axis but its own, had a box
// 0.41 m below it and was "sunk". The cheap world boxes are kept as the
// first pass — they can only over-report, so what they clear is clear — and
// what they flag is then measured on the turned shapes themselves.
// A sheet is never a finding, on either side.

import type { SetObject, SetSpec, Vec3 } from "./set-spec";
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

type Box = {
  object: number;
  shape: SetObject["shape"];
  /** The world box around the turned shape: the cheap first pass. */
  min: Vec3;
  max: Vec3;
  /** The turned shape itself: its centre, its half sizes, and its own axes in the world. */
  c: Vec3;
  h: Vec3;
  u: [Vec3, Vec3, Vec3];
  span: number;
  volume: number;
};

const DEG = Math.PI / 180;

/**
 * The half extents of the world box around one turned shape. A box is the
 * sum of its turned half sizes; a ball is an ellipsoid, so the LENGTH of the
 * turned row and not the sum of it; everything round about its own upright
 * axis — a cylinder, a cone, a capsule, a ring — is that axis plus its cross
 * section. marks.ts reads the same shapes the same way.
 */
function extent(shape: SetObject["shape"], h: Vec3, R: number[][]): Vec3 {
  return [0, 1, 2].map((r) => {
    const x = R[r][0] * h[0];
    const y = R[r][1] * h[1];
    const z = R[r][2] * h[2];
    if (shape === "box") return Math.abs(x) + Math.abs(y) + Math.abs(z);
    if (shape === "sphere") return Math.hypot(x, y, z);
    return Math.abs(y) + Math.hypot(x, z);
  }) as Vec3;
}

/** Every instance of every solid as its world box and its turned self; sheets left out. */
export function setBoxes(spec: SetSpec): Box[] {
  const out: Box[] = [];
  spec.objects.forEach((o, i) => {
    if (o.shape === "plane") return;
    // rotationXYZ takes radians; the set writes degrees.
    const R = rotationXYZ(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG);
    // A ring is as deep as it is wide: build-scene.ts builds it from size[0].
    const h: Vec3 = [o.size[0] / 2, o.size[1] / 2, (o.shape === "torus" ? o.size[0] : o.size[2]) / 2];
    const e = extent(o.shape, h, R);
    // Its own axes in the world: the columns of R.
    const u: [Vec3, Vec3, Vec3] = [
      [R[0][0], R[1][0], R[2][0]],
      [R[0][1], R[1][1], R[2][1]],
      [R[0][2], R[1][2], R[2][2]],
    ];
    const count = o.repeat?.count ?? 1;
    const step = o.repeat?.offset ?? [0, 0, 0];
    for (let k = 0; k < count; k++) {
      const c: Vec3 = [o.position[0] + step[0] * k, o.position[1] + step[1] * k, o.position[2] + step[2] * k];
      out.push({
        object: i,
        shape: o.shape,
        min: [c[0] - e[0], c[1] - e[1], c[2] - e[2]],
        max: [c[0] + e[0], c[1] + e[1], c[2] + e[2]],
        c,
        h,
        u,
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

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const walk = (p: Vec3, d: Vec3, s: number): Vec3 => [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];

/** What is left of a flat polygon on the near side of n·x = d. */
function clip(poly: Vec3[], n: Vec3, d: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const dp = dot(n, p) - d;
    const dq = dot(n, q) - d;
    if (dp <= 0) out.push(p);
    if ((dp > 0 && dq < 0) || (dp < 0 && dq > 0)) out.push(walk(p, sub(q, p), dp / (dp - dq)));
  }
  return out;
}

/**
 * The same two numbers as overlap(), read off the TURNED boxes: the volume
 * they share and its thinnest extent. Each of the twelve faces is clipped by
 * the other's six planes; what is left is the shared region's surface, whose
 * volume is the divergence theorem's sum of x·n over it, divided by three.
 * Null when they are apart. Identical to overlap() when nothing is turned.
 */
function turnedOverlap(a: Box, b: Box): { volume: number; depth: number } | null {
  let sum = 0;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let f = 0; f < 12; f++) {
    const own = f < 6 ? a : b;
    const by = f < 6 ? b : a;
    const j = (f % 6) >> 1;
    const s = f % 2 === 0 ? 1 : -1;
    const n: Vec3 = [own.u[j][0] * s, own.u[j][1] * s, own.u[j][2] * s];
    const mid = walk(own.c, n, own.h[j]);
    const p1 = own.u[(j + 1) % 3];
    const p2 = own.u[(j + 2) % 3];
    const h1 = own.h[(j + 1) % 3];
    const h2 = own.h[(j + 2) % 3];
    let poly: Vec3[] = [
      walk(walk(mid, p1, h1), p2, h2),
      walk(walk(mid, p1, h1), p2, -h2),
      walk(walk(mid, p1, -h1), p2, -h2),
      walk(walk(mid, p1, -h1), p2, h2),
    ];
    for (let k = 0; k < 3 && poly.length >= 3; k++) {
      const m = dot(by.u[k], by.c);
      poly = clip(poly, by.u[k], m + by.h[k]);
      if (poly.length < 3) break;
      poly = clip(poly, [-by.u[k][0], -by.u[k][1], -by.u[k][2]], by.h[k] - m);
    }
    if (poly.length < 3) continue;
    let area = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 1; i + 1 < poly.length; i++) {
      const cr = cross(sub(poly[i], poly[0]), sub(poly[i + 1], poly[0]));
      const t = Math.hypot(cr[0], cr[1], cr[2]) / 2;
      area += t;
      cx += (t * (poly[0][0] + poly[i][0] + poly[i + 1][0])) / 3;
      cy += (t * (poly[0][1] + poly[i][1] + poly[i + 1][1])) / 3;
      cz += (t * (poly[0][2] + poly[i][2] + poly[i + 1][2])) / 3;
    }
    for (const v of poly) {
      for (let i = 0; i < 3; i++) {
        if (v[i] < lo[i]) lo[i] = v[i];
        if (v[i] > hi[i]) hi[i] = v[i];
      }
    }
    if (area > 0) sum += dot([cx / area, cy / area, cz / area], n) * area;
  }
  if (!Number.isFinite(lo[0])) return null;
  const depth = Math.min(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  return depth > 0 ? { volume: Math.max(0, sum / 3), depth } : null;
}

const wallLike = (b: Box) => b.shape === "box" || b.shape === "cylinder";
const thingLike = (b: Box) => b.shape === "box" || b.shape === "cylinder" || b.shape === "capsule";

/** Is the point inside the shape itself, not merely the box around it? */
const insideShape = (p: Vec3, b: Box): boolean => {
  const d = sub(p, b.c);
  const l: Vec3 = [dot(d, b.u[0]) / b.h[0], dot(d, b.u[1]) / b.h[1], dot(d, b.u[2]) / b.h[2]];
  if (b.shape === "box") return Math.abs(l[0]) <= 1 && Math.abs(l[1]) <= 1 && Math.abs(l[2]) <= 1;
  if (b.shape === "sphere") return l[0] * l[0] + l[1] * l[1] + l[2] * l[2] <= 1;
  if (b.shape === "cone") {
    const t = (1 - l[1]) / 2;
    return Math.abs(l[1]) <= 1 && l[0] * l[0] + l[2] * l[2] <= t * t;
  }
  return Math.abs(l[1]) <= 1 && l[0] * l[0] + l[2] * l[2] <= 1;
};

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
      // The world boxes first: they never under-report, so what they clear is
      // clear, and a set with nothing standing through anything costs no more
      // than it did. What they flag is measured on the turned shapes.
      const rough = overlap(big, small);
      if (!rough || rough.depth < THROUGH_DEPTH_M || rough.volume / small.volume < THROUGH_SHARE) continue;
      const o = turnedOverlap(big, small);
      if (!o || o.depth < THROUGH_DEPTH_M) continue;
      const share = o.volume / small.volume;
      if (share >= THROUGH_SHARE) {
        seen.add(key);
        out.push({ kind: "through", big: big.object, small: small.object, share: Math.round(Math.min(1, share) * 100) / 100 });
      }
    }
  }
  spec.cameras.forEach((c, ci) => {
    const hit = boxes.find((b) => insideShape([c.position[0], c.position[1], c.position[2]], b));
    if (hit) out.push({ kind: "camera-inside", camera: ci, object: hit.object });
  });
  spec.marks.forEach((m, mi) => {
    const hit = boxes.find((b) => b.max[1] - b.min[1] >= 0.6 && insideShape([m.x, 0.9, m.z], b));
    if (hit) out.push({ kind: "mark-inside", mark: mi, object: hit.object });
  });
  const sunk = new Set<number>();
  for (const b of boxes) {
    // A ball or a cone is terrain or foliage — a dune, a rock, a bush — and
    // half under the ground is how one is built (marks.ts reads them the same
    // way, and says the beach's marks are clear). Only gone under altogether
    // is a mistake.
    if ((b.shape === "sphere" || b.shape === "cone") && b.max[1] > 0) continue;
    if (b.min[1] < -SUNK_M && !sunk.has(b.object)) {
      sunk.add(b.object);
      out.push({ kind: "sunk", object: b.object, depthM: Math.round(-b.min[1] * 10) / 10 });
    }
  }
  return out;
}
