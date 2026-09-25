import { describe, expect, it } from "vitest";
import { fovForLens } from "./build-scene";
import { setElements } from "./elements";
import { DEFAULT_SET_RIG, NEW_SET_RIG, sensorHeightMm } from "./rig";
import { normaliseSetSpec, type SetObject, type SetSpec } from "./set-spec";
import { SHOT_READER_STATIC } from "./shot-reading";
import { sideUnit } from "./shot-words";
import raceTrack from "./fixtures-race-track.json";
import showroomOpen from "./fixtures-showroom-open.json";
import {
  COLOUR_IDS,
  READER_BUILD_LINE,
  READER_CONTEXT_MAX,
  cameraSideOf,
  colourWord,
  normaliseReaderNow,
  normaliseReaderTurns,
  readerMessages,
  readerNowLine,
  readerStageBlock,
  readerThings,
  readerTurnsBlock,
  type ReaderCharacter,
  type ReaderNow,
} from "./reader-context";

// What the chat's reader is told about the set (Helios Cut 2, step 5,
// 2026-09-25 — operator: "Run, keep going."): STAGE, NOW and LAST TURNS,
// written on the server from checked values, held to their caps.

const specOf = (json: unknown): SetSpec => {
  const n = normaliseSetSpec(json);
  if (!n.ok) throw new Error("fixture");
  return n.spec;
};
const race = specOf(raceTrack);
const EVA = "0b0f7c1e-3a44-4c2a-9d1e-6a1f2b3c4d5e";
const MARCO = "7d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";
const LENA = "2c3d4e5f-6a7b-4c8d-9e0f-a1b2c3d4e5f6";
const CAST: ReaderCharacter[] = [
  { id: EVA, name: "Eva", hasPhoto: true },
  { id: MARCO, name: "Marco", hasPhoto: true },
  { id: LENA, name: "Lena", hasPhoto: false },
];
const CAST_IDS = CAST.map((c) => c.id);

/** The race set with a second copy of its car, 8 m along; `body` repaints the copy's largest block (its tyres stay tyres). */
function withSecondCar(body?: string): SetSpec {
  const car = setElements(race).find((e) => e.kind === "car");
  if (!car) throw new Error("the race set has its car");
  const members = [...new Set(car.members.map(([o]) => o))];
  const volume = (o: SetObject) => o.size[0] * o.size[1] * o.size[2];
  const largest = members.reduce((a, b) => (volume(race.objects[b]) > volume(race.objects[a]) ? b : a));
  const copies = members.map((i) => {
    const o = race.objects[i];
    return { ...o, position: [o.position[0] + 8, o.position[1], o.position[2]] as SetObject["position"], color: body && i === largest ? body : o.color };
  });
  return specOf({ ...race, objects: [...race.objects, ...copies] });
}

/** A set of `n` loose crates in a row along +x, 3 m apart, starting 2 m out. */
function crates(n: number): SetSpec {
  const objects = Array.from({ length: n }, (_, i) => ({
    shape: "box",
    position: [2 + i * 3, 0.3, 0],
    rotation: [0, 0, 0],
    size: [0.6, 0.6, 0.6],
    color: "#8a5a2b",
    roughness: 0.8,
    metalness: 0,
    castShadow: true,
  }));
  return specOf({ ...race, bounds: { x: 120, z: 40, height: 10 }, objects });
}

function nowOf(over: Partial<ReaderNow> = {}, spec: SetSpec = race): ReaderNow {
  const mark = spec.marks[0];
  const cam = spec.cameras.find((c) => c.id === "c2") ?? spec.cameras[0];
  const checked = normaliseReaderNow(
    {
      who: MARCO,
      markId: mark.id,
      mark: { x: mark.x, z: mark.z, facingDeg: mark.facingDeg },
      pose: "stand",
      gaze: null,
      cameraId: cam.id,
      camera: { position: cam.position, target: cam.target, fovDeg: cam.fovDeg },
      frameX: "centre",
      rig: NEW_SET_RIG,
      direction: "She leans on the car and looks back.",
      ...over,
    },
    spec,
    CAST_IDS,
  );
  if (!checked) throw new Error("now");
  return checked;
}

