// The three sets the phrases are read against, built as real sets
// (normaliseSetSpec), so the reader is told exactly what a page would tell
// it: STAGE, NOW and LAST TURNS from reader-context.ts, with the aliases it
// assigns (Helios Cut 2, step 13, 2026-09-25 — operator: "Run, keep going.").
//
// - race: fixtures-race-track.json as it is. Built after Cut 1, so 16:9.
// - showroom: fixtures-showroom-open.json with its loose props taken out,
//   a blue copy of its car behind her and a white stand past it, its
//   cameras and mark named as the corpus names them.
// - garage: built here — two red cars of nearly the same size either side
//   of her (the race car at 4.3 m and 4.5 m), a grey bench behind, three
//   walls. The "which one?" set.
//
// THE NAMES (Helios Cut 4, step B3). Each set is read NAMED, as a set the
// naming pass (step B4) has named would be: hand-written names put on
// through the field a saved set carries (withNames), the race's car and
// three parts, the showroom's two coupes and its stand, the garage's two
// cars with ONE name, so "which one?" is still a real question there. The
// fixture files on disk stay nameless: they are the "old set", and a
// phrase with context.unnamed reads its set without the names.
//
// THE ALIASES ARE THE PAGE'S. A thing's alias is its place in the set's own
// order (elements.ts setElements, by its first block; reader-context.ts
// ReaderThing.n — stable for the visit since the review of Cut 2, U1), so
// the corpus's t1/t2/t3 hold only if the sets list their blocks in that
// order: checkFixture refuses a set whose aliases don't match what the
// phrases expect. The corpus's descriptions ("3 m to their left") are notes for a
// reader; where the built set differs, the dry run says so.
//
// Every character id, still and price is made up here; nothing is read
// from an account.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { astraTooBig } from "../../../src/lib/sets/astra-card.ts";
import { fovForLens } from "../../../src/lib/sets/build-scene.ts";
import { setElements } from "../../../src/lib/sets/elements.ts";
import type { CameraPose } from "../../../src/lib/sets/match-shot.ts";
import {
  normaliseReaderNow,
  normaliseReaderTurns,
  readerMessages,
  readerNowLine,
  readerParts,
  readerStageBlock,
  readerThings,
  readerTurnsBlock,
  type ReaderCharacter,
  type ReaderMessage,
  type ReaderNow,
  type ReaderPart,
  type ReaderThing,
} from "../../../src/lib/sets/reader-context.ts";
import { NEW_SET_RIG, normaliseSetRig, sensorHeightMm, type RigFormat, type RigSensor } from "../../../src/lib/sets/rig.ts";
import { cleanText, normaliseSetSpec, type SetObject, type SetSpec } from "../../../src/lib/sets/set-spec.ts";
import type { ReaderAliases } from "../../../src/lib/sets/shot-reading.ts";
import { SHOT_WORDS_MAX_CHARS, sideUnit, type CameraSide, type FigureFacing } from "../../../src/lib/sets/shot-words.ts";
import { takesCredits } from "../../../src/lib/sets/take.ts";
import { cameraSpotOf, pickTakeStart, type PageState, type PlanShot, type TakeStart } from "../../../src/lib/sets/turn-plan.ts";
import { replyPartsOf, replyThingsOf, type ReplyFacts, type ReplyWords } from "../../../src/lib/sets/turn-reply.ts";
import type { CorpusEntry, Fixture, FixtureName, FixtureNow, Locale, NowCamera } from "./corpus.mts";

const SETS_DIR = fileURLToPath(new URL("../../../src/lib/sets/", import.meta.url));

/** Made-up character ids, the tests' own: nothing here is anyone's account. */
const CHARACTER_IDS: Record<string, string> = {
  Eva: "0b0f7c1e-3a44-4c2a-9d1e-6a1f2b3c4d5e",
  Marco: "7d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6",
  Lena: "2c3d4e5f-6a7b-4c8d-9e0f-a1b2c3d4e5f6",
};

