// Fixing a thing in a set (2026-09-25, operator: "My latest generation in
// Helios made the car upside down. Can you fix it so its standing on its
// wheels?" — the Producer answered that it couldn't edit sets; then "The
// assistant should be able to fix these things and know how to do them").
// Pure: a set in, a set out. The Producer's tools (lib/producer/set-tools.ts)
// save the result through the Build editor's own save, so its checks hold.
//
// A THING is what the set page calls "Car", "Car 2", "Object 3": touching
// blocks grouped by elements.ts. It moves, turns and stands as ONE — every
// block turned about the thing's own centre, the step between a repeated
// block's copies turned with it — where Build can only turn one block at a
// time.
//
// UPRIGHT: a car stands on its wheels when its tyres sit below its body. One
// that doesn't is rolled half a turn about its own length (so it still faces
// the way it did) and set down on the floor.

import { canMove } from "./movers";
import { rotationXYZ } from "./marks";
import { placedCopies } from "./look-cutout";
import { isTyre } from "./vehicles";
import { setElements, setParts, thingLabelText, thingLabels, type SetElement, type ThingWords } from "./elements";
import type { ColourId } from "./colour-words";
import { sideOf } from "./people";
import type { SetObject, SetSpec, Vec3 } from "./set-spec";

const DEG = Math.PI / 180;
type M = number[][];
export type Axis = "x" | "y" | "z";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Its kind and number as the set page says them in English: "Car" alone,
 * "Car 2" among several. What an unnamed thing is called, and on a named
 * set an alias Aly may still pass (critic item 15a).
 */
export function thingName(el: SetElement, all: readonly SetElement[]): string {
  const label = el.kind === "car" ? "Car" : el.kind === "vehicle" ? "Vehicle" : "Object";
  return all.filter((e) => e.kind === el.kind).length > 1 ? `${label} ${el.ordinal}` : label;
}

/** The page's words for a thing, in English: what Aly reads (the one naming rule, elements.ts thingLabelText). */
const EN_THING_WORDS: ThingWords = { car: "Car", carN: "Car {n}", vehicle: "Vehicle", vehicleN: "Vehicle {n}", object: "Object", objectN: "Object {n}", namedN: "{name} {n}" };

/** Whether it stands on its wheels: tyres below its body. Unknown for things without tyres. */
export function uprightOf(spec: Pick<SetSpec, "objects" | "bounds">, el: SetElement): "upright" | "upside_down" | "unknown" {
  if (el.tyres < 3) return "unknown";
  const placed = placedCopies(spec.objects, spec.bounds);
  const at = new Map(placed.map((p) => [`${p.object}:${p.copy}`, p]));
  const tyreY: number[] = [];
  const bodyY: number[] = [];
  for (const [o, c] of el.members) {
    const p = at.get(`${o}:${c}`);
    if (!p) continue;
    (isTyre(spec.objects[o]) ? tyreY : bodyY).push(p.centre[1]);
  }
  if (tyreY.length < 3 || bodyY.length === 0) return "unknown";
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  return mean(tyreY) > mean(bodyY) ? "upside_down" : "upright";
}

export type ThingInfo = {
  key: string;
  /** What the set page calls it (Helios Cut 4, step B2): its name when the set gives it one ("Red sports car"), else "Car", "Car 2". */
  name: string;
  /** Its kind and number, "Car 2" (thingName): the same as `name` on a set without names, an alias Aly may pass on one with them. */
  alias: string;
  kind: SetElement["kind"];
  /** Its largest block's colour word (colour-words.ts). */
  colour: ColourId;
  /** Which way it lies from the figure where it stands (people.ts sideOf). */
  side: "ahead" | "left" | "right" | "behind";
  /** Its middle, metres (x across, y up, z along). */
  centre: Vec3;
  /** Its extent along x, y and z, metres. */
  size: Vec3;
  /** How high its lowest point is (0 = on the floor). */
  lowest: number;
  upright: "upright" | "upside_down" | "unknown";
  blocks: number;
  /** Every copy of every block it is made of is its own: it can be turned and moved as one. */
  fixable: boolean;
};

