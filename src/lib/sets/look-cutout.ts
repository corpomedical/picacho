// Where a set's objects are in an earlier still (Astra Sets, 2026-09-12),
// so that only they ride as the next shot's look. Pure and relative-import
// only: vitest loads it as it is.
//
// WHY THE LOOK IS A CUTOUT. The look keeps a set's car the same car by
// handing GPT Image an earlier still from the set. Handed the WHOLE still,
// it copies that still's camera, distance, background and pose, whatever
// the prompt says: 4 of 4 prompt and image-order variants did, against the
// operator's own race-track shot. Handed only the objects, cut out of the
// still onto plain grey, the new still follows its own sketch and keeps the
// car's design — tested twice, the second time with a machine cutout made
// the way this one is (docs/ASTRA_SETS.md, "The operator's first real
// test"). So the look is only ever the cutout: this module says where the
// objects are in the earlier still, as boxes; SAM 2 cuts them out
// (providers/fal-segment.ts) and look-cutout-image.ts lays them on grey.
//
// WHERE THE STILL WAS DRAWN FROM. A still follows its sketch, and the sketch
// is the centre square of the stage canvas (set-view.tsx cropSquare), seen
// from the camera recorded with the shot (location_set_shots.camera). On a
// landscape canvas that square spans the camera's vertical field of view; on
// a portrait one only the canvas's width, whose angle is
// 2·atan(aspect·tan(fov/2)) (match-shot.ts works from the same rule). So the
// sketch is exactly what a SQUARE camera at the same pose, with that field
// of view, sees; a point's place in that square maps onto the still's own
// width and height. GPT Image stills are 1024 × 1024; FLUX's may not be
// square, so each axis is scaled on its own.
//
// WHAT COUNTS AS AN OBJECT. What a person recognises from one still to the
// next — a car, a sofa, a stall — is built from PROP-sized shapes, none
// longer than LOOK_PROP_MAX_M on any side: a wall, a grandstand or a track
// is structure, which the sketch already draws and the look must not carry.
// A shape counts only where the sketch showed it: in front of the camera,
// within LOOK_MAX_DISTANCE_M, and not behind structure (a box around a car
// hidden behind a wall would have SAM cut the wall out instead). A car is
// some fifteen to fifty shapes, so shapes whose boxes touch or nearly touch
// (LOOK_TOUCH_M) are one object, and a run of them longer than
// LOOK_GROUP_MAX_M — kerb stones laid end to end down a straight — is
// scenery again. Only the few largest objects on screen are kept, none
// smaller than LOOK_MIN_SHARE of the frame.
//
// ONE BOX PER SHAPE THAT SHOWS. SAM 2 makes one mask of every box it is
// given, and a thin part (a car's rear wing) is caught only when it has a
// box of its own (measured 2026-09-12). So each shape that shows gets one —
// but a shape lying wholly inside what the object's larger shapes already
// cover on screen (a tail light on the bodywork, a slat on the engine cover)
// adds nothing, and is left out: the largest shape first, then whichever
// adds the most the others do not cover, on a LOOK_COVER_GRID grid, until
// none adds anything. Every box is then grown well past its shape, by a
// share of its whole object's size on screen: GPT Image does not put things
// exactly where the sketch does — in the operator's first race-track still
// the car came out at about 85% of its sketch size, and higher — so a part
// can land several percent of its object's size from where it was sketched.
//
// THE MONEY. SAM 2 on fal (fal-ai/sam2/image) costs $0.0008 per compute
// second (unit_price 0.0008, unit "compute seconds": fal's pricing API,
// GET api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/sam2/image, read
// 2026-09-12). Two test calls took about 2–3 s of wall time each, the
// compute inside it:
//   a measured cut, at most   3 s × $0.0008 = $0.0024
//   worst case, a cut run to the 30 s the shot waits for it
//   (fal-segment.ts SAM2_TIMEOUT_MS): 30 s × $0.0008 = $0.024 — a fal
//   runner that outlives our wait may still bill it
// Paid once per look: the cutout is kept (set-config.ts setLookCutoutPath),
// so every later shot with the same look reuses it. A cut that fails keeps
// nothing, so the next shot with that look pays to try again — at most as
// often as the shot's burst brake lets anyone shoot (12 in 10 minutes,
// actions.ts): 12 × $0.024 = $0.288 in 10 minutes if every one ran out the
// wait. The person still pays the flat one credit an image take costs; next
// to a GPT Image still (IMAGE_COST_USD, $0.17, admin/economics.ts) a
// measured cut is $0.0024 ÷ $0.17 ≈ 1.4% more, once.
//
// THE PROCESSOR. The still goes to fal inline, as a data URI, and the cut
// comes back inline in the answer (sync_mode): no link to either is made.
// fal already receives the character's own photos for every FLUX render, so
// no new kind of processor sees the person's pictures.