/** The page's prices, as its own buttons show them (set-view.tsx pageCredits). */
export const CREDITS = {
  still: takesCredits("omni", { clips: 0, stills: 1 }),
  take: { omni: takesCredits("omni", { clips: 1, stills: 1 }), veo: takesCredits("veo", { clips: 1, stills: 1 }) },
};

const specOf = (json: unknown, name: string): SetSpec => {
  const n = normaliseSetSpec(json);
  if (!n.ok) throw new Error(`the ${name} fixture is not a set: ${n.reason}`);
  return n.spec;
};
const readFixture = (file: string): Record<string, unknown> => JSON.parse(readFileSync(`${SETS_DIR}${file}`, "utf8")) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// The sets.
// ---------------------------------------------------------------------------

const volume = (o: SetObject) => o.size[0] * o.size[1] * o.size[2];

/** A car's own blocks, as objects: every object any of its copies belongs to (the 53-row test's rule). */
function carObjects(spec: SetSpec): { objects: SetObject[]; indices: number[]; min: number[]; max: number[] } {
  const car = setElements(spec).find((e) => e.kind === "car");
  if (!car) throw new Error("the fixture has no car");
  const indices = [...new Set(car.members.map(([o]) => o))];
  return { objects: indices.map((i) => spec.objects[i]), indices, min: car.min, max: car.max };
}

/**
 * A copy of a car, scaled by `s` round its own middle and ground, its
 * middle moved to (x, z), its body (largest block) painted `body`.
 */
function carCopy(car: ReturnType<typeof carObjects>, o: { s: number; x: number; z: number; body?: string }): SetObject[] {
  const cx = (car.min[0] + car.max[0]) / 2;
  const cz = (car.min[2] + car.max[2]) / 2;
  const largest = car.objects.reduce((a, b) => (volume(b) > volume(a) ? b : a));
  // To the millimetre, as Astra writes a set: a copy is no bigger in words than the car it copies.
  const mm = (n: number) => Math.round(n * 1000) / 1000;
  const v3 = (x: number, y: number, z: number) => [mm(x), mm(y), mm(z)] as SetObject["position"];
  return car.objects.map((b) => ({
    ...b,
    position: v3(o.x + (b.position[0] - cx) * o.s, b.position[1] * o.s, o.z + (b.position[2] - cz) * o.s),
    size: v3(b.size[0] * o.s, b.size[1] * o.s, b.size[2] * o.s),
    repeat: b.repeat ? { count: b.repeat.count, offset: v3(b.repeat.offset[0] * o.s, b.repeat.offset[1] * o.s, b.repeat.offset[2] * o.s) } : null,
    color: o.body && b === largest ? o.body : b.color,
  }));
}

const box = (position: [number, number, number], size: [number, number, number], color: string): SetObject => ({
  shape: "box",
  position,
  rotation: [0, 0, 0],
  size,
  color,
  roughness: 0.8,
  metalness: 0,
  emissive: null,
  emissiveIntensity: 0,
  castShadow: true,
  repeat: null,
  material: null,
});

/** Where she stands when NOW has no mark: the showroom's spot beside Car 1 (NOW: near t1, beside). */
type Spot = { x: number; z: number; facingDeg: number };

/** A built set: `spec` named (the phrases' set), `bare` the same set without a name (context.unnamed). */
export type BuiltSet = { name: FixtureName; spec: SetSpec; bare: SetSpec; spot: Spot | null };

/**
 * A set with hand-written names on its objects (Helios Cut 4, step B3),
 * through the field a saved set carries and the normaliser that cleans it
 * (set-spec.ts SetObject.name). A key is a thing's alias — "t1", the first
 * thing in the set's own order, every block of it — or objects by index:
 * "4", "11-16". Nothing else about the set moves: names are in no key.
 */
