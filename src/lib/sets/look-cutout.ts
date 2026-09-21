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
// car's design — tested twice: a car cut out by hand, then one cut out by
// SAM 2 (the cutter used here) from a box placed by hand and sent in the
// product's image order (docs/ASTRA_SETS.md, "The operator's first real
// test"). So the look is only ever the cutout: this module says where the
// objects are in the earlier still, a box and a point each; SAM 2 cuts them
// out (providers/fal-segment.ts) and look-cutout-image.ts lays them on
// grey. This module's own cut, the person's region and the JPEG went
// through fal on 2026-09-14, on that same still, and came back as the car
// whole on grey with nothing of the person (below, ONE CUT PER OBJECT); a
// shot of the product's own has yet to send one.
//
// WHERE THE STILL WAS DRAWN FROM. A still follows its sketch, and the sketch
// is the centre square of the stage canvas (set-view.tsx cropSquare), seen
// from the camera recorded with the shot (location_set_shots.camera): the
// pose the stage was in when the frame was taken, as the page sent it — not
// the saved layout's copy, which is held to the set's reach and so can be a
// different camera (shot-camera.ts). On a landscape canvas that square spans
// the camera's vertical field of view; on a portrait one only the canvas's
// width, whose angle is 2·atan(aspect·tan(fov/2)) (match-shot.ts works from
// the same rule). So the sketch is exactly what a SQUARE camera at the same
// pose, with that field of view, sees; a point's place in that square maps
// onto the still's own width and height. GPT Image stills are 1024 × 1024;
// FLUX's may not be square, so each axis is scaled on its own.
//
// WHAT COUNTS AS AN OBJECT. What a person recognises from one still to the
// next — a car, a sofa, a stall — is built from PROP-sized shapes. Structure
// is what the sketch already draws and the look must not carry: a shape
// longer than LOOK_PROP_MAX_M on a side (a grandstand, a track); a slab
// broad two ways (LOOK_SLAB_MIN_M — a small room's wall, floor or ceiling,
// which touch its furniture and would make the whole room one object that
// fills the frame); a shape standing most of the set's height
// (LOOK_TALL_SHARE — a wall of a low room, a pillar); a plane; and a run —
// an object repeated over more than LOOK_GROUP_MAX_M, kerb stones laid down
// a straight, a row of barriers — which is scenery wherever the camera
// stands, and never takes the car beside it down with it. Props whose boxes
// touch or nearly touch (LOOK_TOUCH_M) are one object, decided from the set
// alone, before any camera: a car is some fifteen to fifty shapes. A chain
// of them longer than LOOK_GROUP_MAX_M is scenery too. An object then counts
// by the shapes the sketch showed: in front of the lens, inside the frame,
// and with its centre not behind structure as the stage draws it (a box
// round a car hidden behind a wall would have SAM cut the wall out instead).
// How far off it stands does not matter, only how big it is on screen — a
// long lens fills the frame from fifty metres: the few largest objects on
// screen are kept, none smaller than LOOK_MIN_SHARE of the frame.
//
// ONE CUT PER OBJECT: A BOX AND A POINT. A box alone is not enough. A box
// drawn from the sketch is always loose — GPT Image does not put things
// where the sketch does: in the operator's first race-track still the car
// came out at about 85% of its sketch size, and higher — and with a loose
// box SAM 2 cuts the biggest thing inside it. Measured 2026-09-14 on that
// still with this module's own boxes and no point: eight boxes round the
// car's parts came back as the wall and the road with the car cut out of
// them; the body's box and the wing's, the same; one box round the whole
// car, the road under it. The same box with one positive point on the car
// cut the car whole, rear wing included (the earlier finding that a thin
// part needs a box of its own was made without a point); the point alone
// cut the wheel under it. So each object is one request of its own
// (providers/fal-segment.ts): one box round all of it that shows, grown by
// LOOK_GROW_SHARE of its size on screen plus LOOK_GROW_FRAME of the frame
// on every side, and one positive point where the object surely is: the
// deeper inside it the better, since the object is drawn a little off its
// sketch. The middle of the object on screen, when one of its parts lies
// there — a car's body, a sofa's seat, a pedestal table's pedestal; else
// (a table on four legs is hollow in the middle) the middle of the box
// once it is cut back clear of the person (below), when a part lies there;
// else the centre of the largest part that shows, then of the next largest
// — never a point outside the box as cut back. An object with no such
// point is not cut. On still 1 the middle lands on the car's body; with the
// figure at the car's middle instead, the box is the car's rear, clear of
// the person, and the point its middle, on the rear bodywork. At most
// LOOK_MAX_GROUPS requests a look, run together.
//
// NEVER THE PERSON. The still has a person in it, and the look must carry
// none: the prompt tells the model to draw what the cutout shows exactly as
// it looks, and it would put the earlier character's body and clothes into
// a shot of someone else. SAM 2 cuts what is in its boxes, and a box round a
// car's nose, a chair or a counter can be mostly the person beside, on or
// behind it. So the grey figure's place is recorded with the camera, and
// its box on screen, grown well past it, is the person's region — AND,
// since 2026-09-14, so is every person a vision model finds in the still
// itself (look-people.ts): the operator's fourth still had the person drawn
// sitting a metre from where the figure stood, and the region from the
// figure alone left her in the cut. Every box is cut back to what lies
// clear of every region, a box they mostly cover is dropped, and
// look-cutout-image.ts clears them out of whatever SAM 2 kept. The figure's
// region is grown
// by LOOK_FIGURE_GROW of the figure's height on screen to each side and
// below, and by LOOK_FIGURE_GROW_UP above: GPT Image drew the operator's
// first race-track still's person far larger than the figure and lower,
// about 1.7 times its height, reaching past its box by some 27% of its
// height toward the car, 16% above it and 36% below; and the third still's
// (2026-09-14, shot from behind the car with the person at its middle) so
// much closer than the sketch that the head reached 59% of the figure's
// height above its box. The head is what must never come through, and
// little of an object ever stands above one, so the region reaches highest
// there. Whatever part of an object stands inside that region is lost from the
// look — the price of never carrying a person. A still whose figure was not
// in its frame, reached behind the lens, or stood hidden behind structure
// offers no look at all: nobody can say where its person is.
//
// THE SECOND PASS (2026-09-21). Framed head to feet, the grown region is the
// whole frame: every object is cut back to nothing, and the still lends no
// look. The operator's first real film was shot on such a set — all 13 of
// its stills lent nothing, every beat's end still drew its car afresh from
// words, and the clips cross-faded between two different cars. So when the
// first pass leaves nothing to cut AND the vision reader found someone where
// the figure says one is (never on an answer of no people, never past
// LOOK_PEOPLE_MAX of them), the regions become the figure's own box on
// screen (grown by LOOK_GROW_FRAME) and every box the reader found, grown by
// LOOK_FOUND_GROW of its own height on every side: the margins that guessed
// where GPT Image drew the person give way to where the picture says they
// are, and the figure's own place is still cleared, so whichever of the two
// is wrong, the other stands. Everything else is the first pass's: boxes cut
// back clear of every region, an object mostly covered dropped, the point
// inside the box as cut back, rectangles cleared out of what SAM 2 kept. A
// cutout from this pass is read for people once more before it is kept
// (look-cutout-store.ts), and one with anyone in it is not a look. The page
// predicts it (seesLookObjects) with the figure's own box standing in for
// the person the reader will find; the reader may find them larger or
// elsewhere, and then the shot goes without its look and says so.
//
// THE MONEY. SAM 2 on fal (fal-ai/sam2/image) costs $0.0008 per compute
// second (unit_price 0.0008, unit "compute seconds": fal's pricing API,
// GET api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/sam2/image, read
// 2026-09-12). Seven calls so far took 2–20 s of wall time each, the compute
// inside it: two of 2–3 s on 2026-09-12, and on 2026-09-14 one cold call of
// 20 s, then 12, 6.4, 4.5 and 4.3 s. Taking the longest warm call:
//   a measured cut, at most   7 s × $0.0008 = $0.0056
//   worst case, a cut run to the 30 s the shot waits for it
//   (fal-segment.ts SAM2_TIMEOUT_MS): 30 s × $0.0008 = $0.024 — a fal
//   runner that outlives our wait may still bill it
// Paid per object, at most LOOK_MAX_GROUPS objects a look, cut together:
//   a look, measured   3 × $0.0056 = $0.0168 at most; most sets have one
//   object that counts (a car, a sofa) and pay one cut
//   a look, worst      3 × $0.024 = $0.072
// The cutout is kept (set-config.ts setLookCutoutPath), so a look pinned to
// one still is cut once and reused by every shot after it — but the page's
// default look follows the newest still (set-view.tsx), so under it nearly
// every shot takes a still never cut before and pays its cuts: $0.0056 a
// shot for one object as measured, next to a GPT Image still's $0.17
// (IMAGE_COST_USD, admin/economics.ts) about 3.3% more. A look that fails
// keeps nothing, so the next shot with it pays to try again — at most as
// often as the shot's burst brake lets anyone shoot (12 in 10 minutes,
// actions.ts): 12 × $0.072 = $0.864 in 10 minutes if every object of every
// one ran out the wait. The person still pays the flat one credit an image
// take costs.
//
// THE PROCESSOR. The still goes to fal inline, as a data URI, and the cut
// comes back inline in the answer (sync_mode): no link to either is made.
// fal already receives the character's own photos for every FLUX render, so
// no new kind of processor sees the person's pictures.