function blocks(now: ReaderNow, spec: SetSpec = race, origin: "build" | null = null) {
  const things = readerThings(spec, now.mark);
  const stage = readerStageBlock({ spec, characters: CAST, things, keep: now.who });
  const line = readerNowLine(now, { spec, characters: CAST, aliases: stage.aliases, things, origin });
  return { things, stage, line };
}

describe("NOW, written on the server from checked values", () => {
  it("says who, where, the camera, the look and what happens, in the spec's shape", () => {
    const { line } = blocks(nowOf());
    expect(line.startsWith("NOW\nWho: p2 Marco. On m1 Starting grid, facing ")).toBe(true);
    expect(line).toContain("Camera: c2 Front three quarter, ");
    expect(line).toContain("Look: 16:9; everything else as built.");
    expect(line.endsWith('What happens: "She leans on the car and looks back."')).toBe(true);
    expect(line.length).toBeLessThanOrEqual(READER_CONTEXT_MAX.now);
  });

  it("reads the frame from the normalised rig: a new set's saved rig is 16:9, a set with no rig the square", () => {
    expect(blocks(nowOf({ rig: NEW_SET_RIG })).line).toContain("Look: 16:9;");
    expect(blocks(nowOf({ rig: undefined as unknown as ReaderNow["rig"] })).line).toContain("Look: 1:1;");
    expect(blocks(nowOf({ rig: { format: "vertical", squeeze: 2 } as unknown as ReaderNow["rig"] })).line).toContain("Look: 9:16, 2x squeeze;");
    expect(blocks(nowOf({ rig: { format: "made-up" } as unknown as ReaderNow["rig"] })).line).toContain("Look: 1:1;");
  });

  it("names only what is not as built, in the reader's own look ids", () => {
    const rig = { ...NEW_SET_RIG, time: 17.5, light: { scheme: "contre-jour", azimuthDeg: 190, elevationDeg: 5 }, stock: "film35", lens: "anamorphic", palette: "silver-print", era: "1970s", genre: "noir", stop: 2, ev: 1 };
    const { line } = blocks(nowOf({ rig: rig as ReaderNow["rig"] }));
    expect(line).toContain("Look: 16:9; genre:noir, light:contre-jour, time:golden (17:30), stop:2, stock:film35, character:anamorphic, palette:silver-print, era:1970s, exposure +3 thirds; everything else as built.");
    expect(blocks(nowOf({ rig: { ...NEW_SET_RIG, time: 18.25 } })).line).toContain("hour 18:15");
  });

  it("drops a forged id: no one, a spot of their own, a free camera", () => {
    const now = nowOf({ who: "11111111-2222-4333-8444-555555555555", markId: "m9", cameraId: "c9" });
    expect(now.who).toBeNull();
    expect(now.markId).toBeNull();
    expect(now.cameraId).toBeNull();
    const { line } = blocks(now);
    expect(line).toContain("Who: no one yet. On a spot of their own, facing ");
    expect(line).toContain("Camera: Free camera, ");
  });

  it("says the frame's third, the pose and the eye-line in words", () => {
    expect(blocks(nowOf({ frameX: "left_third" })).line).toContain(", on the left third.");
    expect(blocks(nowOf({ frameX: "right_third" })).line).toContain(", on the right third.");
    expect(blocks(nowOf({ frameX: "top" as ReaderNow["frameX"] })).line).toContain(", centred.");
    expect(blocks(nowOf({ pose: "lean" })).line).toContain(", leaning, no eye-line.");
    expect(blocks(nowOf({ pose: "kneel" as ReaderNow["pose"] })).line).toContain(", standing, no eye-line.");
    expect(blocks(nowOf({ gaze: { at: "camera" } })).line).toContain(", eyes to the camera.");
    // An eye-line on one of the car's blocks is an eye-line on the car, by its alias.
    const carBlock = setElements(race).find((e) => e.kind === "car")!.members[0][0];
    expect(blocks(nowOf({ gaze: { at: "object", index: carBlock } })).line).toContain(", looking at t1.");
    const structure = race.objects.findIndex((_, i) => !setElements(race).some((e) => e.members.some(([o]) => o === i)));
    expect(blocks(nowOf({ gaze: { at: "object", index: structure } })).line).toContain(", looking at part of the set.");
    expect(nowOf({ gaze: { at: "object", index: 9999 } }).gaze).toBeNull();
    // Facing +Z from the origin: a point at -z is behind them, at +x to their left (people.ts sideOf).
    expect(blocks(nowOf({ gaze: { at: "point", x: 0, z: -4 } })).line).toContain(", looking back over their shoulder, out of frame.");
    expect(blocks(nowOf({ gaze: { at: "point", x: 4, z: 0 } })).line).toContain(", looking off to their left, out of frame.");
  });

  it("says which way they face and which side the camera is on, by the figure's own front", () => {
    const mark = { x: 0, z: 0, facingDeg: 0 };
    const at = (side: Parameters<typeof sideUnit>[0]) => {
      const [ux, uz] = sideUnit(side, 0);
      return { position: [ux * 3, 1.45, uz * 3] as [number, number, number], target: [0, 1.45, 0] as [number, number, number], fovDeg: 27 };
    };
    for (const side of ["front", "front_left", "front_right", "left", "right", "back_left", "back_right", "back"] as const) {
      expect(cameraSideOf(mark, at(side)), side).toBe(side);
    }
    const line = (facingDeg: number) => blocks(nowOf({ markId: null, mark: { x: 0, z: 0, facingDeg }, cameraId: null, camera: at("front") })).line;
    expect(line(0)).toContain("facing the camera,");
    expect(line(180)).toContain("facing away,");
    // Turned to the camera's right (shot-words.ts facingFor: heading − 90°).
    expect(line(90)).toContain("facing frame right,");
    expect(line(270)).toContain("facing frame left,");
    expect(line(0)).toContain("from the front, level,");
  });

  it("gives the lens on the rig's own body, and the camera's height, distance and tilt", () => {
    const camera = { position: [0, 1.45, 2.4] as [number, number, number], target: [0, 1.45, 0] as [number, number, number], fovDeg: fovForLens(50) };
    const base = { markId: null, mark: { x: 0, z: 0, facingDeg: 0 }, cameraId: null, camera };
    expect(blocks(nowOf(base)).line).toContain("Camera: Free camera, 50 mm, 1.45 m high, 2.4 m away, from the front, level, centred.");
    const s35 = { ...NEW_SET_RIG, sensor: "super35" as const };
    const on35 = { ...camera, fovDeg: fovForLens(50, sensorHeightMm("super35", "wide")) };
    expect(blocks(nowOf({ ...base, camera: on35, rig: s35 })).line).toContain(", 50 mm,");
    const down = { ...camera, position: [0, 3.45, 2] as [number, number, number], target: [0, 1.45, 0] as [number, number, number] };
    expect(blocks(nowOf({ ...base, camera: down })).line).toContain("tilted down 45°");
  });

  it("holds numbers to the stage, and falls back to the named camera for one that isn't a pose", () => {
    const now = nowOf({ mark: { x: 999, z: -999, facingDeg: -90 }, camera: { position: [0, 999, 0], target: [0, 0, 0], fovDeg: 500 } });
    expect(now.mark).toEqual({ x: 50, z: -60, facingDeg: 270 });
    expect(now.camera.position[1]).toBe(race.bounds.height * 2);
    expect(now.camera.fovDeg).toBe(92);
    const c2 = race.cameras.find((c) => c.id === "c2")!;
    expect(nowOf({ camera: "anywhere" as unknown as ReaderNow["camera"] }).camera).toEqual({ position: c2.position, target: c2.target, fovDeg: c2.fovDeg });
    expect(nowOf({ camera: { position: [1, 1, 1], target: [1, 1, 1], fovDeg: 40 } }).camera.position).toEqual(c2.position);
    expect(normaliseReaderNow("NOW", race, CAST_IDS)).toBeNull();
    expect(normaliseReaderNow(null, race, CAST_IDS)).toBeNull();
    expect(normaliseReaderNow([], race, CAST_IDS)).toBeNull();
  });

  it("cleans what happens as the shot action does, and shortens it first to stay within 600 characters", () => {
    expect(nowOf({ direction: "She waves\n‮and laughs" }).direction).toBe("She waves and laughs");
    expect(nowOf({ direction: 42 as unknown as string }).direction).toBe("");
    expect(blocks(nowOf({ direction: "" })).line.endsWith("What happens: nothing yet.")).toBe(true);
    const long = Array.from({ length: 60 }, (_, i) => `beat${i}`).join(" ");
    const spec = specOf({
      ...raceTrack,
      cameras: race.cameras.map((c) => ({ ...c, label: `${c.label} ${"x".repeat(40)}` })),
      marks: race.marks.map((m) => ({ ...m, label: `${m.label} ${"y".repeat(40)}` })),
    });
    const rig = { ...NEW_SET_RIG, time: 17.5, light: { scheme: "contre-jour", azimuthDeg: 190, elevationDeg: 5 }, stock: "film35", lens: "anamorphic", palette: "silver-print", era: "1970s", genre: "noir", stop: 2, ev: 1 };
    const now = nowOf({ direction: long, rig: rig as ReaderNow["rig"] }, spec);
    expect(now.direction.length).toBe(300);
    const { line } = blocks(now, spec);
    expect(Array.from(line).length).toBeLessThanOrEqual(600);
    expect(line).toContain('What happens: "Beat0'.replace("B", "b"));
    expect(line.endsWith('…"')).toBe(true);
  });

  it("adds the build line only on the Sets home's own first message", () => {
    const plain = blocks(nowOf()).line;
    const built = blocks(nowOf(), race, "build").line;
    expect(plain).not.toContain(READER_BUILD_LINE);
    expect(built).toBe(`${plain}\n${READER_BUILD_LINE}`);
    expect(READER_BUILD_LINE).toHaveLength(74);
  });
});