import { rotationXYZ } from "./marks";
import { SET_LIMITS, type SetObject, type SetSpec, type Vec3 } from "./set-spec";
import { SAM2_TIMEOUT_MS, type SegmentBox } from "../generations/providers/fal-segment";

const DEG = Math.PI / 180;

/** fal's SAM 2 price, USD per compute second (pricing API, 2026-09-12). */
export const SAM2_USD_PER_COMPUTE_SECOND = 0.0008;
/** The longest of the two measured cuts, wall time, compute included. */
export const LOOK_CUT_MEASURED_SECONDS = 3;
/** 3 s × $0.0008 = $0.0024. */
export const LOOK_CUT_MEASURED_USD = LOOK_CUT_MEASURED_SECONDS * SAM2_USD_PER_COMPUTE_SECOND;
/** A cut is not waited for past SAM2_TIMEOUT_MS: 30 s × $0.0008 = $0.024. */
export const LOOK_CUT_WORST_USD = (SAM2_TIMEOUT_MS / 1000) * SAM2_USD_PER_COMPUTE_SECOND;

/** Longer than this on any side and a shape is structure (a wall, a grandstand), not an object. A car is under 5 m. */
export const LOOK_PROP_MAX_M = 6;
/** Further from the camera than this and a prop is a handful of pixels in the still. */
export const LOOK_MAX_DISTANCE_M = 40;
/** Shapes whose boxes come within this of each other are one object: a wing on its supports, a table's top on its legs. */
export const LOOK_TOUCH_M = 0.25;
/** An "object" longer than this on any side is a run of props laid end to end — a kerb line, a row of barriers — and scenery. */
export const LOOK_GROUP_MAX_M = 12;
/** The objects kept, largest on screen first. */
export const LOOK_MAX_GROUPS = 3;
/** An object smaller than this share of the frame on screen is not kept. */
export const LOOK_MIN_SHARE = 0.01;
/** Each box grows, on each side, by this share of its object's size on screen… */
export const LOOK_GROW_SHARE = 0.1;
/** …plus this share of the frame. */
export const LOOK_GROW_FRAME = 0.02;
/** At most this many boxes go to SAM 2, the largest object's first. */
export const LOOK_MAX_BOXES = 24;
/** Cells a side of the grid that says what a shape adds on screen: 16 px on a 1024 still. */
export const LOOK_COVER_GRID = 64;
/** The stage camera's near plane (set-view.tsx): a shape reaching behind it is at the lens, not in the picture. */
const NEAR_M = 0.05;
/** The canvas shapes a stored camera may claim, width ÷ height: a phone held upright to a very wide screen. */
const CANVAS_ASPECT = [0.2, 10] as const;

/** The camera a shot's frame was taken from, as location_set_shots.camera holds it. */
export type ShotCamera = { position: Vec3; target: Vec3; fovDeg: number; canvasAspect: number };

/** A box for SAM 2 in the still's own pixels, and which copy of which of the spec's objects it was drawn round. */
export type LookBox = SegmentBox & { object: number; copy: number };

/** An object kept: its box on screen (0–1, left to right and top to bottom), its share of the frame, its shapes. */
export type LookObject = { box: FrameBox; share: number; shapes: number };

type FrameBox = { u0: number; v0: number; u1: number; v1: number };

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A stored camera, read back through the same bounds it was written with:
 * the lens a saved layout keeps (SET_LIMITS minLayoutFovDeg–maxFovDeg) and a
 * canvas shape inside CANVAS_ASPECT. Null for anything that is not a camera
 * — a missing canvas shape included: without it a portrait still's frame is
 * unknown, and a shot with no camera is never a look's source.
 */
