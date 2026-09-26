// What the chat's reader is told about the set, each message (Helios Cut 2,
// "Astra understands", step 5, 2026-09-25 — operator: "Run, keep going.").
//
// WHY. A correction means something only against what is on screen: "a bit
// closer", "no, lower", "the other car", "now she's smiling". So each
// reading is handed, after the fixed instructions (shot-reading.ts
// SHOT_READER_STATIC, first so the provider's prompt cache holds them):
// - STAGE: the set's cameras and marks by id, the person's characters, the
//   set's things and its named parts under short aliases (p1…, t1…, s1…),
//   so the model never sees a character's id or an element key;
// - NOW: who is in the frame, where, and how the camera, the look and
//   "what happens" stand — written HERE, on the server, from values it has
//   checked, never from the page's own sentence;
// - LAST TURNS: up to three of the person's messages and what the page did
//   with each (written by the page from what ran, never by the model).
//
// NOW carries no take, film, mode or changes-left facts: the page decides
// those itself, so they cost no tokens (spec §4.2). Nothing here is stored
// (words-actions.ts: "NOTHING IS STORED here").
//
// Every block is English, for the model; nothing here is shown to anyone.
// Pure, relative imports only: the server action and the tests share it.

import { SET_DIRECTION_MAX_CHARS } from "./set-config";
import { SET_LIMITS, STAND_POSES, cleanText, type SetSpec, type StandPose, type Vec3 } from "./set-spec";
import { partShapes, setElements, thingLabels, type ElementKind } from "./elements";
import { colourWord, type ColourId } from "./colour-words";
import type { CameraPose } from "./match-shot";
import { normaliseGaze, sideOf, type Gaze } from "./people";
import { focalMm, normaliseSetRig, sensorHeightMm, type RigFormat, type SetRig } from "./rig";
import { FRAME_XS, SHOT_READER_STATIC, type FrameX, type ReaderAliases } from "./shot-reading";
import { SHOT_WORDS_MAX_CHARS, type CameraSide, type FigureFacing } from "./shot-words";
import { TIME_PRESETS } from "./commands";
import { timeLabel } from "./time-of-day";

// ---------------------------------------------------------------------------
// The caps (spec §4.1).
// ---------------------------------------------------------------------------

export const READER_CONTEXT_MAX = {
  /**
   * STAGE, whole: the farthest parts go first, then the farthest things,
   * then characters from the end (never the one in the frame). 2,000 since
   * Helios Cut 4, step B3 (2026-09-26), for the set's named parts (was
   * 1,500): at most 500 more characters, ~200 tokens × $0.75/1M = $0.00015
   * a reading at worst, uncached (scripts/helios-reader-check/prices.json,
   * gpt-5.4-mini, read 2026-09-25).
   */
  stage: 2000,
  /** NOW, whole, before the build line: what happens is shortened first. */
  now: 600,
  /** At most this many turns, each side at most turnChars. */
  turns: 3,
  turnChars: 200,
  things: 12,
  /** Named parts of the set (PARTS), nearest first. */
  parts: 12,
  characters: 20,
  /** A character's name as the reader sees it: a set's own label is held to the same (SET_LIMITS.labelChars). */
  nameChars: SET_LIMITS.labelChars,
} as const;

/** The line NOW gains on the Sets home's first message to a set it just built (spec §3.1 step 14, §4.2). */
export const READER_BUILD_LINE = "This message built the set: what it says about the place is already built.";

// ---------------------------------------------------------------------------
// The shapes.
// ---------------------------------------------------------------------------

/**
 * Where the shot stands, as the page sends it and as the server keeps it
 * once checked (normaliseReaderNow): the same fields both ways.
 */