import { STAND_IN_HEIGHT_M } from "./build-scene";
import { rotationXYZ } from "./marks";
import { SET_LIMITS, type SetObject, type SetSpec, type Vec3 } from "./set-spec";
import { SAM2_TIMEOUT_MS, type SegmentBox, type SegmentPoint } from "../generations/providers/fal-segment";

const DEG = Math.PI / 180;

/** fal's SAM 2 price, USD per compute second (pricing API, 2026-09-12). */
export const SAM2_USD_PER_COMPUTE_SECOND = 0.0008;
/** The longest warm cut measured, wall time, compute included (the header). */
export const LOOK_CUT_MEASURED_SECONDS = 7;
/** 7 s × $0.0008 = $0.0056. */
export const LOOK_CUT_MEASURED_USD = LOOK_CUT_MEASURED_SECONDS * SAM2_USD_PER_COMPUTE_SECOND;
/** A cut is not waited for past SAM2_TIMEOUT_MS: 30 s × $0.0008 = $0.024. */
export const LOOK_CUT_WORST_USD = (SAM2_TIMEOUT_MS / 1000) * SAM2_USD_PER_COMPUTE_SECOND;

/** Longer than this on any side and a shape is structure (a wall, a grandstand), not an object. A car is under 5 m. */
export const LOOK_PROP_MAX_M = 6;
/** Broad this much two ways and a shape is a slab — a wall, a floor, a ceiling — not an object. A car is under 2 m wide; a bed under 2.2 m. */
export const LOOK_SLAB_MIN_M = 3;
/** Standing this share of the set's height and a shape is a wall or a pillar, not an object. */
export const LOOK_TALL_SHARE = 0.8;
/** Shapes whose boxes come within this of each other are one object: a wing on its supports, a table's top on its legs. */
export const LOOK_TOUCH_M = 0.25;
/** An object repeated over more than this, or a chain of touching props longer than it, is a run — a kerb line, a row of barriers — and scenery. */
export const LOOK_GROUP_MAX_M = 12;
/** The objects kept, largest on screen first: one request to SAM 2 each. */
export const LOOK_MAX_GROUPS = 3;
/** A look's cuts at most, as measured: 3 × $0.0056 = $0.0168. */
export const LOOK_MEASURED_USD = LOOK_MAX_GROUPS * LOOK_CUT_MEASURED_USD;
/** A look's cuts at most, every one run to the wait: 3 × $0.024 = $0.072. */
export const LOOK_WORST_USD = LOOK_MAX_GROUPS * LOOK_CUT_WORST_USD;
/** An object smaller than this share of the frame on screen is not kept. */
export const LOOK_MIN_SHARE = 0.01;
/** An object's box grows, on each side, by this share of its size on screen… */
export const LOOK_GROW_SHARE = 0.1;
/** …plus this share of the frame. */
export const LOOK_GROW_FRAME = 0.02;
/**
 * Half the grey figure's footprint, whichever way it faces: its hands reach
 * 0.32 m to each side and its toes 0.19 m ahead (build-scene.ts
 * buildStandIn), and √(0.32² + 0.19²) ≈ 0.37.
 */