export function normaliseShotCamera(value: unknown): ShotCamera | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const reach = SET_LIMITS.maxCoordinate * 2;
  const vec = (x: unknown): Vec3 | null =>
    Array.isArray(x) && x.length === 3 && x.every((n) => finite(n) && Math.abs(n) <= reach) ? [x[0], x[1], x[2]] : null;
  const position = vec(v.position);
  const target = vec(v.target);
  if (!position || !target) return null;
  if (Math.hypot(target[0] - position[0], target[1] - position[1], target[2] - position[2]) < 0.1) return null;
  if (!finite(v.fovDeg) || !finite(v.canvasAspect) || v.canvasAspect <= 0) return null;
  return {
    position,
    target,
    fovDeg: clamp(v.fovDeg, SET_LIMITS.minLayoutFovDeg, SET_LIMITS.maxFovDeg),
    canvasAspect: clamp(v.canvasAspect, CANVAS_ASPECT[0], CANVAS_ASPECT[1]),
  };
}

/** The field of view of the sketch's square: the lens's on a landscape canvas, the canvas's width's on a portrait one. */
export function sketchFovDeg(fovDeg: number, canvasAspect: number): number {
  return canvasAspect >= 1 ? fovDeg : (2 * Math.atan(canvasAspect * Math.tan((fovDeg * DEG) / 2))) / DEG;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Where a world point falls in the sketch's square, u from 0 at the left to
 * 1 at the right and v from 0 at the top to 1 at the bottom; null behind the
 * near plane. The camera turns as three.js's lookAt turns it (Matrix4.lookAt,
 * up +Y, with its nudge when looking straight down), so this is the stage
 * camera's own projection.
 */
export function sketchProjector(camera: ShotCamera): (point: Vec3) => { u: number; v: number } | null {
  let z = sub(camera.position, camera.target);
  z = Math.hypot(...z) === 0 ? [0, 0, 1] : unit(z);
  let x = cross([0, 1, 0], z);
  if (Math.hypot(...x) === 0) {
    z = unit([z[0], z[1], z[2] + 0.0001]);
    x = cross([0, 1, 0], z);
  }
  x = unit(x);
  const y = cross(z, x);
  const t = Math.tan((sketchFovDeg(camera.fovDeg, camera.canvasAspect) * DEG) / 2);
  return (point) => {
    const d = sub(point, camera.position);
    const depth = -dot(d, z);
    if (depth <= NEAR_M) return null;
    return { u: 0.5 + dot(d, x) / (2 * depth * t), v: 0.5 - dot(d, y) / (2 * depth * t) };
  };
}

type Shape = {
  object: number;
  copy: number;
  /** World box round the shape, as turned. */
  min: Vec3;
  max: Vec3;
  /** Its box in the sketch, clipped to the frame; null when none of it is in frame. */
  box: FrameBox | null;
};

/** One copy of an object as build-scene.ts places it: its centre, its turn (rows of three.js's XYZ matrix), half its sides. */
type Placed = { object: number; copy: number; centre: Vec3; r: number[][]; half: Vec3; prop: boolean };

function placedCopies(objects: readonly SetObject[]): Placed[] {
  const out: Placed[] = [];
  objects.forEach((o, object) => {
    // A ring is built flat at its real sizes, across × tube × across; a
    // plane lies flat before it is turned, with no thickness (build-scene.ts).
    const [sx, sy, sz] =
      o.shape === "torus" ? [o.size[0], o.size[1], o.size[0]] : o.shape === "plane" ? [o.size[0], 0, o.size[2]] : o.size;
    const prop = o.shape !== "plane" && Math.max(sx, sy, sz) <= LOOK_PROP_MAX_M;
    const r = rotationXYZ(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG);
    const count = o.repeat?.count ?? 1;
    const step: Vec3 = o.repeat?.offset ?? [0, 0, 0];
    for (let copy = 0; copy < count; copy++) {
      const centre: Vec3 = [o.position[0] + step[0] * copy, o.position[1] + step[1] * copy, o.position[2] + step[2] * copy];
      out.push({ object, copy, centre, r, half: [sx / 2, sy / 2, sz / 2], prop });
    }
  });
  return out;
}

/**
 * Whether the straight line from `from` to `to` enters `p` on the way, as
 * the stage draws it: only a box's outside faces are drawn (a camera
 * standing inside a box sees out of it), a plane from both sides.
 */