describe("THINGS", () => {
  it("lists the race set's one car as 'the car', red, by its size, distance and side", () => {
    const { things, stage } = blocks(nowOf());
    expect(things).toHaveLength(1);
    expect(things[0]).toMatchObject({ kind: "car", label: "the car", colour: "red" });
    expect(things[0].size).toMatch(/^\d+(\.\d)? m long$/);
    expect(stage.text).toMatch(/\nTHINGS: t1: the car, red, [\d.]+ m long, [\d.]+ m (ahead of them|to their left|to their right|behind them)\.$/);
    expect(stage.aliases.things).toEqual({ t1: things[0].key });
  });

  it("numbers two cars the page's way, and says both are red when both are", () => {
    const two = withSecondCar();
    const things = readerThings(two, two.marks[0]);
    const cars = things.filter((t) => t.kind === "car");
    expect(cars.map((c) => c.label).sort()).toEqual(["Car 1", "Car 2"]);
    expect(cars.map((c) => c.colour)).toEqual(["red", "red"]);
    // A second car painted blue is "blue", by its largest block.
    const blue = withSecondCar("#1e5bd6");
    const blueCars = readerThings(blue, blue.marks[0]).filter((t) => t.kind === "car");
    expect(blueCars.map((c) => c.colour).sort()).toEqual(["blue", "red"]);
  });

  it("keeps the twelve nearest, nearest first, each an object by its height", () => {
    const spec = crates(15);
    const things = readerThings(spec, { x: 0, z: 0, facingDeg: 0 });
    expect(things).toHaveLength(12);
    expect(things.map((t) => t.distanceM)).toEqual([...things.map((t) => t.distanceM)].sort((a, b) => a - b));
    expect(things[0]).toMatchObject({ label: "Object 1", size: "0.6 m tall", colour: "brown", distanceM: 1.7, where: "left" });
    expect(things.map((t) => t.label)).not.toContain("Object 15");
    const { text, aliases } = readerStageBlock({ spec, characters: CAST, things });
    expect(Object.keys(aliases.things)).toEqual(Array.from({ length: 12 }, (_, i) => `t${i + 1}`));
    expect(text).toContain("t1: Object 1, brown, 0.6 m tall, 1.7 m to their left;");
  });

  it("says 'none' when the set has no things, and names every character with the photo they lack", () => {
    const empty: SetSpec = { ...race, objects: [] };
    const { text, aliases } = readerStageBlock({ spec: empty, characters: CAST, things: readerThings(empty, empty.marks[0]) });
    expect(text).toBe(
      "STAGE\nCameras: c1: Circuit establishing; c2: Front three quarter; c3: Low rear wing.\nMarks: m1: Starting grid; m2: Trackside apron.\nCharacters: p1: Eva; p2: Marco; p3: Lena (no photo yet).\nTHINGS: none.",
    );
    expect(aliases).toEqual({ things: {}, people: { p1: EVA, p2: MARCO, p3: LENA } });
  });
});