export function withNames(spec: SetSpec, names: Record<string, string>, label: string): SetSpec {
  const els = setElements(spec);
  const named = new Map<number, string>();
  for (const [key, name] of Object.entries(names)) {
    const thing = /^t(\d+)$/.exec(key);
    const range = /^(\d+)(?:-(\d+))?$/.exec(key);
    if (thing) {
      const el = els[Number(thing[1]) - 1];
      if (!el) throw new Error(`the ${label} fixture has no ${key} to name`);
      for (const [o] of el.members) named.set(o, name);
    } else if (range) {
      const from = Number(range[1]);
      const to = Number(range[2] ?? range[1]);
      for (let o = from; o <= to; o++) {
        if (!spec.objects[o]) throw new Error(`the ${label} fixture has no object ${o} to name`);
        named.set(o, name);
      }
    } else throw new Error(`withNames: "${key}" is neither a thing's alias nor object numbers`);
  }
  return specOf({ ...spec, objects: spec.objects.map((o, i) => (named.has(i) ? { ...o, name: named.get(i) } : o)) }, label);
}

/** The names each set is read with: what a naming pass could write, by hand (spec §4 B3). */
export const HAND_NAMES: Record<FixtureName, Record<string, string>> = {
  // The race track's car, and three parts of the set itself: its grandstand (objects 11–16), its pit garages (7–10) and its barriers (object 4, both copies).
  race: { t1: "red sports car", "11-16": "grandstand", "7-10": "pit garages", "4": "barriers" },
  showroom: { t1: "crimson sports coupe", t2: "blue sports coupe", t3: "white display stand" },
  // One name for both cars: "the red car" still fits both.
  garage: { t1: "red sports car", t2: "red sports car" },
};

function buildRace(): BuiltSet {
  const bare = specOf(readFixture("fixtures-race-track.json"), "race");
  return { name: "race", spec: withNames(bare, HAND_NAMES.race, "race"), bare, spot: null };
}

/** Her spot on the showroom floor: 2 m to the right of Car 1 (so Car 1 is on her left), facing +z. */
const SHOWROOM_SPOT: Spot = { x: -3.2, z: 0, facingDeg: 0 };

function buildShowroom(): BuiltSet {
  const raw = readFixture("fixtures-showroom-open.json");
  const base = specOf(raw, "showroom");
  const els = setElements(base);
  const loose = new Set(els.filter((e) => e.kind === "object").flatMap((e) => e.members.map(([o]) => o)));
  const car = carObjects(base);
  const carLength = car.max[2] - car.min[2];
  // Car 2, blue, its front 5 m behind her; the stand past it, 5.5 m to her right (its blocks after Car 2's, so the aliases stay t1 Car 1, t2 Car 2, t3 the stand).
  const car2 = carCopy(car, { s: 1, x: SHOWROOM_SPOT.x, z: SHOWROOM_SPOT.z - 5 - carLength / 2, body: "#1f4fd1" });
  const stand = box([SHOWROOM_SPOT.x - 5.5 - 0.3, 0.45, SHOWROOM_SPOT.z], [0.6, 0.9, 0.6], "#f4f4f2");
  const objects = [...base.objects.filter((_, i) => !loose.has(i)), ...car2, stand];
  const cams = base.cameras;
  const spec = specOf(
    {
      ...raw,
      objects,
      marks: [{ id: "m1", label: "Centre floor", x: 5, z: 3.5, facingDeg: 0 }],
      cameras: [
        { ...cams[0], id: "c1", label: "Showroom wide" },
        { ...cams[1], id: "c2", label: "Hero car" },
      ],
    },
    "showroom",
  );
  return { name: "showroom", spec: withNames(spec, HAND_NAMES.showroom, "showroom"), bare: spec, spot: SHOWROOM_SPOT };
}