function entersOnTheWay(from: Vec3, to: Vec3, p: Placed): boolean {
  // Into the copy's own axes: R's transpose undoes its turn.
  const o = sub(from, p.centre);
  const d = sub(to, from);
  let enter = -Infinity;
  let leave = Infinity;
  for (let i = 0; i < 3; i++) {
    const oi = p.r[0][i] * o[0] + p.r[1][i] * o[1] + p.r[2][i] * o[2];
    const di = p.r[0][i] * d[0] + p.r[1][i] * d[1] + p.r[2][i] * d[2];
    const h = p.half[i];
    if (Math.abs(di) < 1e-12) {
      if (Math.abs(oi) > h) return false;
      continue;
    }
    const a = (-h - oi) / di;
    const b = (h - oi) / di;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
  }
  return enter <= leave && enter > 0 && enter < 1;
}

/**
 * Every copy of every prop-sized object that the camera could see: wholly in
 * front of it, near enough to count, and with its centre not behind
 * structure — a wall, a grandstand, a plane — as the stage would draw it.
 * (A shape half hidden counts by its centre; props hiding props are left to
 * SAM 2, which cuts the nearer one, itself an object.)
 */
function propShapes(objects: readonly SetObject[], camera: ShotCamera): Shape[] {
  const project = sketchProjector(camera);
  const copies = placedCopies(objects);
  const structure = copies.filter((p) => !p.prop);
  const out: Shape[] = [];
  for (const p of copies) {
    if (!p.prop) continue;
    if (Math.hypot(...sub(p.centre, camera.position)) > LOOK_MAX_DISTANCE_M) continue;
    const world: Vec3[] = [];
    for (const cx of [-1, 1]) for (const cy of [-1, 1]) for (const cz of [-1, 1]) {
      const [lx, ly, lz] = [cx * p.half[0], cy * p.half[1], cz * p.half[2]];
      world.push([
        p.centre[0] + p.r[0][0] * lx + p.r[0][1] * ly + p.r[0][2] * lz,
        p.centre[1] + p.r[1][0] * lx + p.r[1][1] * ly + p.r[1][2] * lz,
        p.centre[2] + p.r[2][0] * lx + p.r[2][1] * ly + p.r[2][2] * lz,
      ]);
    }
    const seen = world.map(project);
    // Reaching behind the lens: the camera stands in it or beside it.
    if (seen.some((s) => s === null)) continue;
    if (structure.some((s) => entersOnTheWay(camera.position, p.centre, s))) continue;
    const us = seen.map((s) => s!.u);
    const vs = seen.map((s) => s!.v);
    out.push({
      object: p.object,
      copy: p.copy,
      min: [0, 1, 2].map((i) => Math.min(...world.map((w) => w[i]))) as Vec3,
      max: [0, 1, 2].map((i) => Math.max(...world.map((w) => w[i]))) as Vec3,
      box: clip({ u0: Math.min(...us), v0: Math.min(...vs), u1: Math.max(...us), v1: Math.max(...vs) }),
    });
  }
  return out;
}

function clip(b: FrameBox): FrameBox | null {
  const c = { u0: clamp(b.u0, 0, 1), v0: clamp(b.v0, 0, 1), u1: clamp(b.u1, 0, 1), v1: clamp(b.v1, 0, 1) };
  return c.u1 > c.u0 && c.v1 > c.v0 ? c : null;
}

const area = (b: FrameBox) => (b.u1 - b.u0) * (b.v1 - b.v0);

/** The grid cells a box covers (LOOK_COVER_GRID a side); a sliver covers at least one row or column. */
function cellsOf(b: FrameBox): number[] {
  const n = LOOK_COVER_GRID;
  const i0 = Math.min(n - 1, Math.floor(b.u0 * n));
  const j0 = Math.min(n - 1, Math.floor(b.v0 * n));
  const i1 = Math.max(i0 + 1, Math.ceil(b.u1 * n));
  const j1 = Math.max(j0 + 1, Math.ceil(b.v1 * n));
  const out: number[] = [];
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) out.push(j * n + i);
  return out;
}

const touch = (a: Shape, b: Shape) =>
  [0, 1, 2].every((i) => a.min[i] - LOOK_TOUCH_M <= b.max[i] && b.min[i] - LOOK_TOUCH_M <= a.max[i]);

