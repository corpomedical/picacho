// What the chat's reader is told about the set, each message (Helios Cut 2,
// "Astra understands", step 5, 2026-09-25 — operator: "Run, keep going.").
//
// WHY. A correction means something only against what is on screen: "a bit
// closer", "no, lower", "the other car", "now she's smiling". So each
// reading is handed, after the fixed instructions (shot-reading.ts
// SHOT_READER_STATIC, first so the provider's prompt cache holds them):
// - STAGE: the set's cameras and marks by id, the person's characters and
//   the set's things under short aliases (p1…, t1…), so the model never
//   sees a character's id or an element key;
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
import { setElements, type ElementKind } from "./elements";
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
  /** STAGE, whole: the farthest things go first, then characters from the end (never the one in the frame). */
  stage: 1500,
  /** NOW, whole, before the build line: what happens is shortened first. */
  now: 600,
  /** At most this many turns, each side at most turnChars. */
  turns: 3,
  turnChars: 200,
  things: 12,
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

/** Colour words, one per thing: the model reads them in English, the page says them in the person's language (spec §5.4). */
export const COLOUR_IDS = ["red", "orange", "yellow", "olive", "green", "teal", "cyan", "blue", "navy", "purple", "pink", "brown", "black", "white", "grey"] as const;
export type ColourId = (typeof COLOUR_IDS)[number];

/** Which way a thing lies from the figure, by the figure's own front (people.ts sideOf). */
export type ThingWhere = "ahead" | "left" | "right" | "behind";

