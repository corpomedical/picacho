import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LENSES_MM } from "./build-scene";
import { rigCommandIds } from "./commands";
import { FILM_MOVES, FILM_TEXTURES } from "./moves";
import { STAND_POSES } from "./set-spec";
import { CAMERA_HEIGHTS, CAMERA_SIDES, FIGURE_FACINGS, SHOT_SIZES } from "./shot-words";
import { SET_TAKE_ENGINES } from "./take";
import {
  ASK_TOPICS,
  CANT_CODES,
  FRAME_XS,
  GAZE_SIDES,
  NEAR_SIDES,
  READER_ENGINES,
  READER_RIG_IDS,
  READER_STEPS,
  SHOT_READER_IDEAS,
  SHOT_READER_MAX_COMPLETION,
  SHOT_READER_STATIC,
  SHOT_READER_V2_OPEN_TO_ALL,
  TURN_WORDS,
  composeHappens,
  exactPiece,
  isQuestionOnly,
  isUndoOnly,
  parseShotReading,
  type ShotReadingContext,
} from "./shot-reading";

// The reader's contract, v2 (Helios Cut 2, step 4, 2026-09-25 — operator:
// "Run, keep going."): what the model answers is held to the set, and the
// words that reach a picture or Astra are only ever the person's own.

const CAR = "c_1a2b3c4d_-30_0";
const CAR2 = "c_5e6f7a8b_30_0";
const BOX = "o_9c0d1e2f_0_-60";
const CAR3 = "c_aaaaaaaa_0_90";
const EVA = "0b0f7c1e-3a44-4c2a-9d1e-6a1f2b3c4d5e";
const MARCO = "7d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";

const MESSAGE = "Eva leans on the car, golden hour, anamorphic, 35mm film grain, low angle";

function ctx(over: Partial<ShotReadingContext> = {}): ShotReadingContext {
  return {
    spec: {
      cameras: [
        { id: "c1", label: "Circuit establishing", position: [0, 8, 30], target: [0, 1, 0], fovDeg: 40 },
        { id: "c2", label: "Front three quarter", position: [2, 1.45, 3], target: [0, 1, 0], fovDeg: 27 },
        { id: "c3", label: "Low rear wing", position: [-3, 0.6, -2], target: [0, 1, 0], fovDeg: 40 },
      ],
      marks: [
        { id: "m1", label: "Starting grid", x: 0, z: 0, facingDeg: 0 },
        { id: "m2", label: "Trackside apron", x: 6, z: 4, facingDeg: 90 },
      ],
    },
    aliases: { things: { t1: CAR, t2: BOX, t3: CAR2, t4: CAR3 }, people: { p1: EVA, p2: MARCO } },
    message: MESSAGE,
    nowHappens: "She leans on the car and looks back.",
    ...over,
  };
}
const read = (answer: unknown, over: Partial<ShotReadingContext> = {}) => {
  const out = parseShotReading(typeof answer === "string" ? answer : JSON.stringify(answer), ctx(over));
  expect(out).not.toBeNull();
  return out!;
};