/** Shapes that touch, directly or through each other, as one object each. */
function objectsOf(shapes: Shape[]): Shape[][] {
  const parent = shapes.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      if (touch(shapes[i], shapes[j])) parent[root(i)] = root(j);
    }
  }
  const groups = new Map<number, Shape[]>();
  shapes.forEach((s, i) => {
    const r = root(i);
    groups.set(r, [...(groups.get(r) ?? []), s]);
  });
  return [...groups.values()];
}

/**
 * The boxes to send SAM 2 to cut the look's objects out of an earlier still
 * of `width` × `height` pixels, drawn from `camera` (see the header). Empty
 * when no object qualifies — the camera looked at bare structure or sky —
 * and then there is nothing to cut: the shot goes without its look.
 */
export function lookCutoutBoxes(
  spec: Pick<SetSpec, "objects">,
  camera: ShotCamera,
  still: { width: number; height: number },
): { boxes: LookBox[]; objects: LookObject[] } {
  const none = { boxes: [], objects: [] };
  if (!finite(still.width) || !finite(still.height) || still.width < 1 || still.height < 1) return none;
  const cam = normaliseShotCamera(camera);
  if (!cam) return none;

  const kept = objectsOf(propShapes(spec.objects, cam))
    .filter((shapes) =>
      [0, 1, 2].every((i) => Math.max(...shapes.map((s) => s.max[i])) - Math.min(...shapes.map((s) => s.min[i])) <= LOOK_GROUP_MAX_M),
    )
    .map((shapes) => {
      const inFrame = shapes.filter((s) => s.box !== null);
      if (inFrame.length === 0) return null;
      const box: FrameBox = {
        u0: Math.min(...inFrame.map((s) => s.box!.u0)),
        v0: Math.min(...inFrame.map((s) => s.box!.v0)),
        u1: Math.max(...inFrame.map((s) => s.box!.u1)),
        v1: Math.max(...inFrame.map((s) => s.box!.v1)),
      };
      return { box, share: area(box), shapes: inFrame };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null && g.share >= LOOK_MIN_SHARE)
    .sort((a, b) => b.share - a.share)
    .slice(0, LOOK_MAX_GROUPS);

  // What the shapes already chosen cover, as sketched (before growing).
  const covered = new Set<number>();
  const sent: { box: FrameBox; object: number; copy: number }[] = [];
  for (const g of kept) {
    const growU = LOOK_GROW_SHARE * (g.box.u1 - g.box.u0) + LOOK_GROW_FRAME;
    const growV = LOOK_GROW_SHARE * (g.box.v1 - g.box.v0) + LOOK_GROW_FRAME;
    // Largest first; between equals, in the spec's order — so each pick below
    // is the same for the same set, and a tie goes to the bigger shape.
    const left = [...g.shapes]
      .sort((a, b) => area(b.box!) - area(a.box!) || a.object - b.object || a.copy - b.copy)
      .map((s) => ({ s, cells: cellsOf(s.box!) }));
    while (sent.length < LOOK_MAX_BOXES && left.length > 0) {
      let best = -1;
      let bestGain = 0;
      left.forEach(({ cells }, k) => {
        const gain = cells.reduce((n, c) => n + (covered.has(c) ? 0 : 1), 0);
        if (gain > bestGain) {
          best = k;
          bestGain = gain;
        }
      });
      // Every shape left lies inside what is already boxed.
      if (best < 0) break;
      const [{ s, cells }] = left.splice(best, 1);
      for (const c of cells) covered.add(c);
      const grown = clip({ u0: s.box!.u0 - growU, v0: s.box!.v0 - growV, u1: s.box!.u1 + growU, v1: s.box!.v1 + growV })!;
      sent.push({ box: grown, object: s.object, copy: s.copy });
    }
  }

  // Onto the still's own pixels, each axis on its own; whole pixels inside it.
  const px = (t: number, size: number, round: (n: number) => number) => clamp(round(t * size), 0, size - 1);
  return {
    boxes: sent.map(({ box, object, copy }) => ({
      x_min: px(box.u0, still.width, Math.floor),
      y_min: px(box.v0, still.height, Math.floor),
      x_max: px(box.u1, still.width, Math.ceil),
      y_max: px(box.v1, still.height, Math.ceil),
      object,
      copy,
    })),
    objects: kept.map((g) => ({ box: g.box, share: g.share, shapes: g.shapes.length })),
  };
}
