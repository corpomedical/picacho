// Marks on open floor (Astra Sets, 2026-09-12). Pure and relative-import
// only: normaliseSetSpec calls it on every read, and vitest loads it as it is.
//
// A mark is where the person is, and the page puts the grey stand-in there,
// feet on the ground. The operator's race-track set came back with its first
// mark ("Starting grid") at the car's own centre, so the figure opened inside
// the car. Astra is told where marks go (set-builder-prompt.ts), but a told
// rule is not a checked one: this moves any mark that stands inside
// something built to the nearest open spot.
//
// WHAT BLOCKS A PERSON. The figure is a column PERSON_RADIUS_M wide from the
// ground to PERSON_HEIGHT_M. A thing blocks it where it rises above
// SIT_TOP_M without starting above the person's head. Lower things are what
// a person stands or sits on — a kerb, a rug, a stool, a sofa's seat, a
// low stage — so a podcast host's mark on a chair stays on the chair. So does
// a mark on a wide platform (PLATFORM_*, a stage up to 1.2 m): moving it off
// would lose what the set meant, while leaving a car, a desk or a wall
// around the figure hides the person.
//
// SHAPES. A box, turned about any axis, is exact: its eight corners, turned
// as three.js turns them (Euler XYZ, the order build-scene.ts sets). An
// upright cylinder, cone or capsule is its true ellipse on the ground; an
// upright sphere its true ellipsoid, so a sand dune mostly under the ground
// blocks only where it stands taller than a seat. Round shapes tipped over,
// and rings, fall back to the box around them. Every copy of a repeated
// object counts.
//
// THE PERSON'S OWN FIGURE follows the same rule: a layout they saved is
// normalised through it (set-spec.ts normaliseSetLayout), and the stage runs
// it when they drop the figure (set-view.tsx), so the figure they see is the
// one the sketch is drawn with.

import type { SetMark, SetObject } from "./set-spec";

export const PERSON_RADIUS_M = 0.3;
export const PERSON_HEIGHT_M = 1.7;
/** At or below this, a thing is stood or sat on, not walked into. */
export const SIT_TOP_M = 0.65;
export const PLATFORM_MIN_SIDE_M = 2;
export const PLATFORM_MAX_TOP_M = 1.2;
/** How far a mark may move to reach open floor; further than this, it stays. */
export const MARK_SEARCH_M = 8;
const STEP_M = 0.25;
const BEARINGS = 16;
const DEG = Math.PI / 180;

type Point = [number, number];

/** Where a person would be inside something, on the ground plane. */
export type Blocker =
  | { kind: "hull"; hull: Point[]; centre: Point }
  | { kind: "ellipse"; centre: Point; ax: number; az: number; turn: number }
  | { kind: "ellipsoid"; centre: Point; ax: number; az: number; turn: number; cy: number; ay: number };

/** three.js's Matrix4.makeRotationFromEuler for order XYZ, as rows. */
export function rotationXYZ(rx: number, ry: number, rz: number): number[][] {
  const a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry), e = Math.cos(rz), f = Math.sin(rz);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  return [
    [c * e, -c * f, d],
    [af + be * d, ae - bf * d, -b * c],
    [bf - ae * d, be + af * d, a * c],
  ];
}

