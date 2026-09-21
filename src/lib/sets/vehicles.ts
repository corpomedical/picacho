// Which way a vehicle faces (2026-09-21, "the vehicle still does not know
// which is the front and the back"). A set's car is a bag of blocks with no
// name and no front; the shot prompt only asked the image model to keep
// each block's orientation, and a block car does not say which end is its
// nose. Worse, Astra builds glass and bonnets as flat plates tilted the
// wrong way round (the race track's windscreen and bonnet, and both
// showroom cars' glass, lean like a car facing backwards), so the model
// read the tail as the nose.
//
// The set's own geometry does say it, though: Astra puts glowing white
// headlights at a car's front and red tail lights at its back, and a race
// car's wing sits over its tail. This finds each vehicle by its tyres,
// reads its front from those lights (the wing when there are none), and
// says it in the camera's terms, the way the figure's facing is said
// (set-shot-prompt.ts describeFacing). When the lights and the wing
// disagree, or there is nothing to read, it says nothing: a wrong
// sentence is worse than none.
//
// Pure. Relative imports only: tested as it is.

import type { SetObject, SetSpec, Vec3 } from "./set-spec";

const DEG = Math.PI / 180;

export type Vehicle = {
  /** "car" for a four-wheeler of a car's length; "vehicle" otherwise. */
  label: "car" | "vehicle";
  /** The middle of its tyres, on the ground. */
  x: number;
  z: number;
  /** Which way its front faces around +Y, degrees: 0 faces +Z, 90 faces +X (the marks' own rule). */
  frontDeg: number;
  /** Half its length along the way it faces, metres. */
  halfLength: number;
  /** What on it marks its ends, as the geometry has them: the words name only these. */
  cues: { headlights: boolean; tailLights: boolean; wing: boolean };
};

/** The axis a cylinder of this rotation runs along (three.js Euler XYZ, as build-scene.ts draws it). */
function cylinderAxis(rotation: Vec3): Vec3 {
  const [a, b, c] = rotation.map((d) => d * DEG);
  // R = Rx(a) · Ry(b) · Rz(c) applied to +Y.
  const x = -Math.sin(c) * Math.cos(b);
  const y = Math.cos(c) * Math.cos(a) - Math.sin(c) * Math.sin(b) * Math.sin(a);
  const z = Math.cos(c) * Math.sin(a) + Math.sin(c) * Math.sin(b) * Math.cos(a);
  return [x, y, z];
}

/** Every copy of an object, where its repeat puts it. */
function copies(o: SetObject): Vec3[] {
  const n = o.repeat ? Math.max(1, o.repeat.count) : 1;
  const off = o.repeat?.offset ?? [0, 0, 0];
  return Array.from({ length: n }, (_, i) => [o.position[0] + off[0] * i, o.position[1] + off[1] * i, o.position[2] + off[2] * i] as Vec3);
}

function rgb(hex: string | null): [number, number, number] | null {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}

/** A tyre: a dark cylinder of a wheel's size, lying on its side. The thin bright discs over it (hubcaps) are not tyres. */
export function isTyre(o: SetObject): boolean {
  if (o.shape !== "cylinder") return false;
  const diameter = Math.max(o.size[0], o.size[2]);
  const thickness = o.size[1];
  if (diameter < 0.4 || diameter > 1.6 || thickness < 0.12 || thickness > 0.7) return false;
  const axis = cylinderAxis(o.rotation);
  if (Math.abs(axis[1]) > 0.35) return false; // standing up: a post or a drum, not a wheel
  const c = rgb(o.color);
  const dark = c ? 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] < 0.3 : false;
  return dark || o.material === "rubber";
}

type Light = { kind: "head" | "tail"; at: Vec3 };

/** A glowing thing small enough to be a lamp on a vehicle, and which kind of lamp its colour makes it. */
function lampOf(o: SetObject): Light["kind"] | null {
  if (!o.emissive) return null;
  if (Math.max(o.size[0], o.size[1], o.size[2]) > 2.2 || o.position[1] > 2.2) return null;
  const c = rgb(o.emissive);
  if (!c) return null;
  const [r, g, b] = c;
  if (r >= 0.5 && r > 1.6 * g && r > 1.6 * b) return "tail";
  if (Math.min(r, g, b) >= 0.55 || (r >= 0.8 && g >= 0.6 && b >= 0.25)) return "head";
  return null;
}

/**
 * The vehicles in a set: each by its tyres (three or more, within a car's
 * reach of each other), with its front read from its lamps, else from a
 * wing over one end. A vehicle whose front cannot be read is left out.
 */