describe("the model's answer, held to the set", () => {
  it("reads exchange 1 whole: many instructions in one breath, every alias mapped back, nothing dropped", () => {
    const { reading, dropped } = read({
      who: "p1",
      happens: { add: ["Eva leans on the car"] },
      near: { thing: "t1", side: "beside" },
      pose: "lean",
      height: "low",
      rig: ["time:golden", "character:anamorphic", "stock:film35"],
    });
    expect(dropped).toEqual([]);
    expect(reading).toEqual({
      characterId: EVA,
      happens: { keep: [], add: ["Eva leans on the car"] },
      near: { thing: { key: CAR }, side: "beside" },
      pose: "lean",
      height: "low",
      rig: ["time:golden", "character:anamorphic", "stock:film35"],
    });
  });

  it("keeps every valid key, in the reading's own names", () => {
    const { reading, dropped } = read(
      {
        shoot: true,
        mark: "m2",
        nudge: { right: 0.5, toward: -1 },
        turn: "around",
        facing: "left",
        gaze: "camera",
        camera_id: "c2",
        side: "back_left",
        size: "close_up",
        tilt_deg: -12,
        lens_mm: 85,
        frame_x: "right_third",
        steps: ["closer", "closer", "other_side"],
        look: "newest",
        hour: 18.5,
        ev: 3,
        move: "push-in",
        textures: ["slow-motion", "handheld"],
        engine: "veo",
        wardrobe: true,
        ask: ["lens", "edits_left"],
        idea: "A low sun behind him makes a rim.",
      },
      { message: "whatever they said" },
    );
    expect(dropped).toEqual([]);
    expect(reading).toMatchObject({
      shoot: true,
      markId: "m2",
      nudge: { right: 0.5, toward: -1 },
      turn: "around",
      facing: "left",
      gaze: "camera",
      cameraId: "c2",
      side: "back_left",
      size: "close_up",
      tiltDeg: -12,
      lensMm: 85,
      frameX: "right_third",
      steps: ["closer", "closer", "other_side"],
      look: "newest",
      hour: 18.5,
      evThirds: 3,
      move: "push-in",
      textures: ["slow-motion", "handheld"],
      engine: "veo",
      wardrobe: true,
      ask: ["lens", "edits_left"],
      idea: "A low sun behind him makes a rim.",
    });
  });

  it("drops every value that is not on its list, names it, and guesses nothing", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ who: "p9" }, "who"],
      [{ who: EVA }, "who"],
      [{ mark: "m9" }, "mark"],
      [{ camera_id: "c9" }, "camera_id"],
      [{ side: "above" }, "side"],
      [{ size: "huge" }, "size"],
      [{ height: "sky" }, "height"],
      [{ lens_mm: 55 }, "lens_mm"],
      [{ lens_mm: "50" }, "lens_mm"],
      [{ frame_x: "top" }, "frame_x"],
      [{ pose: "kneel" }, "pose"],
      [{ turn: "back" }, "turn"],
      [{ move: "zoom" }, "move"],
      [{ engine: "sora" }, "engine"],
      [{ facing: "north" }, "facing"],
      [{ gaze: { side: "up" } }, "gaze"],
      [{ gaze: "sky" }, "gaze"],
      [{ near: { thing: "t1", side: "on" } }, "near"],
      [{ nudge: "a bit" }, "nudge"],
      [{ look: "latest" }, "look"],
      [{ look: 0 }, "look"],
      [{ look: 2.5 }, "look"],
      [{ tilt_deg: "down" }, "tilt_deg"],
      [{ hour: "dusk" }, "hour"],
      [{ ev: "brighter" }, "ev"],
      [{ shoot: "yes" }, "shoot"],
      [{ undo: 1 }, "undo"],
      [{ idea: 42 }, "idea"],
    ];
    for (const [answer, name] of cases) {
      const { reading, dropped } = read(answer);
      expect(reading, JSON.stringify(answer)).toEqual({});
      expect(dropped, JSON.stringify(answer)).toEqual([name]);
    }
  });

  it("keeps the good parts of a list and names the bad ones", () => {
    const { reading, dropped } = read({ steps: ["closer", "jump", "lower"], textures: ["grain", "handheld", "handheld"], ask: ["price", "cost", "cost"] });
    expect(reading.steps).toEqual(["closer", "lower"]);
    expect(reading.textures).toEqual(["handheld"]);
    expect(reading.ask).toEqual(["cost"]);
    expect(dropped).toEqual(["steps", "textures", "ask"]);
  });

  it("caps the lists: four steps, three textures, four questions", () => {
    const { reading, dropped } = read({
      steps: ["closer", "closer", "closer", "closer", "closer"],
      ask: ["lens", "focus", "format", "light", "look"],
    });
    expect(reading.steps).toHaveLength(4);
    expect(reading.ask).toEqual(["lens", "focus", "format", "light"]);
    expect(dropped).toEqual(["steps", "ask"]);
  });

  it("clamps its numbers: tilt, hour, exposure, a nudge", () => {
    expect(read({ tilt_deg: 45 }).reading.tiltDeg).toBe(20);
    expect(read({ tilt_deg: -120 }).reading.tiltDeg).toBe(-80);
    expect(read({ tilt_deg: 7.4 }).reading.tiltDeg).toBe(7);
    expect(read({ tilt_deg: -0.2 }).reading.tiltDeg).toBe(0);
    expect(read({ hour: 3 }).reading.hour).toBe(5);
    expect(read({ hour: 23.9 }).reading.hour).toBe(22);
    expect(read({ hour: 18.6 }).reading.hour).toBe(18.5);
    expect(read({ hour: 6.13 }).reading.hour).toBe(6.25);
    expect(read({ ev: 12 }).reading.evThirds).toBe(9);
    expect(read({ ev: -1.4 }).reading.evThirds).toBe(-1);
    expect(read({ ev: 0 })).toEqual({ reading: {}, dropped: [] });
    expect(read({ nudge: { right: 14.26, toward: -0.44 } }).reading.nudge).toEqual({ right: 10, toward: -0.4 });
    expect(read({ nudge: { toward: 2 } }).reading.nudge).toEqual({ right: 0, toward: 2 });
    expect(read({ nudge: { right: 0.01 } })).toEqual({ reading: {}, dropped: [] });
    expect(read({ look: 3 }).reading.look).toBe(3);
    expect(read({ look: "off" }).reading.look).toBe("off");
  });

  it("maps things back, asks which one for a list, and names aliases it does not know", () => {
    expect(read({ near: { thing: ["t1", "t3"], side: "front" } })).toEqual({ reading: { near: { thing: { candidates: [CAR, CAR2] }, side: "front" } }, dropped: [] });
    expect(read({ near: { thing: ["t1", "t9"], side: "front" } })).toEqual({ reading: { near: { thing: { key: CAR }, side: "front" } }, dropped: ["near.thing"] });
    expect(read({ near: { thing: ["t1", "t1"], side: "back" } })).toEqual({ reading: { near: { thing: { key: CAR }, side: "back" } }, dropped: [] });
    expect(read({ near: { thing: "t9", side: "front" } })).toEqual({ reading: {}, dropped: ["near.thing", "near"] });
    expect(read({ near: { thing: CAR, side: "front" } }).dropped).toEqual(["near.thing", "near"]);
    const four = read({ near: { thing: ["t1", "t2", "t3", "t4"], side: "beside" } });
    expect(four.reading.near?.thing).toEqual({ candidates: [CAR, BOX, CAR2] });
    expect(four.dropped).toEqual(["near.thing"]);
    expect(read({ facing: { thing: "t2" } }).reading.facing).toEqual({ key: BOX });
    expect(read({ facing: { thing: ["t1", "t3"] } }).reading.facing).toEqual({ candidates: [CAR, CAR2] });
    expect(read({ gaze: { thing: "t1" } }).reading.gaze).toEqual({ key: CAR });
    expect(read({ gaze: { thing: ["t1", "t3"] } }).reading.gaze).toEqual({ candidates: [CAR, CAR2] });
    expect(read({ gaze: { side: "behind" } }).reading.gaze).toEqual({ side: "behind" });
    expect(read({ gaze: "none" }).reading.gaze).toBe("none");
    expect(read({ gaze: { thing: "t9" } })).toEqual({ reading: {}, dropped: ["gaze.thing", "gaze"] });
    expect(read({ who: "p2" }).reading.characterId).toBe(MARCO);
    // An alias is looked up as the map's own key, never through the prototype.
    expect(read({ who: "constructor" })).toEqual({ reading: {}, dropped: ["who"] });
  });

  it("keeps a named camera with the side, size, lens and third said with it", () => {
    const { reading, dropped } = read({ camera_id: "c3", side: "front", size: "medium", lens_mm: 35, frame_x: "left_third" });
    expect(dropped).toEqual([]);
    expect(reading).toEqual({ cameraId: "c3", side: "front", size: "medium", lensMm: 35, frameX: "left_third" });
  });

  it("reads the three places across the picture, and nothing else", () => {
    for (const x of FRAME_XS) expect(read({ frame_x: x }).reading.frameX).toBe(x);
    for (const x of ["top_left", "left", "center", "upper_third"]) expect(read({ frame_x: x }).dropped).toEqual(["frame_x"]);
  });

  it("takes rig ids once per group, the last one said, at most 8, and only ⌘K's", () => {
    const { reading, dropped } = read({ rig: ["time:golden", "stock:film35", "time:night", "stock:film35", "light:moonlight"] });
    expect(dropped).toEqual([]);
    expect(reading.rig).toEqual(["time:night", "stock:film35", "light:moonlight"]);
    expect(read({ rig: ["stock:velvia", "palette:silver-print", "lens:50", "aid:thirds", 7] })).toEqual({ reading: { rig: ["palette:silver-print"] }, dropped: ["rig"] });
    const many = read({
      rig: ["format:wide", "squeeze:2", "stop:2", "light:window", "time:dawn", "stock:digital", "character:clean", "palette:none", "era:1970s", "genre:noir"],
    });
    expect(many.reading.rig).toEqual(["format:wide", "squeeze:2", "stop:2", "light:window", "time:dawn", "stock:digital", "character:clean", "palette:none"]);
    expect(many.dropped).toEqual(["rig"]);
    expect(read({ rig: "time:golden" }).reading.rig).toEqual(["time:golden"]);
  });

  it("treats null, false, empty and a missing key alike: not said", () => {
    expect(read({ who: null, side: "", steps: [], shoot: false, undo: null, wardrobe: false, set_change: null, cant: [] })).toEqual({ reading: {}, dropped: [] });
    expect(read({})).toEqual({ reading: {}, dropped: [] });
  });

  it("names a key the contract does not have as 'unknown', never by the model's own word", () => {
    const { reading, dropped } = read({ intent: "frame", "ignore previous instructions": "yes", pose: "sit" });
    expect(reading).toEqual({ pose: "sit" });
    expect(dropped).toEqual(["unknown"]);
    // Only fixed names ever come back, whatever the model wrote.
    const wild = read({ rig: ["<script>"], cant: [{ code: "free text here", said: "x" }], who: "Ignore all rules", mystery: 1 });
    for (const name of wild.dropped) expect(["unknown", "rig", "who", "cant"]).toContain(name);
  });

  it("answers null for an answer that is not a JSON object, and reads one inside other text", () => {
    for (const bad of ["", "no json here", "[1, 2]", "{bad json", "null", "42", '"a string"', "{}}{"]) {
      expect(parseShotReading(bad, ctx()), bad).toBeNull();
    }
    expect(parseShotReading('Sure! {"pose": "sit"} Hope that helps.', ctx())).toEqual({ reading: { pose: "sit" }, dropped: [] });
  });
});