/** One of the set's things as the reader is told of it, and as a "which one?" button names it. */
export type ReaderThing = {
  key: string;
  kind: ElementKind;
  /** English, for the model: "the car", "Car 2", "an object" (the page's elementName rule). */
  label: string;
  colour: ColourId;
  /** "4.4 m long" for a car or a vehicle, "1.2 m tall" for an object. */
  size: string;
  /** From the figure to the nearest edge of its footprint, metres. */
  distanceM: number;
  where: ThingWhere;
  /** The set's object indices it is made of: an eye-line on one of them is on it. */
  objects: number[];
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

/**
 * A block's colour as one of fifteen words: nearest by hue, with lightness
 * and saturation deciding black, white, grey, navy, olive and brown. The
 * garage's two red cars are both "red", which is why a "which one?" button
 * also says where each one is.
 */
export function colourWord(hex: string): ColourId {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return "grey";
  const h6 = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h6.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = 60 * (((g - b) / d) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
  }
  hue = wrapDeg(hue);

  if (l < 0.1) return "black";
  if (l > 0.93) return "white";
  if (s < 0.15) return l < 0.2 ? "black" : l > 0.85 ? "white" : "grey";
  if (hue < 15 || hue >= 345) return l > 0.75 ? "pink" : "red";
  if (hue < 45) return l < 0.4 || (s < 0.8 && l < 0.65) ? "brown" : "orange";
  if (hue < 90) return l < 0.35 || (s < 0.45 && l < 0.5) ? "olive" : hue < 70 ? "yellow" : "green";
  if (hue < 160) return "green";
  if (hue < 185) return "teal";
  if (hue < 200) return "cyan";
  if (hue < 250) return l < 0.3 ? "navy" : "blue";
  if (hue < 290) return "purple";
  return "pink";
}

const WHERE_WORDS: Record<ThingWhere, string> = { ahead: "ahead of them", left: "to their left", right: "to their right", behind: "behind them" };

/**
 * The set's things the reader may name, nearest to the figure first, at
 * most twelve (elements.ts setElements: cars, vehicles and loose objects,
 * never structure — the grandstand, the pit wall). Named by the page's own
 * rule (set-view.tsx elementName): a lone car is "the car", several are
 * "Car 1", "Car 2", counted over the whole set; coloured by its largest
 * block; placed by people.ts sideOf.
 */
export function readerThings(spec: SetSpec, mark: { x: number; z: number; facingDeg: number }): ReaderThing[] {
  const els = setElements(spec);
  const count: Record<ElementKind, number> = { car: 0, vehicle: 0, object: 0 };
  for (const e of els) count[e.kind] += 1;
  const lone: Record<ElementKind, string> = { car: "the car", vehicle: "the vehicle", object: "an object" };
  const numbered: Record<ElementKind, string> = { car: "Car", vehicle: "Vehicle", object: "Object" };
  const things = els.map((e, order) => {
    const objects = [...new Set(e.members.map(([o]) => o))];
    let largest = objects[0];
    let volume = -1;
    for (const o of objects) {
      const [sx, sy, sz] = spec.objects[o].size;
      if (sx * sy * sz > volume) {
        volume = sx * sy * sz;
        largest = o;
      }
    }
    const dx = Math.max(e.min[0] - mark.x, 0, mark.x - e.max[0]);
    const dz = Math.max(e.min[2] - mark.z, 0, mark.z - e.max[2]);
    const length = Math.max(e.max[0] - e.min[0], e.max[2] - e.min[2]);
    const height = e.max[1] - e.min[1];
    const thing: ReaderThing = {
      key: e.key,
      kind: e.kind,
      label: count[e.kind] > 1 ? `${numbered[e.kind]} ${e.ordinal}` : lone[e.kind],
      colour: colourWord(spec.objects[largest].color),
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

// ---------------------------------------------------------------------------
// The blocks.
// ---------------------------------------------------------------------------

const ALIAS_RE = /^([tp])(\d+)$/;

/**
 * STAGE, and the aliases the reading's answer is mapped back through. The
 * aliases are t1… and p1…; if the set's own camera or mark ids already use
 * one of them, both become thing1… and person1…, so an alias is never a
 * camera or a mark. (normaliseSetSpec names them c1… and m1… today, so
 * this is a guard for a spec that ever names them otherwise.)
 * Held to 1,500 characters: the farthest things go first, then characters
 * from the end — never `keep`, the one in the frame, whom NOW names.
 */
export function readerStageBlock(input: {
  spec: Pick<SetSpec, "cameras" | "marks">;
  characters: readonly ReaderCharacter[];
  things: readonly ReaderThing[];
  keep?: string | null;
}): { text: string; aliases: ReaderAliases } {
  const { spec } = input;
  const characters = input.characters.slice(0, READER_CONTEXT_MAX.characters);
  const things = input.things.slice(0, READER_CONTEXT_MAX.things);
  const ids = [...spec.cameras.map((c) => c.id), ...spec.marks.map((m) => m.id)];
  const clash = ids.some((id) => {
    const m = ALIAS_RE.exec(id);
    if (!m) return false;
    const n = Number(m[2]);
    return m[1] === "t" ? n >= 1 && n <= things.length : n >= 1 && n <= characters.length;
  });
  const thingAlias = (i: number) => (clash ? `thing${i + 1}` : `t${i + 1}`);
  const personAlias = (i: number) => (clash ? `person${i + 1}` : `p${i + 1}`);

  const named = (xs: readonly { id: string; label: string }[]) => xs.map((x) => `${x.id}: ${x.label || x.id}`).join("; ");
  const people = characters.map((ch, i) => ({ ch, alias: personAlias(i) }));
  const listed = things.map((t, i) => ({ t, alias: thingAlias(i) }));

  const compose = (ps: typeof people, ts: typeof listed) => {
    const personLine = ps.length
      ? ps.map(({ ch, alias }) => `${alias}: ${cleanText(ch.name, READER_CONTEXT_MAX.nameChars) || "unnamed"}${ch.hasPhoto ? "" : " (no photo yet)"}`).join("; ")
      : "none";
    const thingLine = ts.length ? ts.map(({ t, alias }) => `${alias}: ${t.label}, ${t.colour}, ${t.size}, ${num(t.distanceM)} m ${WHERE_WORDS[t.where]}`).join("; ") : "none";
    return [
      "STAGE",
      `Cameras: ${named(spec.cameras)}.`,
      `Marks: ${spec.marks.length ? named(spec.marks) : "none"}.`,
      `Characters: ${personLine}.`,
      `THINGS: ${thingLine}.`,
    ].join("\n");
  };

  let ps = people;
  let ts = listed;
  let text = compose(ps, ts);
  while (text.length > READER_CONTEXT_MAX.stage && ts.length > 0) {
    ts = ts.slice(0, -1);
    text = compose(ps, ts);
  }
  while (text.length > READER_CONTEXT_MAX.stage) {
    const drop = ps.findLastIndex((p) => p.ch.id !== input.keep);
    if (drop < 0) break;
    ps = ps.filter((_, i) => i !== drop);
    text = compose(ps, ts);
  }
  return {
    text: text.slice(0, READER_CONTEXT_MAX.stage),
    aliases: {
      things: Object.fromEntries(ts.map(({ t, alias }) => [alias, t.key])),
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
    const t = ctx.things.find((x) => x.objects.includes(index));
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