/**
 * The set's things, as the Producer reads them: named as the set page names
 * them, with their colour and where each lies from the figure — at `mark`,
 * where the person left it, else the set's first mark.
 */
export function describeThings(spec: SetSpec, mark?: { x: number; z: number; facingDeg: number }): ThingInfo[] {
  const els = setElements(spec);
  const labels = thingLabels(spec, els);
  const from = mark ?? spec.marks[0];
  return els.map((el, i) => ({
    key: el.key,
    name: thingLabelText(labels[i], EN_THING_WORDS),
    alias: thingName(el, els),
    kind: el.kind,
    colour: labels[i].colour,
    side: sideOf(from, { x: el.centre[0], z: el.centre[2] }),
    centre: el.centre,
    size: [0, 1, 2].map((i) => r3(el.max[i] - el.min[i])) as Vec3,
    lowest: r3(el.min[1]),
    upright: uprightOf(spec, el),
    blocks: el.members.length,
    fixable: canMove(el, spec),
  }));
}

/** The set's named parts, as the Producer reads them: the set itself, which can't be moved (elements.ts setParts). */
export function describeParts(spec: SetSpec): string[] {
  return setParts(spec, setElements(spec)).map((p) => p.name);
}

/**
 * A thing by what Aly passes (Helios Cut 4, step B2): its key; else the
 * name the set page shows for it, exactly (case aside: "Red sports car",
 * "Red sports car 2"); else its kind and number, "Car 2", kept as an alias
 * on a named set (critic item 15a); else its kind when it is the only one.
 * Never a colour or a kind picked out of free words (critic item 15b): Aly
 * reads each thing's colour and side in read_set and passes its key.
 */
export function findThing(spec: SetSpec, ref: string): SetElement | null {
  const els = setElements(spec);
  const byKey = els.find((e) => e.key === ref.trim());
  if (byKey) return byKey;
  const labels = thingLabels(spec, els);
  const said = ref.trim().toLowerCase();
  const shown = els.filter((_, i) => thingLabelText(labels[i], EN_THING_WORDS).toLowerCase() === said);
  if (shown.length === 1) return shown[0];
  const want = said.replace(/^the\s+/, "");
  const byName = els.find((e) => thingName(e, els).toLowerCase() === want);
  if (byName) return byName;
  const kind = want.replace(/\s*\d+$/, "");
  const ofKind = els.filter((e) => e.kind === kind);
  return ofKind.length === 1 ? ofKind[0] : null;
}