export const LOOK_FIGURE_HALF_M = 0.37;
/** The person's region reaches past the figure's box on screen, to each side and below, by this share of its height there (plus LOOK_GROW_FRAME)… */
export const LOOK_FIGURE_GROW = 0.4;
/** …and above, where the head is, by this share: the operator's third still drew the person's head 59% of the figure's height above it. */
export const LOOK_FIGURE_GROW_UP = 0.7;
/** The second pass (the header): each person the reader found grows by this share of their own height on every side — hands, hair, a held helmet. Unmeasured; a margin. */
export const LOOK_FOUND_GROW = 0.1;
/** The reader keeps at most this many people (look-people.ts LOOK_PEOPLE_MAX); a still with this many may hold more, and stays on the first pass. */
const LOOK_FOUND_CROWD = 8;
/** A box cut back clear of the person's region must keep at least this share of itself, or it is dropped. */
export const LOOK_FIGURE_MIN_LEFT = 0.25;
/** The stage camera's near plane (set-view.tsx): a shape reaching behind it is at the lens, not in the picture. */
const NEAR_M = 0.05;
/** The canvas shapes a stored camera may claim, width ÷ height: a phone held upright to a very wide screen. */
const CANVAS_ASPECT = [0.2, 10] as const;
/** Heights up the figure that, seen past any structure, put it in the sketch: its middle and its head. */
const FIGURE_SEEN_AT_M = [0.9, 1.6] as const;
/** How the boxes are chosen does not depend on the still's size (they are worked out in the square, then scaled). */
const ANY_STILL = { width: 1024, height: 1024 };