export function findVehicles(spec: Pick<SetSpec, "objects">): Vehicle[] {
  const tyres: { at: Vec3; axle: [number, number] }[] = [];
  const lamps: Light[] = [];
  const flats: { o: SetObject; at: Vec3 }[] = [];
  for (const o of spec.objects) {
    if (isTyre(o)) {
      const axis = cylinderAxis(o.rotation);
      const len = Math.hypot(axis[0], axis[2]) || 1;
      for (const at of copies(o)) tyres.push({ at, axle: [axis[0] / len, axis[2] / len] });
      continue;
    }
    const lamp = lampOf(o);
    if (lamp) for (const at of copies(o)) lamps.push({ kind: lamp, at });
    // A wing: thin, wide, shallow but with some depth, high and nearly level
    // — a flat blade over the body. Sloped glass (a rear window) is none, it
    // lies at 30°+; nor is a lamp bar, which glows and has no depth.
    if (
      o.shape === "box" &&
      !o.emissive &&
      o.size[1] <= 0.2 &&
      Math.min(o.size[0], o.size[2]) >= 0.25 &&
      Math.max(o.size[0], o.size[2]) >= 1.4 &&
      Math.min(o.size[0], o.size[2]) <= 0.8 &&
      Math.abs(o.rotation[0]) <= 15 &&
      Math.abs(o.rotation[2]) <= 15 &&
      o.position[1] >= 1.0 &&
      o.position[1] <= 2.2
    ) {
      for (const at of copies(o)) flats.push({ o, at });
    }
  }
  // Tyres a car's length apart belong together.
  const groups: (typeof tyres)[] = [];
  for (const t of tyres) {
    const g = groups.find((grp) => grp.some((u) => Math.hypot(u.at[0] - t.at[0], u.at[2] - t.at[2]) <= 4.5));
    if (g) g.push(t);
    else groups.push([t]);
  }
  const out: Vehicle[] = [];
  for (const g of groups) {
    if (g.length < 3) continue;
    const cx = g.reduce((s, t) => s + t.at[0], 0) / g.length;
    const cz = g.reduce((s, t) => s + t.at[2], 0) / g.length;
    // The axle is the tyres' own axis; the vehicle runs across it.
    const [ax, az] = g[0].axle;
    const hx = -az;
    const hz = ax;
    const along = (p: Vec3) => (p[0] - cx) * hx + (p[2] - cz) * hz;
    const across = (p: Vec3) => (p[0] - cx) * ax + (p[2] - cz) * az;
    const halfLength = Math.max(...g.map((t) => Math.abs(along(t.at)))) + 0.6;
    const halfWidth = Math.max(...g.map((t) => Math.abs(across(t.at)))) + 0.4;
    const inside = (p: Vec3) => Math.abs(along(p)) <= halfLength + 0.6 && Math.abs(across(p)) <= halfWidth + 0.4;
    const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
    const heads = lamps.filter((l) => l.kind === "head" && inside(l.at)).map((l) => along(l.at));
    const tails = lamps.filter((l) => l.kind === "tail" && inside(l.at)).map((l) => along(l.at));
    const far = (v: number, share: number) => Math.abs(v) >= share * halfLength;
    let sign: 1 | -1 | null = null;
    const h = mean(heads);
    const t = mean(tails);
    if (heads.length && tails.length) {
      if (Math.sign(h) !== Math.sign(t) && far(h, 0.25) && far(t, 0.25)) sign = h > 0 ? 1 : -1;
    } else if (heads.length) {
      if (far(h, 0.35)) sign = h > 0 ? 1 : -1;
    } else if (tails.length) {
      if (far(t, 0.35)) sign = t > 0 ? -1 : 1;
    }
    // A wing over one end is the back: the only reading with no lamps, and a
    // check on the lamps when there are some.
    const wings = flats.filter((f) => inside(f.at) && far(along(f.at), 0.5)).map((f) => along(f.at));
    const wingSign: 1 | -1 | null = wings.length ? (mean(wings) > 0 ? -1 : 1) : null;
    if (sign === null) sign = wingSign;
    else if (wingSign !== null && wingSign !== sign) continue; // they disagree: say nothing
    if (sign === null) continue;
    const fx = hx * sign;
    const fz = hz * sign;
    const frontDeg = Math.round(((((Math.atan2(fx, fz) / DEG) % 360) + 360) % 360) * 10) / 10;
    out.push({
      label: g.length >= 4 && halfLength * 2 >= 2.5 && halfLength * 2 <= 6.5 ? "car" : "vehicle",
      x: Math.round(cx * 100) / 100,
      z: Math.round(cz * 100) / 100,
      frontDeg,
      halfLength: Math.round(halfLength * 100) / 100,
      cues: { headlights: heads.length > 0, tailLights: tails.length > 0, wing: wingSign !== null },
    });
  }
  return out;
}

type Camera = { position: Vec3; target: Vec3; fovDeg: number };

// Every phrase the sentence is built from, in one place: the builder below
// and the strip's anchored pattern (VEHICLE_SENTENCE) read the same words.
const POSE = {
  headOn: "faces the camera head-on: we see its front",
  away: "faces straight away from the camera: we see its back",
  towardQuarter: "is turned three-quarters toward the camera, its front toward frame ",
  sideOn: "is side-on to the camera, its front pointing to frame ",
  awayQuarter: "is turned three-quarters away from the camera, its front toward frame ",
} as const;
const BACK = { wing: "the rear wing", tailLights: "the red tail lights" } as const;
const WITH_HEADLIGHTS = "its front is the end with the white headlights";
const BACK_JOIN = ", its back the end with ";
const FRONT_OPPOSITE = "its front is the end opposite ";