function buildGarage(): BuiltSet {
  const race = readFixture("fixtures-race-track.json");
  const car = carObjects(specOf(race, "race"));
  const length = car.max[2] - car.min[2];
  const halfWidth = (s: number) => ((car.max[0] - car.min[0]) * s) / 2;
  // Her mark m1 at the middle, facing +z: +x is her left. Car 1 (4.3 m) 3 m
  // to her left, Car 2 (4.5 m) 3 m to her right, a grey bench 4 m behind.
  const s1 = 4.3 / length;
  const s2 = 4.5 / length;
  const car1 = carCopy(car, { s: s1, x: 3 + halfWidth(s1), z: 0 });
  const car2 = carCopy(car, { s: s2, x: -(3 + halfWidth(s2)), z: 0 });
  const bench = box([0, 0.45, -4 - 0.3], [1.6, 0.9, 0.6], "#8c8c8c");
  const walls = [box([0, 2, -7.8], [16, 4, 0.3], "#d8d3c8"), box([-7.8, 2, 0], [0.3, 4, 16], "#d8d3c8"), box([7.8, 2, 0], [0.3, 4, 16], "#d8d3c8")];
  const fov = (mm: number) => Math.round(fovForLens(mm, sensorHeightMm(NEW_SET_RIG.sensor, NEW_SET_RIG.format)) * 1000) / 1000;
  const spec = specOf(
    {
      version: race.version,
      title: "Workshop garage",
      description: "A small workshop garage with two red cars and a bench.",
      bounds: { x: 16, z: 16, height: 5 },
      sky: race.sky,
      ground: { color: "#6b6b68", roughness: 0.9 },
      fog: null,
      lights: race.lights,
      objects: [...walls, ...car1, ...car2, bench],
      marks: [
        { id: "m1", label: "Workshop floor", x: 0, z: 0, facingDeg: 0 },
        { id: "m2", label: "By the door", x: 0, z: 5.5, facingDeg: 180 },
      ],
      cameras: [
        { id: "c1", label: "Garage wide", position: [0, 1.6, 6], target: [0, 1.18, 0], fovDeg: fov(24) },
        { id: "c2", label: "Low front", position: [0.6, 0.5, 3.4], target: [0, 1, 0], fovDeg: fov(35) },
        { id: "c3", label: "Over the bench", position: [0, 2.2, -3.4], target: [0, 1.2, 0], fovDeg: fov(35) },
      ],
    },
    "garage",
  );
  return { name: "garage", spec: withNames(spec, HAND_NAMES.garage, "garage"), bare: spec, spot: null };
}

/** The three sets, built once. */
export function buildSets(): Record<FixtureName, BuiltSet> {
  return { race: buildRace(), showroom: buildShowroom(), garage: buildGarage() };
}

// ---------------------------------------------------------------------------
// One phrase's page: NOW, the reader's blocks, the page state.
// ---------------------------------------------------------------------------

export type PreparedEntry = {
  entry: CorpusEntry;
  set: BuiltSet;
  /** The set as this phrase reads it: named, or `bare` for context.unnamed. */
  spec: SetSpec;
  locale: Locale;
  /** The message as the reader is given it (cleaned, at most 600), and whether it was longer. */
  message: string;
  messageCut: boolean;
  now: ReaderNow;
  nowFacing: FigureFacing;
  nowWhoAlias: string | null;
  characters: (ReaderCharacter & { hasOutfit: boolean })[];
  things: ReaderThing[];
  parts: ReaderPart[];
  aliases: ReaderAliases;
  messages: ReaderMessage[];
  /** The page state before the turn; the reading's why and drops go in per reading. */
  state: PageState;
  shots: PlanShot[];
  /** NOW's camera lens and distance, for the lens and focus answers. */
  lensMm: number;
  distanceM: number;
};

function nowOf(fx: Fixture, entry: CorpusEntry): FixtureNow {
  return { ...fx.now, ...(entry.context?.now ?? {}) } as FixtureNow;
}

/** The camera the corpus describes — a lens, a height, a distance and a side round her — as a pose. */
function poseOf(cam: NowCamera, mark: Spot, format: RigFormat, sensor: RigSensor): CameraPose {
  const [ux, uz] = sideUnit(cam.side as CameraSide, mark.facingDeg);
  const d = cam.distanceM;
  const y = cam.heightM;
  const tilt = (cam.tiltDeg * Math.PI) / 180;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    position: [r3(mark.x + ux * d), r3(y), r3(mark.z + uz * d)],
    target: [r3(mark.x), r3(y + d * Math.tan(tilt)), r3(mark.z)],
    fovDeg: r3(fovForLens(cam.mm, sensorHeightMm(sensor, format))),
  };
}