export type ReaderNow = {
  /** The character in the frame: one of the person's own, or null. */
  who: string | null;
  /** The mark they stand on, or null for a spot of their own. */
  markId: string | null;
  mark: { x: number; z: number; facingDeg: number };
  pose: StandPose;
  gaze: Gaze | null;
  /** The set's camera the view is, or null for a free camera. */
  cameraId: string | null;
  camera: CameraPose;
  /** "centre" unless a third is set (shot-reading.ts FRAME_XS). */
  frameX: FrameX;
  rig: SetRig;
  direction: string;
};

/** One earlier turn: the person's message and what the page did with it. */
export type ReaderTurn = { said: string; did: string };

/** A character the reader may meet by name: one of the person's own. */
export type ReaderCharacter = { id: string; name: string; hasPhoto: boolean };

// Colour words live in a leaf module since Helios Cut 4, step B2 (the page
// names things by colour too); passed on from here as before.
export { COLOUR_IDS, colourWord, type ColourId } from "./colour-words";

/** Which way a thing lies from the figure, by the figure's own front (people.ts sideOf). */
export type ThingWhere = "ahead" | "left" | "right" | "behind";

/** One of the set's things as the reader is told of it, and as a "which one?" button names it. */
export type ReaderThing = {
  key: string;
  /**
   * Its place in the set's own order (elements.ts setElements), from 1: its
   * alias is t{n} whatever the order it is listed in, so "t2" names the same
   * car on every read of the visit, wherever she has moved since (review of
   * Cut 2, U1: nearest-first numbers moved under LAST TURNS, and "the other
   * car" picked the one she stood by).
   */
  n: number;
  kind: ElementKind;
  /** English, for the model: "the car", "Car 2", "an object" (the page's elementName rule). Every mention of the thing uses it. */
  label: string;
  /**
   * Its name when the set names it (elements.ts thingNameOf; Helios Cut 4,
   * step B3), as written: STAGE says it in brackets after the label, "t1:
   * the car (red sports car)". Null without one.
   */
  name: string | null;
  colour: ColourId;
  /** "4.4 m long" for a car or a vehicle, "1.2 m tall" for an object. */
  size: string;
  /** From the figure to the nearest edge of its footprint, metres. */
  distanceM: number;
  where: ThingWhere;
  /** The set's object indices it is made of: an eye-line on one of them is on it. */
  objects: number[];
};

/**
 * One of the set's named parts as the reader is told of it (Helios Cut 4,
 * step B3): the grandstand, the barriers. Structure, never a thing: it
 * can't move and takes no photos, but she can stand by it, face it and
 * look at it. Only a part the set names is listed (elements.ts setParts).
 */
export type ReaderPart = {
  /** elements.ts partKeyOf: "s:" and its name in lower case. */
  key: string;
  /** Its place among the set's parts (setParts' order), from 1: its alias is s{n}, fixed for the visit as a thing's is. */
  n: number;
  /** As written. */
  name: string;
  colour: ColourId;
  /** "120 m long", or "12 m tall" for a part taller than it is long. */
  size: string;
  /** From the figure to the nearest edge of its nearest block, metres. */
  distanceM: number;
  /** Which way that nearest edge lies from the figure. */
  where: ThingWhere;
  objects: number[];
  /** Its largest block: an eye-line on the part looks at it (turn-plan.ts). */
  largest: number;
};

export type ReaderMessage = { role: "system" | "user"; content: string };

// ---------------------------------------------------------------------------
// Small readers.
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const wrapDeg = (d: number) => ((d % 360) + 360) % 360;
const DEG = Math.PI / 180;
/** A number as the blocks write it: at most `places` decimals, no trailing zeros ("3", "4.4", "1.45"). */
const num = (n: number, places = 1) => String(Math.round(n * 10 ** places) / 10 ** places || 0);

function vec3(v: unknown, lo: Vec3, hi: Vec3): Vec3 | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const out = [0, 1, 2].map((i) => finite(v[i]));
  if (out.some((x) => x === null)) return null;
  return [0, 1, 2].map((i) => Math.round(clamp(out[i] as number, lo[i], hi[i]) * 1000) / 1000) as Vec3;
}