describe("the aliases", () => {
  it("become thing1… and person1… when a camera or a mark already has a t or p name", () => {
    // Built by hand: normaliseSetSpec names every camera c1… and every mark m1….
    const spec: SetSpec = { ...race, cameras: race.cameras.map((c, i) => (i === 0 ? { ...c, id: "t1" } : c)) };
    const { text, aliases } = readerStageBlock({ spec, characters: CAST, things: readerThings(spec, spec.marks[0]) });
    expect(Object.keys(aliases.things)).toEqual(["thing1"]);
    expect(Object.keys(aliases.people)).toEqual(["person1", "person2", "person3"]);
    expect(text).toContain("Characters: person1: Eva; person2: Marco;");
    const marks: SetSpec = { ...race, marks: race.marks.map((m, i) => (i === 1 ? { ...m, id: "p2" } : m)) };
    expect(Object.keys(readerStageBlock({ spec: marks, characters: CAST, things: [] }).aliases.people)).toEqual(["person1", "person2", "person3"]);
    // c1, m1 and a t9 no alias reaches leave them short.
    const far: SetSpec = { ...race, cameras: race.cameras.map((c, i) => (i === 0 ? { ...c, id: "t9" } : c)) };
    expect(Object.keys(readerStageBlock({ spec: far, characters: CAST, things: readerThings(far, far.marks[0]) }).aliases.things)).toEqual(["t1"]);
  });

  it("name the one in the frame in NOW by the alias STAGE gave them", () => {
    const spec: SetSpec = { ...race, cameras: race.cameras.map((c, i) => (i === 0 ? { ...c, id: "p1" } : c)) };
    const now = nowOf({ cameraId: "c2" }, spec);
    expect(blocks(now, spec).line).toContain("Who: person2 Marco.");
  });
});