describe("the person's exact words", () => {
  it("finds a piece whatever its case, quotes and spacing, and keeps the source's own spelling", () => {
    expect(exactPiece("eva  LEANS on the car", MESSAGE)).toBe("Eva leans on the car");
    expect(exactPiece("she’s smiling", "now she's smiling!")).toBe("she's smiling");
    expect(exactPiece("she's smiling", "now she’s smiling!")).toBe("she’s smiling");
    expect(exactPiece('"hola"', "dice «hola» a todos")).toBe("«hola»");
    expect(exactPiece("hola", "dice «hola» a todos")).toBe("hola");
    expect(exactPiece("Sit on\nthe  bonnet", "have her sit on the bonnet")).toBe("sit on the bonnet");
    // Composed and decomposed accents are one letter.
    expect(exactPiece("café", "un café por favor")).toBe("café");
  });

  it("trims the joining marks a piece ends on, and forgives a full stop or quotes the model put round it", () => {
    expect(exactPiece("Eva leans on the car,", MESSAGE)).toBe("Eva leans on the car");
    expect(exactPiece("Eva leans on the car.", MESSAGE)).toBe("Eva leans on the car");
    expect(exactPiece("“low angle”", MESSAGE)).toBe("low angle");
    expect(exactPiece("take it!", "ok take it!")).toBe("take it!");
    expect(exactPiece(" — then she drives off", "Dutch angle — then she drives off")).toBe("then she drives off");
  });

  it("refuses a paraphrase, a translation, a summary and anything but text", () => {
    expect(exactPiece("Eva leans against the car", MESSAGE)).toBeNull();
    expect(exactPiece("Eva se apoya en el coche", MESSAGE)).toBeNull();
    expect(exactPiece("a woman by a car", MESSAGE)).toBeNull();
    expect(exactPiece("", MESSAGE)).toBeNull();
    expect(exactPiece("   ", MESSAGE)).toBeNull();
    expect(exactPiece(".", MESSAGE)).toBeNull();
    expect(exactPiece(42, MESSAGE)).toBeNull();
    expect(exactPiece(null, MESSAGE)).toBeNull();
  });

  it("quotes a 'not yet' only from the message, at most 60 characters, else says 'part of that'", () => {
    const message = "make it night, add a row of flags along the pit wall, and have her sit on the bonnet";
    expect(read({ cant: [{ code: "raise_figure", said: "sit on the bonnet" }] }, { message }).reading.cant).toEqual([{ code: "raise_figure", said: "sit on the bonnet" }]);
    expect(read({ cant: [{ code: "raise_figure", said: "sitting on top of the car" }] }, { message }).reading.cant).toEqual([{ code: "raise_figure", said: null }]);
    expect(read({ cant: [{ code: "roll" }] }, { message }).reading.cant).toEqual([{ code: "roll", said: null }]);
    const long = read({ cant: [{ code: "other", said: message }] }, { message }).reading.cant?.[0].said ?? "";
    expect(Array.from(long).length).toBeLessThanOrEqual(60);
    expect(message.startsWith(long)).toBe(true);
    expect(long).toBe("make it night, add a row of flags along the pit wall, and");
  });

  it("keeps an unlisted code as 'other', each item once, and at most five", () => {
    expect(read({ cant: [{ code: "teleport", said: "low angle" }] }).reading.cant).toEqual([{ code: "other", said: "low angle" }]);
    expect(read({ cant: ["roll", { code: "roll" }] }).reading.cant).toEqual([{ code: "roll", said: null }]);
    const six = read({ cant: ["roll", "weather", "sound", "photo", "brand", "mover"] });
    expect(six.reading.cant?.map((c) => c.code)).toEqual(["roll", "weather", "sound", "photo", "brand"]);
    expect(six.dropped).toEqual(["cant"]);
    expect(read({ cant: [7] }).dropped).toEqual(["cant"]);
  });
});