/** One phrase on its set, as the page would send it and plan it. */
export function prepareEntry(entry: CorpusEntry, fx: Fixture, set: BuiltSet): PreparedEntry {
  const nowFx = nowOf(fx, entry);
  const locale: Locale = entry.context?.locale ?? "en";
  const characters = fx.characters.map((c) => {
    const id = CHARACTER_IDS[c.name];
    if (!id) throw new Error(`no made-up id for ${c.name}`);
    return { id, name: c.name, hasPhoto: c.hasPhoto, hasOutfit: c.hasOutfit };
  });
  const idOf = (alias: string | null) => (alias ? (characters[fx.characters.findIndex((c) => c.alias === alias)]?.id ?? null) : null);

  const spec = entry.context?.unnamed ? set.bare : set.spec;
  const markRow = nowFx.mark ? spec.marks.find((m) => m.id === nowFx.mark) : null;
  if (nowFx.mark && !markRow) throw new Error(`${entry.id}: mark ${nowFx.mark} is not on the ${set.name} set`);
  const spot: Spot = markRow ? { x: markRow.x, z: markRow.z, facingDeg: markRow.facingDeg } : (set.spot ?? { x: spec.marks[0].x, z: spec.marks[0].z, facingDeg: spec.marks[0].facingDeg });
  const rig = normaliseSetRig({ ...NEW_SET_RIG, ...nowFx.rig });
  const camera = poseOf(nowFx.camera, spot, rig.format, rig.sensor);

  const checked = normaliseReaderNow(
    {
      who: idOf(nowFx.who),
      markId: nowFx.mark,
      mark: spot,
      pose: nowFx.pose,
      gaze: null,
      cameraId: nowFx.camera.id,
      camera,
      frameX: nowFx.frameX,
      rig,
      direction: nowFx.direction,
    },
    spec,
    characters.map((c) => c.id),
  );
  if (!checked) throw new Error(`${entry.id}: NOW did not check`);

  // The server's own order (words-actions.ts readShotTurn).
  const message = cleanText(entry.phrase, SHOT_WORDS_MAX_CHARS);
  const messageCut = Array.from(cleanText(entry.phrase, Number.MAX_SAFE_INTEGER)).length > SHOT_WORDS_MAX_CHARS;
  const things = readerThings(spec, checked.mark);
  const parts = readerParts(spec, checked.mark);
  const stage = readerStageBlock({ spec, characters, things, parts, keep: checked.who });
  const nowLine = readerNowLine(checked, { spec, characters, aliases: stage.aliases, things, parts, origin: entry.context?.origin === "build" ? "build" : null });
  const turns = readerTurnsBlock(normaliseReaderTurns(entry.context?.turns ?? []));
  const messages = readerMessages(stage.text, nowLine, turns, message);

  const shots: PlanShot[] = [...fx.stills]
    .sort((a, b) => b.n - a.n)
    .map((s) => ({ generationId: `g-${s.n}`, kind: "still", status: s.status, format: s.format as RigFormat, characterId: idOf(s.who) }));
  const ts = nowFx.takeStart;
  const takeStart: TakeStart | null = ts ? { id: `g-${ts.still}`, n: ts.still, armedBy: ts.armedBy } : null;
  if (ts && !shots.some((s) => s.generationId === `g-${ts.still}`)) throw new Error(`${entry.id}: the take starts on Still ${ts.still}, which the ${set.name} fixture doesn't have`);

  const state: PageState = {
    mode: nowFx.mode,
    source: "message",
    origin: entry.context?.origin === "build" ? "build" : null,
    why: "ok",
    dropped: [],
    messageCut,
    characterId: checked.who,
    characters: characters.map((c) => ({ id: c.id, name: c.name, hasPhoto: c.hasPhoto, hasOutfit: c.hasOutfit })),
    markId: checked.markId,
    pose: checked.pose,
    cameraId: checked.cameraId,
    frameX: checked.frameX,
    rig: checked.rig,
    cameraBearingDeg: cameraSpotOf(checked.camera, checked.mark).bearingDeg,
    direction: checked.direction,
    takeStart,
    takeMove: null,
    takeEngine: "omni",
    shots,
    filmOpen: nowFx.filmOpen,
    editsLeft: fx.edits.left,
    editsCap: fx.edits.cap,
    tooBig: astraTooBig(spec),
    credits: CREDITS,
  };

  const whoIndex = characters.findIndex((c) => c.id === checked.who);
  return {
    entry,
    set,
    spec,
    locale,
    message,
    messageCut,
    now: checked,
    nowFacing: nowFx.facing as FigureFacing,
    nowWhoAlias: whoIndex >= 0 ? fx.characters[whoIndex].alias : null,
    characters,
    things,
    parts,
    aliases: stage.aliases,
    messages,
    state,
    shots,
    lensMm: nowFx.camera.mm,
    distanceM: nowFx.camera.distanceM,
  };
}