function convexHull(points: Point[]): Point[] {
  const p = [...points].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  if (p.length <= 2) return p;
  const cross = (o: Point, u: Point, v: Point) => (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Upright: turned about the vertical axis only (a whole turn about X or Z is upright too). */
function upright(rotation: readonly number[]): boolean {
  const flat = (deg: number) => Math.abs(((deg % 360) + 360) % 360) < 0.5 || Math.abs((((deg % 360) + 360) % 360) - 360) < 0.5;
  return flat(rotation[0]) && flat(rotation[2]);
}

/** Every copy of every object a person could stand inside. */
export function blockers(objects: readonly SetObject[]): Blocker[] {
  const out: Blocker[] = [];
  for (const o of objects) {
    if (o.shape === "plane") continue;
    const count = o.repeat?.count ?? 1;
    const round = o.shape === "cylinder" || o.shape === "cone" || o.shape === "capsule" || o.shape === "sphere";
    const [sx, sy, sz] = o.shape === "torus" ? [o.size[0], o.size[1], o.size[0]] : o.size;
    const r = rotationXYZ(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG);
    const corners: [number, number, number][] = [];
    for (const cx of [-0.5, 0.5]) for (const cy of [-0.5, 0.5]) for (const cz of [-0.5, 0.5]) {
      const [x, y, z] = [cx * sx, cy * sy, cz * sz];
      corners.push([r[0][0] * x + r[0][1] * y + r[0][2] * z, r[1][0] * x + r[1][1] * y + r[1][2] * z, r[2][0] * x + r[2][1] * y + r[2][2] * z]);
    }
    for (let i = 0; i < count; i++) {
      const off = o.repeat ? o.repeat.offset : [0, 0, 0];
      const px = o.position[0] + i * off[0], py = o.position[1] + i * off[1], pz = o.position[2] + i * off[2];
      const ys = corners.map((c) => py + c[1]);
      const bottom = Math.min(...ys), top = Math.max(...ys);
      if (top <= SIT_TOP_M || bottom >= PERSON_HEIGHT_M) continue;
      if (round && upright(o.rotation)) {
        const turn = o.rotation[1] * DEG;
        if (o.shape === "sphere") out.push({ kind: "ellipsoid", centre: [px, pz], ax: sx / 2, az: sz / 2, turn, cy: py, ay: sy / 2 });
        else out.push({ kind: "ellipse", centre: [px, pz], ax: sx / 2, az: sz / 2, turn });
        continue;
      }
      const hull = convexHull(corners.map((c) => [px + c[0], pz + c[2]] as Point));
      // A wide, low platform standing on the ground is a floor to stand on.
      const xs = hull.map((h) => h[0]), zs = hull.map((h) => h[1]);
      const minSide = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      if (o.shape === "box" && bottom <= SIT_TOP_M && top <= PLATFORM_MAX_TOP_M && minSide >= PLATFORM_MIN_SIDE_M) continue;
      out.push({ kind: "hull", hull, centre: [px, pz] });
    }
  }
  return out;
}

/** Distance from a point to a convex polygon's area: 0 inside. */
function distanceToHull([x, z]: Point, hull: Point[]): number {
  if (hull.length === 1) return Math.hypot(x - hull[0][0], z - hull[0][1]);
  let inside = hull.length >= 3;
  let best = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const [ax, az] = hull[i];
    const [bx, bz] = hull[(i + 1) % hull.length];
    // The hull runs counter-clockwise, so a point on the right of any edge is outside it.
    if ((bx - ax) * (z - az) - (bz - az) * (x - ax) < 0) inside = false;
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return inside ? 0 : best;
}

/** The person's column, as its centre and eight points round its edge. */
function column([x, z]: Point): Point[] {
  const out: Point[] = [[x, z]];
  for (let k = 0; k < 8; k++) out.push([x + PERSON_RADIUS_M * Math.sin((k * Math.PI) / 4), z + PERSON_RADIUS_M * Math.cos((k * Math.PI) / 4)]);
  return out;
}

/** Where a point sits in an upright round shape's footprint: under 1 is inside. */
function ellipseU(b: { centre: Point; ax: number; az: number; turn: number }, [x, z]: Point): number {
  const dx = x - b.centre[0], dz = z - b.centre[1];
  // Into the shape's own axes: undo its turn about the vertical.
  const c = Math.cos(b.turn), s = Math.sin(b.turn);
  const lx = c * dx - s * dz, lz = s * dx + c * dz;
  return (lx / Math.max(1e-6, b.ax)) ** 2 + (lz / Math.max(1e-6, b.az)) ** 2;
}

function blocks(b: Blocker, point: Point): boolean {
  if (b.kind === "hull") return distanceToHull(point, b.hull) < PERSON_RADIUS_M;
  return column(point).some((p) => {
    const u = ellipseU(b, p);
    if (u >= 1) return false;
    if (b.kind === "ellipse") return true;
    // An ellipsoid's own height where the person would be: under a seat's height, it is stood on.
    const half = b.ay * Math.sqrt(1 - u);
    return b.cy + half > SIT_TOP_M && b.cy - half < PERSON_HEIGHT_M;
  });
}

/** The first thing a person standing here would be inside, or null. */
export function blockerAt(point: Point, list: readonly Blocker[]): Blocker | null {
  for (const b of list) if (blocks(b, point)) return b;
  return null;
}

/**
 * The marks, each on open floor. A blocked mark moves to the nearest free
 * spot inside the set, looking first away from whatever it stood in; one
 * with no free spot within MARK_SEARCH_M stays where it was. Deterministic.
 * Anything with a place and a facing: Astra's marks, or the person's figure.
 */
export function clearMarks<M extends Pick<SetMark, "x" | "z" | "facingDeg">>(
  marks: readonly M[],
  objects: readonly SetObject[],
  bounds: { x: number; z: number },
): { marks: M[]; moved: number; stuck: number } {
  const list = blockers(objects);
  const halfX = bounds.x / 2 - PERSON_RADIUS_M;
  const halfZ = bounds.z / 2 - PERSON_RADIUS_M;
  let moved = 0;
  let stuck = 0;
  const out = marks.map((m) => {
    const blocker = blockerAt([m.x, m.z], list);
    if (!blocker) return m;
    const dx = m.x - blocker.centre[0], dz = m.z - blocker.centre[1];
    const away = Math.hypot(dx, dz) > 1e-6 ? Math.atan2(dx, dz) : m.facingDeg * DEG;
    for (let r = STEP_M; r <= MARK_SEARCH_M + 1e-9; r += STEP_M) {
      for (let k = 0; k < BEARINGS; k++) {
        // 0, +1, −1, +2, −2 … steps round from "away".
        const step = k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2);
        const a = away + (step * 2 * Math.PI) / BEARINGS;
        const x = Math.round((m.x + r * Math.sin(a)) * 100) / 100;
        const z = Math.round((m.z + r * Math.cos(a)) * 100) / 100;
        if (Math.abs(x) > halfX || Math.abs(z) > halfZ) continue;
        if (blockerAt([x, z], list)) continue;
        moved += 1;
        return { ...m, x, z };
      }
    }
    stuck += 1;
    return m;
  });
  return { marks: out, moved, stuck };
}