/** How a vehicle is turned as this camera sees it, like a figure's facing (describeFacing). */
export function describeVehicle(v: Vehicle, camera: Camera): string | null {
  const toCamX = camera.position[0] - v.x;
  const toCamZ = camera.position[2] - v.z;
  const toCamLen = Math.hypot(toCamX, toCamZ);
  if (toCamLen < 0.5) return null;
  const fx = Math.sin(v.frontDeg * DEG);
  const fz = Math.cos(v.frontDeg * DEG);
  const angle = Math.acos(Math.max(-1, Math.min(1, (fx * toCamX + fz * toCamZ) / toCamLen))) / DEG;
  if (angle < 25) return POSE.headOn;
  if (angle >= 155) return POSE.away;
  let viewX = camera.target[0] - camera.position[0];
  let viewZ = camera.target[2] - camera.position[2];
  if (Math.hypot(viewX, viewZ) < 1e-6) {
    viewX = -toCamX;
    viewZ = -toCamZ;
  }
  const side = fx * -viewZ + fz * viewX > 0 ? "right" : "left";
  if (angle < 65) return `${POSE.towardQuarter}${side}`;
  if (angle < 115) return `${POSE.sideOn}${side}`;
  return `${POSE.awayQuarter}${side}`;
}

/** Whether a point is in front of the camera and near enough its view to be in the frame (the widest format, with room). */
function inView(v: Vehicle, camera: Camera): boolean {
  const dx = v.x - camera.position[0];
  const dz = v.z - camera.position[2];
  let viewX = camera.target[0] - camera.position[0];
  let viewZ = camera.target[2] - camera.position[2];
  const vl = Math.hypot(viewX, viewZ);
  const dl = Math.hypot(dx, dz);
  if (dl < 0.5) return true;
  if (vl < 1e-6) return true;
  viewX /= vl;
  viewZ /= vl;
  const cos = (dx * viewX + dz * viewZ) / dl;
  // Half the widest frame's horizontal view (Scope's 2.39 : 1 over the pose's vertical view), plus the car's own width.
  const half = Math.atan(Math.tan((camera.fovDeg * DEG) / 2) * 2.39) + Math.atan(v.halfLength / dl);
  return cos >= Math.cos(Math.min(Math.PI / 2, half));
}

/** The sentence's fixed ending: whoever reads the scaffold strips it by this (set-shot-prompt.ts). */
export const VEHICLE_SENTENCE_END = "Draw it facing exactly that way.";

/**
 * Each vehicle in this camera's frame (the nearest two), in the camera's
 * terms, and what marks its front and back — the words the image model is
 * given so it cannot draw the car the wrong way round.
 */
export function vehicleWords(spec: Pick<SetSpec, "objects">, camera: Camera | null | undefined): string[] {
  if (!camera) return [];
  return findVehicles(spec)
    .filter((v) => inView(v, camera))
    .sort((a, b) => Math.hypot(a.x - camera.position[0], a.z - camera.position[2]) - Math.hypot(b.x - camera.position[0], b.z - camera.position[2]))
    .slice(0, 2)
    .flatMap((v) => {
      const pose = describeVehicle(v, camera);
      if (!pose) return [];
      // Only what the blocks show is named: the lamps, else the wing.
      const back = v.cues.wing ? BACK.wing : v.cues.tailLights ? BACK.tailLights : null;
      const ends = v.cues.headlights ? `${WITH_HEADLIGHTS}${back ? `${BACK_JOIN}${back}` : ""}` : `${FRONT_OPPOSITE}${back}`;
      return [`The ${v.label} in the sketch ${pose}; ${ends}. ${VEHICLE_SENTENCE_END}`];
    });
}

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Every sentence vehicleWords can write, anchored to its whole form — the
 * way the strip's other Picacho sentences are (set-shot-prompt.ts): the
 * brand-rule check reads a shot without these, and never without anything
 * the person or Astra wrote.
 */
/** Every pose describeVehicle can write, as a pattern: the element sheets' naming sentences carry it too (elements.ts). */
export const VEHICLE_POSE_PATTERN = `(?:${esc(POSE.headOn)}|${esc(POSE.away)}|(?:${esc(POSE.towardQuarter)}|${esc(POSE.sideOn)}|${esc(POSE.awayQuarter)})(?:left|right))`;
export const VEHICLE_SENTENCE = new RegExp(
  "The (?:car|vehicle) in the sketch " +
    `${VEHICLE_POSE_PATTERN}; ` +
    `(?:${esc(WITH_HEADLIGHTS)}(?:${esc(BACK_JOIN)}(?:${esc(BACK.wing)}|${esc(BACK.tailLights)}))?|${esc(FRONT_OPPOSITE)}(?:${esc(BACK.wing)}|${esc(BACK.tailLights)}))` +
    `\\. ${esc(VEHICLE_SENTENCE_END)}`,
  "g",
);