/** The page's facts for the reply, before the turn (plannedFacts moves them on for a turn nothing ran for). */
export function factsOf(p: PreparedEntry, words: ReplyWords, shot: ReplyFacts["shot"]): ReplyFacts {
  const stills = p.shots.filter((s) => s.kind === "still");
  const newest = stills.length > 0 ? stills.length : null;
  return {
    locale: p.locale,
    mode: p.state.mode,
    characters: p.characters.map((c) => ({ id: c.id, name: c.name })),
    characterId: p.state.characterId,
    marks: p.spec.marks.map((m) => ({ id: m.id, label: m.label })),
    cameras: p.spec.cameras.map((c) => ({ id: c.id, label: c.label })),
    things: replyThingsOf(p.spec, p.now.mark, words),
    parts: replyPartsOf(p.spec, p.now.mark),
    markId: p.state.markId,
    pose: p.state.pose,
    facing: p.nowFacing,
    cameraId: p.state.cameraId,
    frameX: p.state.frameX,
    rig: p.state.rig,
    direction: p.state.direction,
    lensMm: p.lensMm,
    distanceM: p.distanceM,
    spot: { spot: cameraSpotOf(p.now.camera, p.now.mark), facingDeg: p.now.mark.facingDeg, sensorHeightMm: sensorHeightMm(p.state.rig.sensor, p.state.rig.format) },
    credits: p.state.credits,
    takeEngine: p.state.takeEngine,
    takeFrom: pickTakeStart(p.shots, p.state.characterId, p.state.rig.format)?.n ?? null,
    newestStill: newest,
    lastStill: newest !== null ? { n: newest, status: stills[0].status === "failed" ? "failed" : stills[0].status === "succeeded" ? "succeeded" : "generating", score: null } : null,
    editsLeft: p.state.editsLeft,
    editsCap: p.state.editsCap,
    tooBig: p.state.tooBig,
    producerOn: false,
    shot,
  };
}

// ---------------------------------------------------------------------------
// The sets against the corpus.
// ---------------------------------------------------------------------------

/**
 * Whether a built set gives the aliases the corpus expects. Problems (an
 * alias a phrase names that the set doesn't give, or gives to another kind
 * of thing, colour, name or person, or a part it names otherwise) stop the
 * check; notes (a described distance, size or side the built set doesn't
 * have) are only said.
 */