describe("STAGE's cap", () => {
  const many: ReaderCharacter[] = Array.from({ length: 20 }, (_, i) => ({ id: `id-${i}`, name: `Character number ${i} ${"n".repeat(30)}`, hasPhoto: i % 2 === 0 }));

  it("stays within 1,500 characters by letting the farthest things go first", () => {
    const spec = crates(15);
    const things = readerThings(spec, spec.marks[0]);
    const { text, aliases } = readerStageBlock({ spec, characters: many, things, keep: "id-19" });
    expect(text.length).toBeLessThanOrEqual(1500);
    const kept = Object.values(aliases.things);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(12);
    // The nearest ones, in order.
    expect(kept).toEqual(things.slice(0, kept.length).map((t) => t.key));
    expect(Object.keys(aliases.people)).toHaveLength(20);
    // Names are held to a label's length.
    expect(text).not.toContain("n".repeat(31));
  });

  it("then lets characters go from the end, never the one in the frame", () => {
    const long = (s: string) => `${s} ${"z".repeat(40)}`.slice(0, 40);
    const spec: SetSpec = {
      ...crates(15),
      cameras: Array.from({ length: 6 }, (_, i) => ({ ...race.cameras[0], id: `c${i + 1}`, label: long(`Camera ${i + 1}`) })),
      marks: Array.from({ length: 4 }, (_, i) => ({ ...race.marks[0], id: `m${i + 1}`, label: long(`Mark ${i + 1}`) })),
    };
    const things = readerThings(spec, spec.marks[0]);
    const { text, aliases } = readerStageBlock({ spec, characters: many, things, keep: "id-19" });
    expect(text.length).toBeLessThanOrEqual(1500);
    expect(Object.keys(aliases.things)).toHaveLength(0);
    expect(Object.values(aliases.people)).toContain("id-19");
    expect(Object.values(aliases.people)).toContain("id-0");
    expect(Object.keys(aliases.people).length).toBeLessThan(20);
    // The one kept keeps the alias its place gave it.
    expect(aliases.people.p20).toBe("id-19");
  });

  it("keeps every thing and person while they fit", () => {
    const spec = crates(15);
    const { aliases } = readerStageBlock({ spec, characters: CAST, things: readerThings(spec, spec.marks[0]) });
    expect(Object.keys(aliases.things)).toHaveLength(12);
    expect(Object.keys(aliases.people)).toHaveLength(3);
  });
});