function axisMatrix(axis: Axis, deg: number): M {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  if (axis === "x") return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === "y") return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}
function mul(a: M, b: M): M {
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
}
function apply(m: M, v: Vec3): Vec3 {
  return [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as Vec3;
}
/** A rotation matrix back to three's XYZ euler, degrees (Euler.setFromRotationMatrix). */
function eulerXYZ(m: M): Vec3 {
  const clamp = (v: number) => Math.min(1, Math.max(-1, v));
  const y = Math.asin(clamp(m[0][2]));
  const near = Math.abs(m[0][2]) < 0.9999999;
  const x = near ? Math.atan2(-m[1][2], m[2][2]) : Math.atan2(m[2][1], m[1][1]);
  const z = near ? Math.atan2(-m[0][1], m[0][0]) : 0;
  const deg = (v: number) => {
    const d = ((v / DEG) % 360 + 360) % 360;
    return Math.round(d * 100) / 100;
  };
  return [deg(x), deg(y), deg(z)];
}

export type FixResult = { ok: true; spec: SetSpec; done: string } | { ok: false; why: string };

const NOT_ITS_OWN =
  "part of it is one of a row of repeated blocks that other things share, so it can't be turned or moved on its own; turn it block by block in Build";

/** Every block of the thing turned by `deg` about a world axis through the thing's centre. */
export function turnThing(spec: SetSpec, el: SetElement, axis: Axis, deg: number): FixResult {
  if (!canMove(el, spec)) return { ok: false, why: NOT_ITS_OWN };
  const R = axisMatrix(axis, deg);
  const c = el.centre;
  const objects = spec.objects.slice();
  for (const oi of new Set(el.members.map(([o]) => o))) {
    const o = objects[oi];
    const rel: Vec3 = [o.position[0] - c[0], o.position[1] - c[1], o.position[2] - c[2]];
    const turned = apply(R, rel);
    const own = rotationXYZ(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG);
    const next: SetObject = {
      ...o,
      position: [r3(c[0] + turned[0]), r3(c[1] + turned[1]), r3(c[2] + turned[2])],
      rotation: eulerXYZ(mul(R, own)),
    };
    if (o.repeat) next.repeat = { ...o.repeat, offset: apply(R, o.repeat.offset).map(r3) as Vec3 };
    objects[oi] = next;
  }
  return { ok: true, spec: { ...spec, objects }, done: `turned ${deg}° about ${axis.toUpperCase()}` };
}

/** Every block moved by (dx, dy, dz) metres. */
export function moveThing(spec: SetSpec, el: SetElement, by: Vec3): FixResult {
  if (!canMove(el, spec)) return { ok: false, why: NOT_ITS_OWN };
  const objects = spec.objects.slice();
  for (const oi of new Set(el.members.map(([o]) => o))) {
    const o = objects[oi];
    objects[oi] = { ...o, position: [r3(o.position[0] + by[0]), r3(o.position[1] + by[1]), r3(o.position[2] + by[2])] };
  }
  return { ok: true, spec: { ...spec, objects }, done: `moved ${by.map((v) => `${v >= 0 ? "+" : ""}${r3(v)}`).join(", ")} m` };
}

/** Its lowest point on the floor (as turned: a tilted block's corner, not half its height). */
export function dropToFloor(spec: SetSpec, el: SetElement): FixResult {
  const placed = placedCopies(spec.objects, spec.bounds);
  const mine = new Set(el.members.map(([o, c]) => `${o}:${c}`));
  const lows = placed.filter((p) => mine.has(`${p.object}:${p.copy}`)).map((p) => p.min[1]);
  if (lows.length === 0) return { ok: false, why: "it has no blocks" };
  const lowest = Math.min(...lows);
  if (Math.abs(lowest) < 0.005) return { ok: true, spec, done: "already on the floor" };
  const moved = moveThing(spec, el, [0, -lowest, 0]);
  return moved.ok ? { ...moved, done: `set down on the floor (it was ${lowest > 0 ? `${r3(lowest)} m above` : `${r3(-lowest)} m below`} it)` } : moved;
}

/** Back on its wheels, facing the same way, standing on the floor. */
export function uprightThing(spec: SetSpec, el: SetElement): FixResult {
  const state = uprightOf(spec, el);
  if (state === "unknown") return { ok: false, why: "it has no wheels to stand on, so which way is up can't be told from its blocks; say which way to turn it" };
  if (state === "upright") {
    const d = dropToFloor(spec, el);
    return d.ok ? { ...d, done: d.done === "already on the floor" ? "already standing on its wheels" : `already on its wheels; ${d.done}` } : d;
  }
  // Half a turn about its own length keeps the way it faces.
  const along: Axis = el.max[0] - el.min[0] >= el.max[2] - el.min[2] ? "x" : "z";
  const rolled = turnThing(spec, el, along, 180);
  if (!rolled.ok) return rolled;
  const again = setElements(rolled.spec).find((e) => e.fingerprint === el.fingerprint && Math.abs(e.centre[0] - el.centre[0]) < 0.05 && Math.abs(e.centre[2] - el.centre[2]) < 0.05);
  if (!again) return { ok: false, why: "it came apart when turned" };
  const down = dropToFloor(rolled.spec, again);
  if (!down.ok) return down;
  return { ok: true, spec: down.spec, done: `turned back onto its wheels (half a turn about its length) and ${down.done === "already on the floor" ? "left on the floor" : down.done}` };
}