/**
 * The frame a shot was taken from, as location_set_shots.camera holds it:
 * the stage camera's pose and the canvas's shape when the frame was taken,
 * and where the grey figure stood on the ground (its mark), so the person's
 * place in the still is known.
 */
export type ShotCamera = {
  position: Vec3;
  target: Vec3;
  fovDeg: number;
  canvasAspect: number;
  figure: { x: number; z: number };
  /**
   * A rig format's frame (rig.ts, Helios Cinema 2026-09-15): the sketch was
   * drawn at `render` width ÷ height with `fovDeg` across its height, and
   * the still is the band of `band` width ÷ height cut from its middle.
   * Absent for every square still, whose sketch is the canvas's centre
   * square as before.
   */
  frame?: { render: number; band: number; squeeze?: number };
};

/**
 * One object to cut, in the still's own pixels: the box round all of it that
 * shows, and a point on it — the centre on screen of its largest part that
 * shows, which copy of which of the spec's objects `object` and `copy` say.
 */
export type LookCut = { box: SegmentBox; point: SegmentPoint; object: number; copy: number };

/** An object kept: its box on screen (0–1, left to right and top to bottom), its share of the frame, its shapes. */
export type LookObject = { box: FrameBox; share: number; shapes: number };

/** A region of the sketch's square, and so of the still: 0–1 across and down. */
export type FrameBox = { u0: number; v0: number; u1: number; v1: number };

/** What of a set the boxes are worked out from: its objects, and its height (what a wall stands most of). */
export type LookSet = Pick<SetSpec, "objects"> & { bounds: Pick<SetSpec["bounds"], "height"> };

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const within = (v: unknown, lo: number, hi: number): v is number => finite(v) && v >= lo && v <= hi;

/**
 * A shot's frame exactly as it was, or nothing: a pose, a lens a saved
 * layout can hold (SET_LIMITS minLayoutFovDeg–maxLayoutFovDeg), a canvas shape
 * inside CANVAS_ASPECT and the figure's place, every one as given. Nothing
 * is clamped, because a camera moved to fit a bound is not the camera the
 * frame was drawn from, and its boxes would miss what the still shows. Null
 * for anything else — a missing canvas shape or figure included — and a
 * shot with no camera is never a look's source.
 */
export function normaliseShotCamera(value: unknown): ShotCamera | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const reach = SET_LIMITS.maxCoordinate * 2;
  const vec = (x: unknown): Vec3 | null =>
    Array.isArray(x) && x.length === 3 && x.every((n) => within(n, -reach, reach)) ? [x[0], x[1], x[2]] : null;
  const position = vec(v.position);
  const target = vec(v.target);
  if (!position || !target) return null;
  if (Math.hypot(target[0] - position[0], target[1] - position[1], target[2] - position[2]) < 0.1) return null;
  if (!within(v.fovDeg, SET_LIMITS.minLayoutFovDeg, SET_LIMITS.maxLayoutFovDeg)) return null;
  if (!within(v.canvasAspect, CANVAS_ASPECT[0], CANVAS_ASPECT[1])) return null;
  const f = v.figure && typeof v.figure === "object" ? (v.figure as Record<string, unknown>) : null;
  const edge = SET_LIMITS.maxCoordinate;
  if (!f || !within(f.x, -edge, edge) || !within(f.z, -edge, edge)) return null;
  const camera: ShotCamera = { position, target, fovDeg: v.fovDeg, canvasAspect: v.canvasAspect, figure: { x: f.x, z: f.z } };
  if (v.frame !== undefined) {
    const fr = v.frame && typeof v.frame === "object" ? (v.frame as Record<string, unknown>) : null;
    if (!fr || !within(fr.render, FRAME_ASPECT[0], FRAME_ASPECT[1]) || !within(fr.band, FRAME_ASPECT[0], FRAME_ASPECT[1])) return null;
    // The anamorphic squeeze the negative was widened by (2026-09-18): a
    // still shot at 2× spans twice the width for the same lens, and its
    // boxes are measured on that. Absent on every still shot before, and on
    // every spherical one, which is the same as 1.
    if (fr.squeeze !== undefined && !within(fr.squeeze, 1, MAX_SQUEEZE)) return null;
    camera.frame = { render: fr.render, band: fr.band, ...(fr.squeeze !== undefined ? { squeeze: fr.squeeze } : {}) };
  }
  return camera;
}

/**
 * A rig frame's shapes, width ÷ height: 9:16 at the narrowest, and at the
 * widest a 2.39 band widened by the rig's 2× squeeze (4.78), with room. This
 * module names no rig, so the squeeze's own ceiling is a number here too.
 */