// ---------------------------------------------------------------------------
// NOW, checked.
// ---------------------------------------------------------------------------

/**
 * The page's NOW, held to the set and the person (spec §4.2): ids against
 * the working copy or the person's own characters (`castIds`), numbers
 * clamped to the stage the way a saved layout is (set-spec.ts
 * normaliseSetLayout), the rig through normaliseSetRig, the eye-line
 * through normaliseGaze, what happens cleaned as the shot action cleans it.
 * A forged id is dropped: the line then says "a spot of their own", "Free
 * camera" or no one. Null when it is not an object at all.
 */
export function normaliseReaderNow(v: unknown, spec: SetSpec, castIds: readonly string[]): ReaderNow | null {
  if (!isObject(v)) return null;
  const halfX = spec.bounds.x / 2;
  const halfZ = spec.bounds.z / 2;

  const who = typeof v.who === "string" && castIds.includes(v.who) ? v.who : null;
  const markId = typeof v.markId === "string" && spec.marks.some((m) => m.id === v.markId) ? v.markId : null;
  const base = spec.marks.find((m) => m.id === markId) ?? spec.marks[0] ?? { x: 0, z: 0, facingDeg: 0 };
  const m = isObject(v.mark) ? v.mark : {};
  const mark = {
    x: Math.round(clamp(finite(m.x) ?? base.x, -halfX, halfX) * 1000) / 1000,
    z: Math.round(clamp(finite(m.z) ?? base.z, -halfZ, halfZ) * 1000) / 1000,
    facingDeg: wrapDeg(Math.round((finite(m.facingDeg) ?? base.facingDeg) * 10) / 10),
  };

  const cameraId = typeof v.cameraId === "string" && spec.cameras.some((c) => c.id === v.cameraId) ? v.cameraId : null;
  const named = spec.cameras.find((c) => c.id === cameraId) ?? spec.cameras[0];
  const c = isObject(v.camera) ? v.camera : {};
  const reachX = halfX + 10;
  const reachZ = halfZ + 10;
  const far = SET_LIMITS.maxCoordinate;
  const position = vec3(c.position, [-reachX, 0.2, -reachZ], [reachX, spec.bounds.height * 2, reachZ]);
  const target = vec3(c.target, [-far, -far, -far], [far, far, far]);
  const fov = finite(c.fovDeg);
  const camera: CameraPose =
    position && target && fov !== null && Math.hypot(target[0] - position[0], target[1] - position[1], target[2] - position[2]) >= 0.1
      ? { position, target, fovDeg: Math.round(clamp(fov, SET_LIMITS.minLayoutFovDeg, SET_LIMITS.maxLayoutFovDeg) * 1000) / 1000 }
      : named
        ? { position: [...named.position], target: [...named.target], fovDeg: named.fovDeg }
        : { position: [mark.x, 1.45, mark.z + 3], target: [mark.x, 1.45, mark.z], fovDeg: 40 };

  return {
    who,
    markId,
    mark,
    pose: (STAND_POSES as readonly unknown[]).includes(v.pose) ? (v.pose as StandPose) : "stand",
    gaze: normaliseGaze(v.gaze, spec.objects.length),
    cameraId,
    camera,
    frameX: (FRAME_XS as readonly unknown[]).includes(v.frameX) ? (v.frameX as FrameX) : "centre",
    rig: normaliseSetRig(v.rig),
    direction: cleanText(v.direction, SET_DIRECTION_MAX_CHARS),
  };
}

/** The earlier turns as the page sends them, held to three, each side cleaned to 200 characters; a turn with no message is left out. */
export function normaliseReaderTurns(v: unknown): ReaderTurn[] {
  if (!Array.isArray(v)) return [];
  const out: ReaderTurn[] = [];
  for (const t of v) {
    if (!isObject(t)) continue;
    const said = cleanText(t.said, READER_CONTEXT_MAX.turnChars);
    if (!said) continue;
    out.push({ said, did: cleanText(t.did, READER_CONTEXT_MAX.turnChars) });
  }
  return out.slice(-READER_CONTEXT_MAX.turns);
}