describe("what happens: the person's own pieces", () => {
  it("keeps pieces only from NOW's words and adds pieces only from the message", () => {
    const { reading, dropped } = read(
      { happens: { keep: ["She leans on the car"], add: ["she's smiling"] } },
      { message: "now she's smiling", nowHappens: "She leans on the car and looks back." },
    );
    expect(dropped).toEqual([]);
    expect(reading.happens).toEqual({ keep: ["She leans on the car"], add: ["she's smiling"] });
    expect(composeHappens(reading.happens, "She leans on the car and looks back.")).toEqual({ text: "She leans on the car. She's smiling.", cut: null });
  });

  it("drops and names a reworded piece, a kept piece NOW doesn't hold, and an added piece the message doesn't", () => {
    const now = "She leans on the car and looks back.";
    const reworded = read({ happens: { keep: ["She leans on the car"], add: ["She is smiling"] } }, { message: "now she's smiling", nowHappens: now });
    expect(reworded.reading.happens).toEqual({ keep: ["She leans on the car"], add: [] });
    expect(reworded.dropped).toEqual(["happens.add"]);
    const wrongSource = read({ happens: { keep: ["now she's smiling"] } }, { message: "now she's smiling", nowHappens: now });
    expect(wrongSource).toEqual({ reading: {}, dropped: ["happens.keep", "happens"] });
  });

  it("changes nothing when every piece failed: a failed piece never clears what happens", () => {
    const { reading, dropped } = read({ happens: { add: ["a woman laughing"] } }, { message: "make her laugh" });
    expect(reading.happens).toBeUndefined();
    expect(dropped).toEqual(["happens.add", "happens"]);
    expect(composeHappens(reading.happens, "She leans on the car.")).toEqual({ text: "She leans on the car.", cut: null });
  });

  it("clears it with {} and leaves it alone with no key", () => {
    const cleared = read({ happens: {} });
    expect(cleared).toEqual({ reading: { happens: { keep: [], add: [] } }, dropped: [] });
    expect(composeHappens(cleared.reading.happens, "She leans on the car.")).toEqual({ text: "", cut: null });
    expect(read({ happens: { keep: [], add: [] } }).reading.happens).toEqual({ keep: [], add: [] });
    expect(composeHappens(undefined, "She leans on the car.")).toEqual({ text: "She leans on the car.", cut: null });
    expect(read({ happens: "smile" }).dropped).toEqual(["happens"]);
  });

  it("orders the pieces as their sources do, says each once, and drops a piece inside another", () => {
    const message = "she waves, then she laughs";
    const { reading } = read({ happens: { keep: ["looks back", "She leans on the car", "leans on the car"], add: ["then she laughs", "she waves", "she waves"] } }, { message });
    expect(reading.happens).toEqual({ keep: ["She leans on the car", "looks back"], add: ["she waves", "then she laughs"] });
    expect(composeHappens(reading.happens, "She leans on the car and looks back.").text).toBe("She leans on the car. Looks back. She waves. Then she laughs.");
    // An added piece NOW already says is not said twice.
    expect(read({ happens: { keep: ["She leans on the car"], add: ["she leans on the car"] } }, { message: "she leans on the car" }).reading.happens).toEqual({
      keep: ["She leans on the car"],
      add: [],
    });
  });

  it("drops a piece of one letter without a word, and holds keep to 4 and add to 3", () => {
    expect(read({ happens: { add: ["a", "she waves"] } }, { message: "a she waves" })).toEqual({ reading: { happens: { keep: [], add: ["she waves"] } }, dropped: [] });
    const message = "one two, three four, five six, seven eight";
    const capped = read({ happens: { add: ["one two", "three four", "five six", "seven eight"] } }, { message });
    expect(capped.reading.happens?.add).toEqual(["one two", "three four", "five six"]);
    expect(capped.dropped).toEqual(["happens.add"]);
  });

  it("composes sentences: a capital first, a full stop unless one ends it, quotes and questions kept", () => {
    expect(composeHappens({ keep: [], add: ["she waves", "¿dónde está?", "he shouts “go!”", "3 cars pass"] }, "").text).toBe("She waves. ¿Dónde está? He shouts “go!” 3 cars pass.");
  });

  it("keeps 300 characters, cut at a word, and hands back what didn't fit", () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const out = composeHappens({ keep: [], add: [words] }, "");
    expect(Array.from(out.text).length).toBeLessThanOrEqual(300);
    expect(out.text.startsWith("Word0 word1")).toBe(true);
    expect(out.text.endsWith(" ")).toBe(false);
    expect(out.cut).not.toBeNull();
    expect(`${out.text} ${out.cut}`).toBe(`W${words.slice(1)}.`);
  });
});