describe("colour words", () => {
  it("name each of the fifteen", () => {
    const samples: Record<(typeof COLOUR_IDS)[number], string> = {
      red: "#d62828",
      orange: "#f77f00",
      yellow: "#f5d000",
      olive: "#6b6b1f",
      green: "#2a9d3a",
      teal: "#1f8a80",
      cyan: "#22c7e0",
      blue: "#1e5bd6",
      navy: "#14213d",
      purple: "#7b2cbf",
      pink: "#ff69b4",
      brown: "#7a4a1f",
      black: "#111111",
      white: "#f5f5f5",
      grey: "#8a8a8a",
    };
    for (const id of COLOUR_IDS) expect(colourWord(samples[id]), id).toBe(id);
  });

  it("read short hex, a dark red as red, a pale red as pink, and anything else as grey", () => {
    expect(colourWord("#f00")).toBe("red");
    expect(colourWord("#8b0000")).toBe("red");
    expect(colourWord("#ffb6c1")).toBe("pink");
    expect(colourWord("#000")).toBe("black");
    expect(colourWord("#ffffff")).toBe("white");
    expect(colourWord("#2f2f2f")).toBe("black");
    expect(colourWord("#555555")).toBe("grey");
    expect(colourWord("#8b4513")).toBe("brown");
    expect(colourWord("#a0522d")).toBe("brown");
    expect(colourWord("#ff8c00")).toBe("orange");
    expect(colourWord("not a colour")).toBe("grey");
  });
});

describe("LAST TURNS", () => {
  it("keep the last three, each side at most 200 characters, in the spec's shape", () => {
    const turns = normaliseReaderTurns([
      { said: "one", did: "a" },
      { said: "two", did: "b" },
      "junk",
      { said: "", did: "nothing said" },
      { said: "three", did: "" },
      { said: `four ${"w".repeat(300)}`, did: "near t1 beside; pose lean; happens set" },
    ]);
    expect(turns.map((t) => t.said.slice(0, 5))).toEqual(["two", "three", "four "]);
    expect(turns[2].said.length).toBe(200);
    const block = readerTurnsBlock(turns);
    expect(block.split("\n")[0]).toBe("LAST TURNS");
    expect(block.split("\n")[1]).toBe("You: two -> did: b");
    expect(block.split("\n")[2]).toBe("You: three -> did: nothing");
    expect(block.length).toBeLessThanOrEqual(1300);
    expect(readerTurnsBlock([])).toBe("");
    expect(normaliseReaderTurns("turns")).toEqual([]);
  });
});

describe("the messages one reading sends", () => {
  it("put the fixed instructions first, then this set's blocks, then the person's words", () => {
    const now = nowOf();
    const { stage, line } = blocks(now);
    const turns = readerTurnsBlock([{ said: "she leans on the car", did: "near t1 beside; pose lean; happens set" }]);
    const long = `make it night ${"x".repeat(700)}`;
    const messages = readerMessages(stage.text, line, turns, long);
    expect(messages.map((m) => m.role)).toEqual(["system", "system", "user"]);
    expect(messages[0].content).toBe(SHOT_READER_STATIC);
    expect(messages[1].content).toBe(`${stage.text}\n${line}\n${turns}`);
    expect(messages[2].content.length).toBe(600);
    expect(readerMessages(stage.text, line, "", "hi")[1].content).toBe(`${stage.text}\n${line}`);
  });

  it("keep the typical race-set turn near the spec's measured size", () => {
    const { stage, line } = blocks(nowOf());
    const turns = readerTurnsBlock([{ said: "she leans on the car", did: "near t1 beside; pose lean; happens set" }]);
    const total = readerMessages(stage.text, line, turns, "Eva leans on the car, golden hour").reduce((n, m) => n + m.content.length, 0);
    expect(total).toBeLessThan(7000);
    expect(total).toBeGreaterThan(6500);
  });
});

describe("a set with its default rig still reads", () => {
  it("uses DEFAULT_SET_RIG's square when the page sends no rig", () => {
    expect(nowOf({ rig: undefined as unknown as ReaderNow["rig"] }).rig).toEqual(DEFAULT_SET_RIG);
  });
});

it("reads the showroom fixture without a word from the model", () => {
  const spec = specOf(showroomOpen);
  const things = readerThings(spec, spec.marks[0]);
  expect(things[0]).toMatchObject({ kind: "car", label: "the car" });
  const { text } = readerStageBlock({ spec, characters: CAST, things });
  expect(text.length).toBeLessThanOrEqual(1500);
  expect(text).not.toMatch(/[cvo]_[0-9a-f]{8}_/);
  expect(text).not.toContain(EVA);
});