// ---------------------------------------------------------------------------
// The things.
// ---------------------------------------------------------------------------

const WHERE_WORDS: Record<ThingWhere, string> = { ahead: "ahead of them", left: "to their left", right: "to their right", behind: "behind them" };

/**
 * The set's things the reader may name, nearest to the figure first, at
 * most twelve (elements.ts setElements: cars, vehicles and loose objects,
 * never structure — the grandstand, the pit wall). Named by the page's own
 * rule (elements.ts labelOf, Helios Cut 4, step B2): a lone car is "the
 * car", several are "Car 1", "Car 2", counted over the whole set; coloured
 * by its largest block; placed by people.ts sideOf. In English, for the
 * model; a thing the set names carries its name too (step B3), and its
 * label stays the handle, so "Car 2" means the same car named or not.
 */
export function readerThings(spec: SetSpec, mark: { x: number; z: number; facingDeg: number }): ReaderThing[] {
  const els = setElements(spec);
  const labels = thingLabels(spec, els);
  const lone: Record<ElementKind, string> = { car: "the car", vehicle: "the vehicle", object: "an object" };
  const numbered: Record<ElementKind, string> = { car: "Car", vehicle: "Vehicle", object: "Object" };
  const things = els.map((e, order) => {
    const objects = [...new Set(e.members.map(([o]) => o))];
    const l = labels[order];
    const dx = Math.max(e.min[0] - mark.x, 0, mark.x - e.max[0]);
    const dz = Math.max(e.min[2] - mark.z, 0, mark.z - e.max[2]);
    const length = Math.max(e.max[0] - e.min[0], e.max[2] - e.min[2]);
    const height = e.max[1] - e.min[1];
    const thing: ReaderThing = {
      key: e.key,
      n: order + 1,
      kind: e.kind,
      label: l.several ? `${numbered[e.kind]} ${l.ordinal}` : lone[e.kind],
      name: l.name,
      colour: l.colour,
      size: e.kind === "object" ? `${num(height)} m tall` : `${num(length)} m long`,
      distanceM: Math.round(Math.hypot(dx, dz) * 10) / 10,
      where: sideOf(mark, { x: e.centre[0], z: e.centre[2] }),
      objects,
    };
    return { thing, order };
  });
  things.sort((a, b) => a.thing.distanceM - b.thing.distanceM || a.order - b.order);
  return things.slice(0, READER_CONTEXT_MAX.things).map((t) => t.thing);
}

/**
 * The set's named parts the reader may name, nearest to the figure first,
 * at most twelve (Helios Cut 4, step B3): each measured from the figure to
 * the nearest edge of its nearest block (turn-plan.ts nearestOnPart's
 * rule), sized by the box round all its blocks, coloured by its largest.
 * Empty on a set that names none: every set until an admin's naming pass.
 */
export function readerParts(spec: Pick<SetSpec, "objects" | "bounds">, mark: { x: number; z: number; facingDeg: number }): ReaderPart[] {
  const shapes = partShapes(spec, setElements(spec));
  const parts = shapes.map((p, order) => {
    let best = { d: Infinity, x: p.min[0], z: p.min[2] };
    for (const f of p.footprints) {
      const x = clamp(mark.x, f.min[0], f.max[0]);
      const z = clamp(mark.z, f.min[2], f.max[2]);
      const d = Math.hypot(mark.x - x, mark.z - z);
      if (d < best.d) best = { d, x, z };
    }
    const length = Math.max(p.max[0] - p.min[0], p.max[2] - p.min[2]);
    const height = p.max[1] - p.min[1];
    const part: ReaderPart = {
      key: p.key,
      n: order + 1,
      name: p.name,
      colour: colourWord(spec.objects[p.largest]?.color ?? ""),
      size: height > length ? `${num(height)} m tall` : `${num(length)} m long`,
      distanceM: Math.round(best.d * 10) / 10,
      // From inside it (standing on a road), its middle says where it lies.
      where: best.d < 0.05 ? sideOf(mark, { x: (p.min[0] + p.max[0]) / 2, z: (p.min[2] + p.max[2]) / 2 }) : sideOf(mark, { x: best.x, z: best.z }),
      objects: [...p.objects],
      largest: p.largest,
    };
    return { part, order };
  });
  parts.sort((a, b) => a.part.distanceM - b.part.distanceM || a.order - b.order);
  return parts.slice(0, READER_CONTEXT_MAX.parts).map((p) => p.part);
}