describe("a change to the set itself", () => {
  const message = "make it night, add a row of flags along the pit wall, and have her sit on the bonnet";

  it("keeps their exact words and the model's gloss, capped", () => {
    const { reading, dropped } = read({ set_change: { said: "add a row of flags along the pit wall", gloss: "a row of small flags along the pit wall" } }, { message });
    expect(dropped).toEqual([]);
    expect(reading.setChange).toEqual({ said: "add a row of flags along the pit wall", gloss: "a row of small flags along the pit wall", cut: false });
    const long = read({ set_change: { said: "add a row of flags", gloss: "g".repeat(400) } }, { message }).reading.setChange;
    expect(long?.gloss).toHaveLength(200);
    expect(read({ set_change: { said: "add a row of flags" } }, { message }).reading.setChange?.gloss).toBeNull();
  });

  it("drops the whole change, and names it, when the words are not theirs: Astra is never sent the model's", () => {
    expect(read({ set_change: { said: "put flags on the wall", gloss: "flags" } }, { message })).toEqual({ reading: {}, dropped: ["set_change"] });
    expect(read({ set_change: "add flags" }, { message })).toEqual({ reading: {}, dropped: ["set_change"] });
  });

  it("quotes only what Astra reads, 300 characters, and says when they wrote more", () => {
    const longMessage = `add ${"a very long row of little red and white flags ".repeat(10)}`.trim();
    const { reading } = read({ set_change: { said: longMessage } }, { message: longMessage });
    expect(reading.setChange?.cut).toBe(true);
    expect(Array.from(reading.setChange?.said ?? "").length).toBe(300);
    expect(longMessage.startsWith(reading.setChange?.said ?? "x")).toBe(true);
  });
});