const FRAME_ASPECT = [0.4, 5] as const;
/** The widest anamorphic squeeze the rig offers (rig.ts RIG_SQUEEZES). */
const MAX_SQUEEZE = 2;

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
  // Half the frame's width and height as tangents: the square's are the
  // same; a rig frame's band spans the render's full width or full height,
  // whichever the cut keeps, and the band's own shape sets the other.
  let tx: number;
  let ty: number;
  if (camera.frame) {
    // The negative is widened by the squeeze (rig.ts formatFrame): the band
    // spans the lens's own height and that much more width.
    const tv = Math.tan((camera.fovDeg * DEG) / 2) * (camera.frame.squeeze ?? 1);
    const kept = Math.min(camera.frame.render, camera.frame.band);
    tx = tv * kept;
    ty = (tv * kept) / camera.frame.band;
  } else {
    tx = ty = Math.tan((sketchFovDeg(camera.fovDeg, camera.canvasAspect) * DEG) / 2);
  }
  return (point) => {
    const d = sub(point, camera.position);
    const depth = -dot(d, z);
    if (depth <= NEAR_M) return null;
    return { u: 0.5 + dot(d, x) / (2 * depth * tx), v: 0.5 - dot(d, y) / (2 * depth * ty) };
  };
}

/**
 * One copy of an object as build-scene.ts places it: its centre, its turn
 * (rows of three.js's XYZ matrix), half its sides, its eight corners as
 * turned and the world box round them; and whether it is a prop or structure
 * (the header), decided for the object as a whole, every copy alike.
 */
type Placed = { object: number; copy: number; centre: Vec3; r: number[][]; half: Vec3; corners: Vec3[]; min: Vec3; max: Vec3; prop: boolean };

/** A prop's copy where the sketch showed it: its box in the sketch's square. */
type Shown = { object: number; copy: number; box: FrameBox };