// ---------------------------------------------------------------------------
// The blocks.
// ---------------------------------------------------------------------------

const ALIAS_RE = /^([tps])(\d+)$/;

/** A name as a STAGE line carries it: the marks that part a line (, ; brackets) made spaces, so a name can't break the list. */
const listName = (name: string) => name.replace(/[,;()[\]\n]/g, " ").replace(/\s+/g, " ").trim();

/**
 * STAGE, and the aliases the reading's answer is mapped back through. The
 * aliases are t1…, s1… and p1…; if the set's own camera or mark ids already
 * use one of them, all become thing1…, part1… and person1…, so an alias is
 * never a camera or a mark. A thing's number is its place in the set's own
 * order (ReaderThing.n), a part's its place among the parts (ReaderPart.n),
 * not in the list: the list is nearest first and changes as she moves, the
 * alias never does. (normaliseSetSpec names them c1… and m1… today, so
 * this is a guard for a spec that ever names them otherwise.) A part's
 * alias maps to its part key ("s:grandstand") beside the things', so a
 * reading's "thing" may be either (shot-reading.ts thingPick).
 * PARTS is said only when the set names a part: an unnamed set's STAGE is
 * exactly what it was before Helios Cut 4.
 * Held to 2,000 characters: the farthest parts go first, then the farthest
 * things, then characters from the end — never `keep`, the one in the
 * frame, whom NOW names.
 */