describe("suggestions", () => {
  it("carry only act keys: words, wardrobe, a set change and anything nested are stripped; at most three", () => {
    const { reading, dropped } = read({
      suggest: [
        { rig: ["light:contre-jour", "palette:amber-hour", "stop:2"], lens_mm: 85, size: "medium", height: "low", happens: { add: ["low angle"] }, wardrobe: true },
        { size: "wide", rig: ["time:night"], set_change: { said: "low angle" }, suggest: [{ size: "close_up" }], shoot: true, undo: true, ask: ["lens"], idea: "x", cant: ["roll"] },
        { side: "front" },
        { size: "full" },
      ],
    });
    expect(dropped).toEqual([]);
    expect(reading.suggest).toEqual([
      { rig: ["light:contre-jour", "palette:amber-hour", "stop:2"], lensMm: 85, size: "medium", height: "low" },
      { size: "wide", rig: ["time:night"] },
      { side: "front" },
    ]);
  });

  it("leave out a value that did not match without holding the turn, and skip an empty one", () => {
    const { reading, dropped } = read({ suggest: [{ size: "huge", side: "front" }, { happens: { add: ["x"] } }, "wide"] });
    expect(reading.suggest).toEqual([{ side: "front" }]);
    expect(dropped).toEqual(["suggest"]);
  });
});