function placedCopies(objects: readonly SetObject[], bounds: { height: number }): Placed[] {
  const out: Placed[] = [];
  objects.forEach((o, object) => {
    // A ring is built flat at its real sizes, across × tube × across; a
    // plane lies flat before it is turned, with no thickness (build-scene.ts).
    const [sx, sy, sz] =
      o.shape === "torus" ? [o.size[0], o.size[1], o.size[0]] : o.shape === "plane" ? [o.size[0], 0, o.size[2]] : o.size;
    const r = rotationXYZ(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG);
    const half: Vec3 = [sx / 2, sy / 2, sz / 2];
    const count = o.repeat?.count ?? 1;
    const step: Vec3 = o.repeat?.offset ?? [0, 0, 0];
    const copies: Omit<Placed, "prop">[] = [];
    for (let copy = 0; copy < count; copy++) {
      const centre: Vec3 = [o.position[0] + step[0] * copy, o.position[1] + step[1] * copy, o.position[2] + step[2] * copy];
      const corners: Vec3[] = [];
      for (const cx of [-1, 1]) for (const cy of [-1, 1]) for (const cz of [-1, 1]) {
        const [lx, ly, lz] = [cx * half[0], cy * half[1], cz * half[2]];
        corners.push([
          centre[0] + r[0][0] * lx + r[0][1] * ly + r[0][2] * lz,
          centre[1] + r[1][0] * lx + r[1][1] * ly + r[1][2] * lz,
          centre[2] + r[2][0] * lx + r[2][1] * ly + r[2][2] * lz,
        ]);
      }
      copies.push({
        object,
        copy,
        centre,
        r,
        half,
        corners,
        min: [0, 1, 2].map((i) => Math.min(...corners.map((c) => c[i]))) as Vec3,
        max: [0, 1, 2].map((i) => Math.max(...corners.map((c) => c[i]))) as Vec3,
      });
    }
    // Structure or a prop (the header): by the object's sides, longest
    // first; how tall it stands as turned; and how far its copies reach.
    const sides = [sx, sy, sz].sort((a, b) => b - a);
    const standing = copies[0].max[1] - copies[0].min[1];
    const reach = Math.max(...[0, 1, 2].map((i) => Math.max(...copies.map((c) => c.max[i])) - Math.min(...copies.map((c) => c.min[i]))));
    const prop =
      o.shape !== "plane" &&
      sides[0] <= LOOK_PROP_MAX_M &&
      sides[1] < LOOK_SLAB_MIN_M &&
      standing < LOOK_TALL_SHARE * bounds.height &&
      reach <= LOOK_GROUP_MAX_M;
    for (const c of copies) out.push({ ...c, prop });
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
 * Where the person may be in a still drawn from `camera`: the grey figure's
 * box on screen — its footprint LOOK_FIGURE_HALF_M each way, ground to head —
 * grown by LOOK_FIGURE_GROW of its height there plus LOOK_GROW_FRAME on every
 * side, inside the frame (`grown`), and the figure's own box grown only by
 * LOOK_GROW_FRAME (`tight`, the second pass's). Null when the sketch did not
 * show the figure: none of it in frame, part of it behind the lens, or
 * neither its middle nor its head to be seen past structure.
 */
function personRegion(
  camera: ShotCamera,
  project: ReturnType<typeof sketchProjector>,
  structure: readonly Placed[],
): { grown: FrameBox; tight: FrameBox } | null {
  const { x, z } = camera.figure;
  const seen: { u: number; v: number }[] = [];
  for (const dx of [-LOOK_FIGURE_HALF_M, LOOK_FIGURE_HALF_M]) {
    for (const dz of [-LOOK_FIGURE_HALF_M, LOOK_FIGURE_HALF_M]) {
      for (const y of [0, STAND_IN_HEIGHT_M]) {
        const s = project([x + dx, y, z + dz]);
        if (!s) return null;
        seen.push(s);
      }
    }
  }
  const figure: FrameBox = {
    u0: Math.min(...seen.map((s) => s.u)),
    v0: Math.min(...seen.map((s) => s.v)),
    u1: Math.max(...seen.map((s) => s.u)),
    v1: Math.max(...seen.map((s) => s.v)),
  };
  if (!clip(figure)) return null;
  if (FIGURE_SEEN_AT_M.every((y) => structure.some((s) => entersOnTheWay(camera.position, [x, y, z], s)))) return null;
  const height = figure.v1 - figure.v0;
  const grow = LOOK_FIGURE_GROW * height + LOOK_GROW_FRAME;
  const up = LOOK_FIGURE_GROW_UP * height + LOOK_GROW_FRAME;
  const grown = clip({ u0: figure.u0 - grow, v0: figure.v0 - up, u1: figure.u1 + grow, v1: figure.v1 + grow });
  // The figure's own box, for the second pass (the header).
  const tight = clip({ u0: figure.u0 - LOOK_GROW_FRAME, v0: figure.v0 - LOOK_GROW_FRAME, u1: figure.u1 + LOOK_GROW_FRAME, v1: figure.v1 + LOOK_GROW_FRAME });
  return grown && tight ? { grown, tight } : null;
}

/**
 * A box cut back to what lies clear of the person's region: itself when the
 * two do not meet; else its largest part to the left, right, above or below
 * the region, when that keeps at least LOOK_FIGURE_MIN_LEFT of it; else null.
 */
function clearOf(b: FrameBox, person: FrameBox): FrameBox | null {
  if (b.u1 <= person.u0 || person.u1 <= b.u0 || b.v1 <= person.v0 || person.v1 <= b.v0) return b;
  let best: FrameBox | null = null;
  for (const part of [
    { ...b, u1: Math.min(b.u1, person.u0) },
    { ...b, u0: Math.max(b.u0, person.u1) },
    { ...b, v1: Math.min(b.v1, person.v0) },
    { ...b, v0: Math.max(b.v0, person.v1) },
  ]) {
    if (part.u1 > part.u0 && part.v1 > part.v0 && (!best || area(part) > area(best))) best = part;
  }
  return best && area(best) >= LOOK_FIGURE_MIN_LEFT * area(b) ? best : null;
}

/**
 * Where a prop's copy shows in the sketch: its box there, clipped to the
 * frame — or null when the camera could not see it: reaching behind the
 * lens (the camera stands in it or beside it), its centre behind structure
 * — a wall, a grandstand, a plane — as the stage would draw it, or none of
 * it inside the frame. (A shape half hidden counts by its centre; props
 * hiding props are left to SAM 2, which cuts the nearer one, itself an
 * object.)
 */
function shownBox(p: Placed, camera: ShotCamera, project: ReturnType<typeof sketchProjector>, structure: readonly Placed[]): FrameBox | null {
  const seen = p.corners.map(project);
  if (seen.some((s) => s === null)) return null;
  if (structure.some((s) => entersOnTheWay(camera.position, p.centre, s))) return null;
  const us = seen.map((s) => s!.u);
  const vs = seen.map((s) => s!.v);
  return clip({ u0: Math.min(...us), v0: Math.min(...vs), u1: Math.max(...us), v1: Math.max(...vs) });
}

function clip(b: FrameBox): FrameBox | null {
  const c = { u0: clamp(b.u0, 0, 1), v0: clamp(b.v0, 0, 1), u1: clamp(b.u1, 0, 1), v1: clamp(b.v1, 0, 1) };
  return c.u1 > c.u0 && c.v1 > c.v0 ? c : null;
}

const area = (b: FrameBox) => (b.u1 - b.u0) * (b.v1 - b.v0);

const touch = (a: Placed, b: Placed) =>
  [0, 1, 2].every((i) => a.min[i] - LOOK_TOUCH_M <= b.max[i] && b.min[i] - LOOK_TOUCH_M <= a.max[i]);

/** Props that touch, directly or through each other, as one object each. */
function objectsOf(props: Placed[]): Placed[][] {
  const parent = props.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let i = 0; i < props.length; i++) {
    for (let j = i + 1; j < props.length; j++) {
      if (touch(props[i], props[j])) parent[root(i)] = root(j);
    }
  }
  const groups = new Map<number, Placed[]>();
  props.forEach((p, i) => {
    const r = root(i);
    groups.set(r, [...(groups.get(r) ?? []), p]);
  });
  return [...groups.values()];
}

/**
 * The cuts to ask SAM 2 for — one an object, a box and a point each — to
 * take the look's objects out of an earlier still of `width` × `height`
 * pixels, drawn from `camera` (see the header); the objects they are; and
 * the person's region, which is never part of the cutout. No cuts when no
 * object qualifies clear of the person — the camera looked at bare
 * structure or sky, or the figure stood in front of everything — or when
 * the sketch did not show the figure; then there is nothing to cut, and the
 * shot goes without its look.
 */
export function lookCuts(
  spec: LookSet,
  camera: ShotCamera,
  still: { width: number; height: number },
  // Where the still's people were found in it (look-people.ts), on top of
  // where the sketch's figure stood: every one is cleared.
  found: readonly FrameBox[] = [],
): { cuts: LookCut[]; objects: LookObject[]; people: FrameBox[]; pass: 1 | 2 } {
  return cutsFor(spec, camera, still, found, false);
}

/** A person the reader found, grown by LOOK_FOUND_GROW of their own height on every side (the second pass). */
function grownFound(b: FrameBox): FrameBox | null {
  const g = LOOK_FOUND_GROW * (b.v1 - b.v0);
  return clip({ u0: b.u0 - g, v0: b.v0 - g, u1: b.u1 + g, v1: b.v1 + g });
}

const meets = (a: FrameBox, b: FrameBox) => a.u0 < b.u1 && b.u0 < a.u1 && a.v0 < b.v1 && b.v0 < a.v1;

/**
 * lookCuts, and the page's prediction of it (seesLookObjects: `predict`,
 * with the figure's own box standing in for the person the reader will
 * find). The first pass clears the figure's grown region and every person
 * found; only when it leaves nothing, and the reader found someone where the
 * figure says one is, the second pass clears the figure's own box and every
 * person found, grown (the header). `people` is always the regions the cuts
 * were made clear of, which look-cutout-image.ts then clears.
 */
function cutsFor(
  spec: LookSet,
  camera: ShotCamera,
  still: { width: number; height: number },
  found: readonly FrameBox[],
  predict: boolean,
): { cuts: LookCut[]; objects: LookObject[]; people: FrameBox[]; pass: 1 | 2 } {
  const none = { cuts: [], objects: [], people: [], pass: 1 as const };
  if (!finite(still.width) || !finite(still.height) || still.width < 1 || still.height < 1) return none;
  const cam = normaliseShotCamera(camera);
  if (!cam) return none;
  const project = sketchProjector(cam);
  const copies = placedCopies(spec.objects, spec.bounds);
  const structure = copies.filter((p) => !p.prop);
  const figure = personRegion(cam, project, structure);
  if (!figure) return none;
  const seen = predict ? [figure.tight] : found.map((b) => clip(b)).filter((b): b is FrameBox => b !== null);
  const first = { ...cutsClearOf(cam, project, copies, structure, still, [figure.grown, ...seen]), pass: 1 as const };
  if (first.cuts.length > 0 || seen.length === 0 || seen.length >= LOOK_FOUND_CROWD || !seen.some((b) => meets(b, figure.grown))) return first;
  const second = cutsClearOf(cam, project, copies, structure, still, [
    figure.tight,
    ...seen.map(grownFound).filter((b): b is FrameBox => b !== null),
  ]);
  // Only a second pass that finds something replaces the first.
  return second.cuts.length > 0 ? { ...second, pass: 2 as const } : first;
}

/** The cuts clear of every one of `people`, the regions of one pass. */
function cutsClearOf(
  cam: ShotCamera,
  project: ReturnType<typeof sketchProjector>,
  copies: readonly Placed[],
  structure: readonly Placed[],
  still: { width: number; height: number },
  people: FrameBox[],
): { cuts: LookCut[]; objects: LookObject[]; people: FrameBox[] } {
  // Clear of every region in turn: what is left of a box after the first is
  // what the second cuts back, and so on.
  const clearOfAll = (b: FrameBox): FrameBox | null => people.reduce<FrameBox | null>((left, region) => (left ? clearOf(left, region) : null), b);

  // The objects, from the set alone; then what of each the sketch showed.
  const kept = objectsOf(copies.filter((p) => p.prop))
    .filter((group) =>
      [0, 1, 2].every((i) => Math.max(...group.map((p) => p.max[i])) - Math.min(...group.map((p) => p.min[i])) <= LOOK_GROUP_MAX_M),
    )
    .map((group) => {
      const shown: Shown[] = [];
      for (const p of group) {
        const box = shownBox(p, cam, project, structure);
        if (box) shown.push({ object: p.object, copy: p.copy, box });
      }
      if (shown.length === 0) return null;
      const box: FrameBox = {
        u0: Math.min(...shown.map((s) => s.box.u0)),
        v0: Math.min(...shown.map((s) => s.box.v0)),
        u1: Math.max(...shown.map((s) => s.box.u1)),
        v1: Math.max(...shown.map((s) => s.box.v1)),
      };
      return { box, share: area(box), shapes: shown };
    })
    // An object a person mostly stands in front of, or in (a chair, a
    // counter they lean on), is theirs in the still, not the look's.
    .filter((g): g is NonNullable<typeof g> => g !== null && g.share >= LOOK_MIN_SHARE && clearOfAll(g.box) !== null)
    .sort((a, b) => b.share - a.share)
    .slice(0, LOOK_MAX_GROUPS);

  // Onto the still's own pixels, each axis on its own; whole pixels inside it.
  const px = (t: number, size: number, round: (n: number) => number) => clamp(round(t * size), 0, size - 1);
  const cuts: LookCut[] = [];
  const objects: LookObject[] = [];
  for (const g of kept) {
    const growU = LOOK_GROW_SHARE * (g.box.u1 - g.box.u0) + LOOK_GROW_FRAME;
    const growV = LOOK_GROW_SHARE * (g.box.v1 - g.box.v0) + LOOK_GROW_FRAME;
    const grown = clip({ u0: g.box.u0 - growU, v0: g.box.v0 - growV, u1: g.box.u1 + growU, v1: g.box.v1 + growV })!;
    // Never a box into anyone's region: SAM 2 would cut them out with it.
    const box = clearOfAll(grown);
    if (!box) continue;
    // The point (the header): the middle of the object on screen when a
    // part lies there; else the middle of the box as cut back, when a part
    // lies there; else the centre of the largest part that shows, then of
    // the next largest — always inside the box as cut back. Largest first;
    // between equals, the spec's order — so the pick is the same for the
    // same set.
    const bySize = [...g.shapes].sort((a, b) => area(b.box) - area(a.box) || a.object - b.object || a.copy - b.copy);
    const inside = (u: number, v: number, b: FrameBox) => u > b.u0 && u < b.u1 && v > b.v0 && v < b.v1;
    const middleOf = (b: FrameBox) => {
      const u = (b.u0 + b.u1) / 2;
      const v = (b.v0 + b.v1) / 2;
      const s = bySize.find((part) => inside(u, v, part.box));
      return s ? [{ s, u, v }] : [];
    };
    const on = [
      ...middleOf(g.box),
      ...middleOf(box),
      ...bySize.map((s) => ({ s, u: (s.box.u0 + s.box.u1) / 2, v: (s.box.v0 + s.box.v1) / 2 })),
    ].find(({ u, v }) => inside(u, v, box));
    if (!on) continue;
    cuts.push({
      box: {
        x_min: px(box.u0, still.width, Math.floor),
        y_min: px(box.v0, still.height, Math.floor),
        x_max: px(box.u1, still.width, Math.ceil),
        y_max: px(box.v1, still.height, Math.ceil),
      },
      point: { x: px(on.u, still.width, Math.round), y: px(on.v, still.height, Math.round) },
      object: on.s.object,
      copy: on.s.copy,
    });
    objects.push({ box: g.box, share: g.share, shapes: g.shapes.length });
  }
  return { cuts, objects, people };
}

/**
 * Whether a still drawn from `camera` can lend its look: its figure showed
 * and at least one object would be cut. The set page offers only such
 * stills, and a new still is one only when this holds (look.ts canBeLook).
 * The cuts are chosen in the sketch's square and only then scaled to the
 * still, so any still size gives the same answer. Framed head to feet, it
 * answers for the second pass too (the header), with the figure's own box
 * standing in for the person the reader will find: a prediction, which the
 * cut itself can still refuse.
 */
export function seesLookObjects(spec: LookSet, camera: ShotCamera): boolean {
  return cutsFor(spec, camera, ANY_STILL, [], true).cuts.length > 0;
}