export function readerStageBlock(input: {
  spec: Pick<SetSpec, "cameras" | "marks">;
  characters: readonly ReaderCharacter[];
  things: readonly ReaderThing[];
  parts?: readonly ReaderPart[];
  keep?: string | null;
}): { text: string; aliases: ReaderAliases } {
  const { spec } = input;
  const characters = input.characters.slice(0, READER_CONTEXT_MAX.characters);
  const things = input.things.slice(0, READER_CONTEXT_MAX.things);
  const partsIn = (input.parts ?? []).slice(0, READER_CONTEXT_MAX.parts);
  const ids = [...spec.cameras.map((c) => c.id), ...spec.marks.map((m) => m.id)];
  const clash = ids.some((id) => {
    const m = ALIAS_RE.exec(id);
    if (!m) return false;
    const n = Number(m[2]);
    return m[1] === "t" ? things.some((t) => t.n === n) : m[1] === "s" ? partsIn.some((p) => p.n === n) : n >= 1 && n <= characters.length;
  });
  const thingAlias = (n: number) => (clash ? `thing${n}` : `t${n}`);
  const partAlias = (n: number) => (clash ? `part${n}` : `s${n}`);
  const personAlias = (i: number) => (clash ? `person${i + 1}` : `p${i + 1}`);

  const named = (xs: readonly { id: string; label: string }[]) => xs.map((x) => `${x.id}: ${x.label || x.id}`).join("; ");
  const people = characters.map((ch, i) => ({ ch, alias: personAlias(i) }));
  const listed = things.map((t) => ({ t, alias: thingAlias(t.n) }));
  const partsListed = partsIn.map((p) => ({ p, alias: partAlias(p.n) }));

  const compose = (ps: typeof people, ts: typeof listed, ss: typeof partsListed) => {
    const personLine = ps.length
      ? ps.map(({ ch, alias }) => `${alias}: ${cleanText(ch.name, READER_CONTEXT_MAX.nameChars) || "unnamed"}${ch.hasPhoto ? "" : " (no photo yet)"}`).join("; ")
      : "none";
    const thingName = (t: ReaderThing) => {
      const name = t.name === null ? "" : listName(t.name);
      return name ? `${t.label} (${name})` : t.label;
    };
    const thingLine = ts.length ? ts.map(({ t, alias }) => `${alias}: ${thingName(t)}, ${t.colour}, ${t.size}, ${num(t.distanceM)} m ${WHERE_WORDS[t.where]}`).join("; ") : "none";
    const lines = ["STAGE", `Cameras: ${named(spec.cameras)}.`, `Marks: ${spec.marks.length ? named(spec.marks) : "none"}.`, `Characters: ${personLine}.`, `THINGS: ${thingLine}.`];
    if (ss.length) lines.push(`PARTS: ${ss.map(({ p, alias }) => `${alias}: ${listName(p.name) || "part"}, ${p.colour}, ${p.size}, ${num(p.distanceM)} m ${WHERE_WORDS[p.where]}`).join("; ")}.`);
    return lines.join("\n");
  };

  let ps = people;
  let ts = listed;
  let ss = partsListed;
  let text = compose(ps, ts, ss);
  while (text.length > READER_CONTEXT_MAX.stage && ss.length > 0) {
    ss = ss.slice(0, -1);
    text = compose(ps, ts, ss);
  }
  while (text.length > READER_CONTEXT_MAX.stage && ts.length > 0) {
    ts = ts.slice(0, -1);
    text = compose(ps, ts, ss);
  }
  while (text.length > READER_CONTEXT_MAX.stage) {
    const drop = ps.findLastIndex((p) => p.ch.id !== input.keep);
    if (drop < 0) break;
    ps = ps.filter((_, i) => i !== drop);
    text = compose(ps, ts, ss);
  }
  return {
    text: text.slice(0, READER_CONTEXT_MAX.stage),
    aliases: {
      things: Object.fromEntries([...ts.map(({ t, alias }) => [alias, t.key]), ...ss.map(({ p, alias }) => [alias, p.key])]),
      people: Object.fromEntries(ps.map(({ ch, alias }) => [alias, ch.id])),
    },
  };
}

/** The frame's shape, as a person says it. */
const FORMAT_WORDS: Record<RigFormat, string> = { square: "1:1", scope: "2.39:1", flat: "1.85:1", wide: "16:9", classic: "4:3", vertical: "9:16" };
const POSE_WORDS: Record<StandPose, string> = { stand: "standing", sit: "sitting", walk: "walking", lean: "leaning" };
const FACING_WORDS: Record<FigureFacing, string> = { camera: "the camera", away: "away", left: "frame left", right: "frame right" };
const FRAME_X_WORDS: Record<FrameX, string> = { centre: "centred", left_third: "on the left third", right_third: "on the right third" };

/** Where the figure faces, by the camera, in the four words the reader answers with (shot-words.ts facingFor, read back). */
function facingOf(mark: ReaderNow["mark"], camera: CameraPose): FigureFacing {
  const bearing = Math.atan2(camera.position[0] - mark.x, camera.position[2] - mark.z) / DEG;
  let rel = wrapDeg(mark.facingDeg - bearing);
  if (rel > 180) rel -= 360;
  if (Math.abs(rel) <= 45) return "camera";
  if (Math.abs(rel) >= 135) return "away";
  return rel > 0 ? "right" : "left";
}