describe("the nine example exchanges of the spec read cleanly", () => {
  it("each hand-written reading parses with nothing dropped", () => {
    const cases: [string, Record<string, unknown>][] = [
      [MESSAGE, { who: "p1", happens: { add: ["Eva leans on the car"] }, near: { thing: "t1", side: "beside" }, pose: "lean", height: "low", rig: ["time:golden", "character:anamorphic", "stock:film35"] }],
      ["no, lower — and from the other side", { steps: ["lower", "other_side"] }],
      ["undo that", { undo: true }],
      ["what lens is this, and how many Astra changes do I have?", { ask: ["lens", "edits_left"] }],
      [
        "make it night, add a row of flags along the pit wall, and have her sit on the bonnet",
        {
          rig: ["time:night"],
          pose: "sit",
          near: { thing: "t1", side: "front" },
          set_change: { said: "add a row of flags along the pit wall", gloss: "a row of small flags along the pit wall" },
          cant: [{ code: "raise_figure", said: "sit on the bonnet" }],
        },
      ],
      [
        "what would look good here?",
        {
          idea: "A low sun behind him makes a rim, and a long lens lets the track fall soft.",
          suggest: [
            { rig: ["light:contre-jour", "palette:amber-hour", "stop:2"], lens_mm: 85, size: "medium", height: "low" },
            { size: "wide", rig: ["time:night", "palette:sodium-rain", "stock:film35"] },
          ],
        },
      ],
      ["dolly in slowly on his face, in slow motion", { size: "close_up", move: "push-in", textures: ["slow-motion"] }],
      [
        "Dutch angle from inside the car, then she drives off",
        {
          cant: [
            { code: "roll", said: "Dutch angle" },
            { code: "camera_inside", said: "from inside the car" },
            { code: "film_beats", said: "then she drives off" },
          ],
          suggest: [{ height: "low", side: "front", size: "medium" }],
        },
      ],
      ["Eva junto al coche, hora dorada, en blanco y negro", { who: "p1", near: { thing: "t1", side: "beside" }, rig: ["time:golden", "palette:silver-print"] }],
      ["put her on the left third", { frame_x: "left_third" }],
    ];
    for (const [message, answer] of cases) {
      const out = read(answer, { message });
      expect(out.dropped, message).toEqual([]);
    }
    const exchange4 = read(cases[4][1], { message: cases[4][0] }).reading;
    expect(exchange4.cant).toEqual([{ code: "raise_figure", said: "sit on the bonnet" }]);
    expect(exchange4.setChange?.said).toBe("add a row of flags along the pit wall");
    const exchange7 = read(cases[7][1], { message: cases[7][0] }).reading;
    expect(exchange7.cant?.map((c) => c.said)).toEqual(["Dutch angle", "from inside the car", "then she drives off"]);
  });
});

describe("what kind of reading it is", () => {
  it("knows a question-only reading: questions, an idea or options, with nothing to do", () => {
    expect(isQuestionOnly({ ask: ["lens"] })).toBe(true);
    expect(isQuestionOnly({ idea: "x", suggest: [{ size: "wide" }] })).toBe(true);
    expect(isQuestionOnly({ ask: ["help"], cant: [{ code: "roll", said: null }] })).toBe(true);
    expect(isQuestionOnly({ ask: ["lens"], size: "wide" })).toBe(false);
    expect(isQuestionOnly({ ask: ["lens"], shoot: true })).toBe(false);
    expect(isQuestionOnly({ ask: ["lens"], happens: { keep: [], add: [] } })).toBe(false);
    expect(isQuestionOnly({ ask: ["lens"], setChange: { said: "x", gloss: null, cut: false } })).toBe(false);
    expect(isQuestionOnly({})).toBe(false);
    expect(isQuestionOnly({ cant: [{ code: "roll", said: null }] })).toBe(false);
  });

  it("knows an undo-only reading", () => {
    expect(isUndoOnly({ undo: true })).toBe(true);
    expect(isUndoOnly({ undo: true, size: "wide" })).toBe(false);
    expect(isUndoOnly({ undo: true, ask: ["lens"] })).toBe(false);
    expect(isUndoOnly({ size: "wide" })).toBe(false);
  });
});