export function checkFixture(fx: Fixture, set: BuiltSet, usedAliases: ReadonlySet<string>): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const mark = fx.now.mark ? set.spec.marks.find((m) => m.id === fx.now.mark) : null;
  const spot = mark ? { x: mark.x, z: mark.z, facingDeg: mark.facingDeg } : (set.spot ?? set.spec.marks[0]);
  const things = readerThings(set.spec, spot);
  const parts = readerParts(set.spec, spot);
  const characters = fx.characters.map((c) => ({ id: CHARACTER_IDS[c.name] ?? c.name, name: c.name, hasPhoto: c.hasPhoto }));
  const stage = readerStageBlock({ spec: set.spec, characters, things, parts });
  for (const c of fx.cameras) {
    const got = set.spec.cameras.find((x) => x.id === c.id);
    if (!got) problems.push(`${set.name}: camera ${c.id} is missing`);
    else if (got.label !== c.label) problems.push(`${set.name}: camera ${c.id} is "${got.label}", the corpus says "${c.label}"`);
  }
  for (const m of fx.marks) {
    const got = set.spec.marks.find((x) => x.id === m.id);
    if (!got) problems.push(`${set.name}: mark ${m.id} is missing`);
    else if (got.label !== m.label) problems.push(`${set.name}: mark ${m.id} is "${got.label}", the corpus says "${m.label}"`);
  }
  fx.characters.forEach((c, i) => {
    if (stage.aliases.people[c.alias] !== characters[i].id) problems.push(`${set.name}: ${c.alias} is not ${c.name}`);
  });
  for (const t of fx.things) {
    const key = stage.aliases.things[t.alias];
    const got = things.find((x) => x.key === key);
    if (!got) {
      (usedAliases.has(t.alias) ? problems : notes).push(`${set.name}: ${t.alias} (${t.label}) is not on the built set`);
      continue;
    }
    const wrong: string[] = [];
    if (got.kind !== t.kind) wrong.push(`a ${got.kind}`);
    if (got.label !== t.label) wrong.push(`"${got.label}"`);
    if (got.colour !== t.colour) wrong.push(got.colour);
    if (got.name !== (t.name ?? null)) wrong.push(got.name === null ? "unnamed" : `named "${got.name}"`);
    if (wrong.length > 0) (usedAliases.has(t.alias) ? problems : notes).push(`${set.name}: ${t.alias} is ${wrong.join(", ")}; the corpus says ${t.kind}, "${t.label}", ${t.colour}${t.name ? `, "${t.name}"` : ""}`);
    const where = `${got.size}, ${got.distanceM} m ${{ ahead: "ahead of them", left: "to their left", right: "to their right", behind: "behind them" }[got.where]}`;
    if (where !== `${t.size}, ${t.where}`) notes.push(`${set.name}: ${t.alias} ${t.label} is ${where} (the corpus says ${t.size}, ${t.where})`);
  }
  // The set's named parts (Helios Cut 4, step B3): each alias the corpus lists is that part, and no named part goes unlisted.
  for (const s of fx.parts ?? []) {
    const key = stage.aliases.things[s.alias];
    const got = parts.find((x) => x.key === key);
    if (!got) {
      (usedAliases.has(s.alias) ? problems : notes).push(`${set.name}: ${s.alias} (${s.name}) is not on the built set`);
      continue;
    }
    if (got.name !== s.name) (usedAliases.has(s.alias) ? problems : notes).push(`${set.name}: ${s.alias} is "${got.name}"; the corpus says "${s.name}"`);
    const where = `${got.size}, ${got.distanceM} m ${{ ahead: "ahead of them", left: "to their left", right: "to their right", behind: "behind them" }[got.where]}`;
    if (s.size !== undefined && where !== `${s.size}, ${s.where}`) notes.push(`${set.name}: ${s.alias} ${s.name} is ${where} (the corpus says ${s.size}, ${s.where})`);
  }
  if (parts.length !== (fx.parts ?? []).length) problems.push(`${set.name}: the built set names ${parts.length} parts; the corpus lists ${(fx.parts ?? []).length}`);
  // Every Astra phrase expects a card that can go: a set too big for Astra would answer with the too-big card instead.
  if (astraTooBig(set.spec)) problems.push(`${set.name}: the built set is too big for Astra to change (astra-card.ts astraTooBig)`);
  if (things.length > fx.things.length) notes.push(`${set.name}: the built set lists ${things.length} things; the corpus describes ${fx.things.length}`);
  return { problems, notes };
}