/** Which of the eight sides of the figure the camera stands on, by the figure's own front (shot-words.ts sideUnit, read back). */
export function cameraSideOf(mark: ReaderNow["mark"], camera: CameraPose): CameraSide {
  const bearing = Math.atan2(camera.position[0] - mark.x, camera.position[2] - mark.z) / DEG;
  let rel = wrapDeg(bearing - mark.facingDeg);
  if (rel > 180) rel -= 360;
  // A bearing to the figure's left is positive (people.ts sideOf).
  const sectors: [number, CameraSide][] = [
    [22.5, "front"],
    [67.5, "front_left"],
    [112.5, "left"],
    [157.5, "back_left"],
  ];
  const a = Math.abs(rel);
  if (a > 157.5) return "back";
  for (const [edge, side] of sectors) {
    if (a <= edge) {
      if (side === "front") return side;
      return rel > 0 ? side : (side.replace("left", "right") as CameraSide);
    }
  }
  return "back";
}

function eyeLine(gaze: Gaze | null, now: ReaderNow, thingAlias: (objectIndex: number) => string | null): string {
  if (!gaze) return "no eye-line";
  if (gaze.at === "camera") return "eyes to the camera";
  if (gaze.at === "object") {
    const alias = thingAlias(gaze.index);
    return alias ? `looking at ${alias}` : "looking at part of the set";
  }
  const where = sideOf(now.mark, gaze);
  return where === "ahead"
    ? "looking ahead, out of frame"
    : where === "behind"
      ? "looking back over their shoulder, out of frame"
      : `looking off to their ${where}, out of frame`;
}

/** The rig's items that are not as built, in LOOK IDS' own words where it has them (time:golden, stock:film35). */
function lookItems(rig: SetRig): string[] {
  const items: string[] = [];
  if (rig.genre) items.push(`genre:${rig.genre}`);
  if (rig.light) items.push(`light:${rig.light.scheme}`);
  if (rig.time !== null) {
    const preset = TIME_PRESETS.find((t) => t.hour === rig.time);
    items.push(preset ? `time:${preset.id} (${timeLabel(rig.time)})` : `hour ${timeLabel(rig.time)}`);
  }
  if (rig.stop !== null) items.push(`stop:${rig.stop}`);
  if (rig.stock) items.push(`stock:${rig.stock}`);
  if (rig.lens) items.push(`character:${rig.lens}`);
  if (rig.palette) items.push(`palette:${rig.palette}`);
  if (rig.era) items.push(`era:${rig.era}`);
  if (rig.ev !== 0) {
    const thirds = Math.round(rig.ev * 3);
    items.push(`exposure ${thirds > 0 ? "+" : ""}${thirds} thirds`);
  }
  return items;
}

/**
 * NOW, from a checked ReaderNow (spec §4.2), at most 600 characters —
 * what happens is shortened first, since a kept piece can only come from
 * what the model saw — and the build line after it on the Sets home's
 * first message to a set it just built.
 */