describe("the instructions", () => {
  const source = readFileSync(join(__dirname, "shot-reading.ts"), "utf8");

  it("are the spec's measured draft: under 6,300 characters, a plain literal with nothing put into it", () => {
    expect(SHOT_READER_STATIC.length).toBeLessThanOrEqual(6300);
    expect(SHOT_READER_STATIC.length).toBe(6164);
    const at = source.indexOf("export const SHOT_READER_STATIC = `");
    expect(at).toBeGreaterThan(-1);
    const body = source.slice(at + "export const SHOT_READER_STATIC = `".length, source.indexOf("`;", at));
    expect(body).toBe(SHOT_READER_STATIC);
    expect(body).not.toContain("${");
  });

  it("say what the money rules need them to, and no longer say 'Never describe the person'", () => {
    for (const phrase of ["never a lens", "Never time, light, sky, grade or look", "a pronoun never sets who", "Copy every piece exactly", "Include only the keys you set", "Never say that anything was done"]) {
      expect(SHOT_READER_STATIC, phrase).toContain(phrase);
    }
    expect(SHOT_READER_STATIC).not.toContain("Never describe the person");
  });

  it("list exactly the values the parser accepts", () => {
    const line = (start: string) => {
      const l = SHOT_READER_STATIC.split("\n").find((x) => x.startsWith(start));
      expect(l, start).toBeDefined();
      return l!;
    };
    const words = (text: string) => new Set(text.split(/[^a-z0-9_.-]+/i).map((w) => w.replace(/\.+$/, "")).filter(Boolean));
    // The rig: every id's value on its group's line of LOOK IDS.
    for (const id of READER_RIG_IDS) {
      const [group, value] = id.split(":");
      const where = group === "squeeze" ? line("format:") : line(`${group}:`);
      const after = where.slice(where.indexOf(`${group}:`) + group.length + 1);
      expect(words(after).has(value), id).toBe(true);
    }
    expect(READER_RIG_IDS).toEqual(rigCommandIds());
    // The codes, in order, and nothing more.
    const cant = line("cant:");
    const codes = [...cant.slice(cant.indexOf("CODES:")).matchAll(/(?:^|; |: )([a-z_]+)(?= \(|;|\.)/g)].map((m) => m[1]);
    expect(codes).toEqual([...CANT_CODES]);
    const ask = line("ask:");
    for (const t of ASK_TOPICS) expect(words(ask).has(t), t).toBe(true);
    const moves = line("MOVES:");
    for (const m of FILM_MOVES) expect(words(moves).has(m), m).toBe(true);
    for (const t of FILM_TEXTURES) expect(words(moves).has(t), t).toBe(true);
    for (const p of STAND_POSES) expect(words(line("pose:")).has(p), p).toBe(true);
    for (const s of CAMERA_SIDES) expect(words(line("side:")).has(s), s).toBe(true);
    for (const s of SHOT_SIZES) expect(words(line("size:")).has(s), s).toBe(true);
    for (const h of CAMERA_HEIGHTS) expect(words(line("size:")).has(h), h).toBe(true);
    for (const mm of LENSES_MM) expect(words(line("lens_mm:")).has(String(mm)), String(mm)).toBe(true);
    for (const s of READER_STEPS) expect(words(line("steps:")).has(s), s).toBe(true);
    for (const x of FRAME_XS) expect(words(line("frame_x:")).has(x), x).toBe(true);
    for (const s of NEAR_SIDES) expect(words(line("near:")).has(s), s).toBe(true);
    for (const s of GAZE_SIDES) expect(words(line("gaze:")).has(s), s).toBe(true);
    for (const t of TURN_WORDS) expect(words(line("turn:")).has(t), t).toBe(true);
    for (const f of FIGURE_FACINGS) expect(words(line("facing:")).has(f), f).toBe(true);
    for (const e of READER_ENGINES) expect(words(line("move, textures:")).has(e), e).toBe(true);
  });

  it("hold the switches the owner decided, and the engines take.ts has", () => {
    expect(SHOT_READER_IDEAS).toBe(true);
    expect(SHOT_READER_V2_OPEN_TO_ALL).toBe(false);
    expect(SHOT_READER_MAX_COMPLETION).toBe(600);
    expect([...READER_ENGINES].sort()).toEqual(Object.keys(SET_TAKE_ENGINES).sort());
  });

  it("route on fields, never on words: the parser has no word list", () => {
    // The code after the instructions, comments left out: they may quote what a person says.
    const code = source
      .slice(source.indexOf("`;", source.indexOf("export const SHOT_READER_STATIC")))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const word of ["golden", "undo that", "shoot now", "take it", "relight"]) expect(code.toLowerCase(), word).not.toContain(word);
  });
});