export function readerNowLine(
  now: ReaderNow,
  ctx: {
    spec: Pick<SetSpec, "cameras" | "marks">;
    characters: readonly ReaderCharacter[];
    aliases: ReaderAliases;
    things: readonly ReaderThing[];
    /** The set's named parts: an eye-line on one of their blocks is "looking at s1" (Helios Cut 4, step B3). */
    parts?: readonly ReaderPart[];
    origin?: "build" | null;
  },
): string {
  const aliasOf = (map: Record<string, string>, value: string) => Object.keys(map).find((k) => map[k] === value) ?? null;
  const character = now.who ? ctx.characters.find((c) => c.id === now.who) : undefined;
  const whoAlias = now.who ? aliasOf(ctx.aliases.people, now.who) : null;
  const name = character ? cleanText(character.name, READER_CONTEXT_MAX.nameChars) || "unnamed" : null;
  const who = name ? `Who: ${whoAlias ? `${whoAlias} ` : ""}${name}.` : "Who: no one yet.";

  const mark = ctx.spec.marks.find((m) => m.id === now.markId);
  const thingAlias = (index: number) => {
    const t = ctx.things.find((x) => x.objects.includes(index)) ?? ctx.parts?.find((x) => x.objects.includes(index));
    return t ? aliasOf(ctx.aliases.things, t.key) : null;
  };
  const place = `${mark ? `On ${mark.id} ${mark.label || mark.id}` : "On a spot of their own"}, facing ${FACING_WORDS[facingOf(now.mark, now.camera)]}, ${POSE_WORDS[now.pose]}, ${eyeLine(now.gaze, now, thingAlias)}.`;

  const cam = ctx.spec.cameras.find((c) => c.id === now.cameraId);
  const [px, py, pz] = now.camera.position;
  const [tx, ty, tz] = now.camera.target;
  const mm = Math.round(focalMm(now.camera.fovDeg, sensorHeightMm(now.rig.sensor, now.rig.format)));
  const away = Math.hypot(px - now.mark.x, pz - now.mark.z);
  const len = Math.hypot(tx - px, ty - py, tz - pz);
  const pitch = len < 1e-6 ? 0 : Math.round(Math.asin(clamp((ty - py) / len, -1, 1)) / DEG);
  const tilt = pitch === 0 ? "level" : pitch > 0 ? `tilted up ${pitch}°` : `tilted down ${-pitch}°`;
  const side = away >= 0.2 ? `from the ${cameraSideOf(now.mark, now.camera).replace("_", " ")}, ` : "";
  const camera = `Camera: ${cam ? `${cam.id} ${cam.label || cam.id}` : "Free camera"}, ${mm} mm, ${num(py, 2)} m high, ${num(away)} m away, ${side}${tilt}, ${FRAME_X_WORDS[now.frameX]}.`;

  const items = lookItems(now.rig);
  const squeeze = now.rig.squeeze !== 1 ? `, ${now.rig.squeeze}x squeeze` : "";
  const look = `Look: ${FORMAT_WORDS[now.rig.format]}${squeeze}; ${items.length ? `${items.join(", ")}; everything else as built` : "everything else as built"}.`;

  const lead = `NOW\n${who} ${place} ${camera} ${look} What happens: `;
  // The spec's own shape: what happens last, in quotes, as NOW holds it.
  let text = now.direction ? `${lead}"${now.direction}"` : `${lead}nothing yet.`;
  const length = (t: string) => Array.from(t).length;
  if (length(text) > READER_CONTEXT_MAX.now) {
    // What happens gives way first, cut at a word and marked cut.
    const room = READER_CONTEXT_MAX.now - length(lead) - length(`"…"`);
    let short = Array.from(now.direction).slice(0, Math.max(0, room)).join("");
    const space = short.lastIndexOf(" ");
    if (space > short.length / 2) short = short.slice(0, space);
    short = short.trim();
    text = short ? `${lead}"${short}…"` : `${lead}nothing yet.`;
  }
  text = Array.from(text).slice(0, READER_CONTEXT_MAX.now).join("");
  return ctx.origin === "build" ? `${text}\n${READER_BUILD_LINE}` : text;
}

/** LAST TURNS: at most three, oldest first, each "You: … -> did: …"; empty with none. */
export function readerTurnsBlock(turns: readonly ReaderTurn[]): string {
  const last = turns.slice(-READER_CONTEXT_MAX.turns);
  if (last.length === 0) return "";
  return ["LAST TURNS", ...last.map((t) => `You: ${cleanText(t.said, READER_CONTEXT_MAX.turnChars)} -> did: ${cleanText(t.did, READER_CONTEXT_MAX.turnChars) || "nothing"}`)].join("\n");
}

/**
 * The messages one reading sends, in this order: the fixed instructions,
 * byte-identical every time (so they are the cached prefix); then this
 * set's STAGE, NOW and LAST TURNS; then the person's words, cleaned to
 * SHOT_WORDS_MAX_CHARS.
 */
export function readerMessages(stage: string, now: string, turns: string, message: string): ReaderMessage[] {
  return [
    { role: "system", content: SHOT_READER_STATIC },
    { role: "system", content: [stage, now, turns].filter((b) => b.length > 0).join("\n") },
    { role: "user", content: cleanText(message, SHOT_WORDS_MAX_CHARS) },
  ];
}
