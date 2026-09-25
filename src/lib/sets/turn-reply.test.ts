import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import raceTrack from "./fixtures-race-track.json";
import showroomOpen from "./fixtures-showroom-open.json";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import it_ from "../i18n/messages/it";
import type { Messages } from "../i18n/messages/en";
import { fovForLens } from "./build-scene";
import { rigCommandIds } from "./commands";
import { depthOfField, NEW_SET_RIG, sensorCocMm, type SetRig } from "./rig";
import { COLOUR_IDS } from "./reader-context";
import { normaliseSetSpec, STAND_POSES, type SetObject, type SetSpec } from "./set-spec";
import { ASK_TOPICS, CANT_CODES, FRAME_XS, GAZE_SIDES, NEAR_SIDES, READER_STEPS, TURN_WORDS, type ShotReading } from "./shot-reading";
import { CAMERA_HEIGHTS, CAMERA_SIDES, FIGURE_FACINGS, SHOT_SIZES } from "./shot-words";
import { FILM_MOVES, FILM_TEXTURES } from "./moves";
import { SET_TAKE_ENGINES, takesCredits } from "./take";
import { setElements } from "./elements";
import { planTurn, shootDecision, type Note, type PageState, type PlanShot, type StepClamp } from "./turn-plan";
import {
  NOT_YET_SHOWN,
  answerFor,
  cantLine,
  chipFor,
  composeReply,
  creditsLabel,
  fill,
  formatEv,
  formatMetres,
  frameRowsChanged,
  plannedFacts,
  replyText,
  replyThingsOf,
  replyWordsOf,
  turnDid,
  type Outcome,
  type OutcomeKind,
  type PageNote,
  type ReplyFacts,
  type TurnOutcomes,
  type ReplyModel,
  type ReplyWords,
} from "./turn-reply";

// The honest reply (Helios Cut 2, step 8, 2026-09-25 — operator: "Run,
// keep going."): every turn says what it did, what it couldn't and where to
// do it, and what waits for a press — in the person's language, from the
// page's own facts, every paid button with its price.

const specOf = (json: unknown): SetSpec => {
  const n = normaliseSetSpec(json);
  if (!n.ok) throw new Error("fixture");
  return n.spec;
};
const race = specOf(raceTrack);
const MARK = race.marks[0];
const CAR = setElements(race).find((e) => e.kind === "car");
if (!CAR) throw new Error("the race set has its car");

const EVA = "0b0f7c1e-3a44-4c2a-9d1e-6a1f2b3c4d5e";
const MARCO = "7d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";
const LENA = "2c3d4e5f-6a7b-4c8d-9e0f-a1b2c3d4e5f6";
const CREDITS = {
  still: takesCredits("omni", { clips: 0, stills: 1 }),
  take: { omni: takesCredits("omni", { clips: 1, stills: 1 }), veo: takesCredits("veo", { clips: 1, stills: 1 }) },
};
const SHOTS: PlanShot[] = [
  { generationId: "g-2", kind: "still", status: "succeeded", format: "wide", characterId: MARCO },
  { generationId: "g-1", kind: "still", status: "succeeded", format: "wide", characterId: EVA },
];

const CATALOGS: Record<string, Messages> = { en, es, pt, it: it_ };
const LOCALES = Object.keys(CATALOGS);
const WORDS: Record<string, ReplyWords> = Object.fromEntries(LOCALES.map((l) => [l, replyWordsOf(CATALOGS[l])]));
const EN = WORDS.en;

/** The race set as the spec's exchanges start: Marco on the chip, Ask before shooting, 4 Astra changes left of 4, 16:9. */
function stateOf(over: Partial<PageState> = {}): PageState {
  return {
    mode: "ask",
    source: "message",
    origin: null,
    why: "ok",
    dropped: [],
    messageCut: false,
    characterId: MARCO,
    characters: [
      { id: EVA, name: "Eva", hasPhoto: true, hasOutfit: false },
      { id: MARCO, name: "Marco", hasPhoto: true, hasOutfit: true },
      { id: LENA, name: "Lena", hasPhoto: false },
    ],
    markId: "m1",
    pose: "stand",
    cameraId: "c2",
    frameX: "centre",
    rig: { ...NEW_SET_RIG },
    cameraBearingDeg: 35,
    direction: "",
    takeStart: null,
    takeMove: null,
    takeEngine: "omni",
    shots: SHOTS,
    filmOpen: false,
    editsLeft: 4,
    editsCap: 4,
    tooBig: false,
    credits: CREDITS,
    ...over,
  };
}

function factsOf(over: Partial<ReplyFacts> = {}, words: ReplyWords = EN): ReplyFacts {
  return {
    locale: "en",
    mode: "ask",
    characters: [
      { id: EVA, name: "Eva" },
      { id: MARCO, name: "Marco" },
      { id: LENA, name: "Lena" },
    ],
    characterId: MARCO,
    marks: race.marks.map((m) => ({ id: m.id, label: m.label })),
    cameras: race.cameras.map((c) => ({ id: c.id, label: c.label })),
    things: replyThingsOf(race, MARK, words),
    markId: "m1",
    pose: "stand",
    facing: "camera",
    cameraId: "c2",
    frameX: "centre",
    rig: { ...NEW_SET_RIG },
    direction: "",
    lensMm: 50,
    distanceM: 2.4,
    spot: { spot: { bearingDeg: 35, distanceM: 2.4, heightM: 0.7, pitchDeg: 0, fovDeg: fovForLens(50) }, facingDeg: 0, sensorHeightMm: 24 },
    credits: CREDITS,
    takeEngine: "omni",
    takeFrom: 2,
    newestStill: 2,
    lastStill: { n: 2, status: "succeeded", score: 88 },
    editsLeft: 4,
    editsCap: 4,
    tooBig: false,
    producerOn: false,
    shot: null,
    ...over,
  };
}

/** A reading through the plan and the reply, said as planned, with the shot the plan decides. */
function reply(reading: ShotReading | null, state: Partial<PageState> = {}, facts: Partial<ReplyFacts> = {}, words: ReplyWords = EN): { model: ReplyModel; text: string } {
  const s = stateOf(state);
  const plan = planTurn(reading, s);
  const shot = shootDecision(plan, s);
  const base = factsOf({ mode: s.mode, shot, ...facts }, words);
  const model = composeReply(plan, null, plannedFacts(plan, base), words);
  return { model, text: replyText(model) };
}

/** What a person must never read: a placeholder left unfilled, or a raw id. */
function expectClean(text: string, where: string) {
  expect(text, where).not.toMatch(/\{\w+\}/);
  expect(text, where).not.toMatch(/[a-z]_[a-z]/);
  expect(text, where).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  for (const id of rigCommandIds()) expect(text.includes(id), `${where}: ${id}`).toBe(false);
  expect(text.trim().length, where).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------

describe("the words: complete in four languages (spec §5.3–§5.6)", () => {
  it("every \"not yet\" code, every colour, every sensor and every chip group has its words everywhere", () => {
    for (const l of LOCALES) {
      const r = WORDS[l].reply;
      expect(Object.keys(r.cant).sort(), l).toEqual([...CANT_CODES].sort());
      expect(Object.keys(r.colours).sort(), l).toEqual([...COLOUR_IDS].sort());
      expect(Object.keys(r.chips.sides).sort(), l).toEqual([...CAMERA_SIDES].sort());
      expect(Object.keys(r.chips.sizes).sort(), l).toEqual([...SHOT_SIZES].sort());
      expect(Object.keys(r.chips.heights).sort(), l).toEqual([...CAMERA_HEIGHTS].sort());
      expect(Object.keys(r.chips.steps).sort(), l).toEqual([...READER_STEPS].sort());
      expect(Object.keys(r.chips.nearSides).sort(), l).toEqual([...NEAR_SIDES].sort());
      expect(Object.keys(r.chips.gazeSides).sort(), l).toEqual([...GAZE_SIDES].sort());
      expect(Object.keys(r.chips.turnWays).sort(), l).toEqual([...TURN_WORDS].sort());
      expect(Object.keys(r.chips.frameX).sort(), l).toEqual([...FRAME_XS].sort());
      expect(Object.keys(r.chips.facings).sort(), l).toEqual([...FIGURE_FACINGS, "thing"].sort());
    }
  });

  // Every kind of chip, every value it can take: rendered in every language
  // with nothing unfilled and no id showing (critic item 9). The record is
  // typed by OutcomeKind, so a new kind cannot be added without its sample.
  const SAMPLES: Record<OutcomeKind, Outcome[]> = {
    who: [
      { kind: "who", characterId: EVA, was: MARCO },
      { kind: "who", characterId: EVA, was: null },
    ],
    mark: race.marks.map((m) => ({ kind: "mark", markId: m.id })),
    ownSpot: [{ kind: "ownSpot" }],
    near: NEAR_SIDES.map((side) => ({ kind: "near", key: CAR.key, side })),
    nudge: [
      { kind: "nudge", right: -2, toward: 0 },
      { kind: "nudge", right: 0.5, toward: -1.5 },
      { kind: "nudge", right: 0, toward: 0.5 },
    ],
    pose: STAND_POSES.map((pose) => ({ kind: "pose", pose })),
    camera: race.cameras.map((c) => ({ kind: "camera", cameraId: c.id })),
    size: SHOT_SIZES.map((size) => ({ kind: "size", size })),
    height: [...CAMERA_HEIGHTS.map((h) => ({ kind: "height" as const, height: h, m: 0.7 })), { kind: "height", height: null, m: 0.3, clamp: "low" }, { kind: "height", height: null, m: 2.6, clamp: "high" }],
    side: CAMERA_SIDES.map((side) => ({ kind: "side", side })),
    distance: [
      { kind: "distance", m: 2.4 },
      { kind: "distance", m: 0.6, clamp: "near" },
    ],
    tilt: [
      { kind: "tilt", deg: 12 },
      { kind: "tilt", deg: -80, clamp: "tilt" },
      { kind: "tilt", deg: 0.2 },
    ],
    lens: [{ kind: "lens", mm: 35 }, ...(["widest", "longest"] as StepClamp[]).map((clamp) => ({ kind: "lens" as const, mm: 18, clamp }))],
    frameX: FRAME_XS.map((frameX) => ({ kind: "frameX", frameX })),
    step: READER_STEPS.map((step) => ({ kind: "step", step })),
    facing: [...FIGURE_FACINGS.map((facing) => ({ kind: "facing" as const, facing })), { kind: "facing", facing: { key: CAR.key } }],
    turn: TURN_WORDS.map((turn) => ({ kind: "turn", turn })),
    gaze: [{ kind: "gaze", gaze: "camera" }, { kind: "gaze", gaze: "none" }, { kind: "gaze", gaze: { key: CAR.key } }, ...GAZE_SIDES.map((side) => ({ kind: "gaze" as const, gaze: { side } }))],
    rig: rigCommandIds().map((id) => ({ kind: "rig", id })),
    hour: [
      { kind: "hour", hour: 18.25 },
      { kind: "hour", hour: 5 },
    ],
    ev: [
      { kind: "ev", ev: 1 },
      { kind: "ev", ev: -5 / 3 },
      { kind: "ev", ev: 0 },
    ],
    look: [
      { kind: "look", look: 3 },
      { kind: "look", look: "off" },
    ],
    happens: [
      { kind: "happens", text: "She leans on the car." },
      { kind: "happens", text: "" },
    ],
    takeFrom: [{ kind: "takeFrom", still: 2 }],
    move: FILM_MOVES.map((move) => ({ kind: "move", move })),
    texture: FILM_TEXTURES.map((texture) => ({ kind: "texture", texture })),
    engine: (["omni", "veo"] as const).map((engine) => ({ kind: "engine", engine })),
    astra: [{ kind: "astra", said: "add a row of flags along the pit wall" }],
  };

  it("renders every chip kind in all four languages, with nothing unfilled and no id", () => {
    for (const l of LOCALES) {
      const facts = factsOf({ locale: l }, WORDS[l]);
      for (const [kind, samples] of Object.entries(SAMPLES)) {
        for (const o of samples) expectClean(chipFor(o, facts, WORDS[l]), `${l} ${kind} ${JSON.stringify(o)}`);
      }
    }
  });

  it("renders every \"not yet\" line, with and without their words, in all four languages", () => {
    for (const l of LOCALES) {
      const facts = factsOf({ locale: l }, WORDS[l]);
      for (const code of CANT_CODES) {
        for (const said of ["Dutch angle", null]) {
          const line = cantLine(code, said, facts, WORDS[l]);
          expectClean(line.text, `${l} ${code} ${said}`);
          for (const b of line.buttons) expectClean(b.label, `${l} ${code} button`);
        }
      }
    }
  });

  it("answers every question in all four languages, each variant", () => {
    const variants: Partial<ReplyFacts>[] = [
      {},
      { rig: { ...NEW_SET_RIG, stop: 2, lens: "anamorphic", squeeze: 1.33, palette: "silver-print", era: "1970s", light: { scheme: "golden-hour", azimuthDeg: 120, elevationDeg: 9 }, time: 21 } },
      { rig: { ...NEW_SET_RIG, stop: 11 }, distanceM: 30 },
      { characterId: null, markId: null, direction: "She leans on the car.", lastStill: null, takeFrom: null, things: [], producerOn: true, mode: "auto" },
      { editsLeft: 1 },
      { editsLeft: 0 },
      { editsLeft: null, editsCap: -1 },
      { editsLeft: null, editsCap: 4 },
      { lastStill: { n: 3, status: "generating", score: null } },
      { lastStill: { n: 1, status: "failed", score: null } },
    ];
    for (const l of LOCALES) {
      for (const v of variants) {
        const facts = factsOf({ locale: l, ...v }, WORDS[l]);
        for (const topic of ASK_TOPICS) {
          const a = answerFor(topic, facts, WORDS[l]);
          expectClean(a.text, `${l} ${topic} ${JSON.stringify(v)}`);
          for (const b of a.buttons) expectClean(b.label, `${l} ${topic} button`);
        }
      }
    }
  });

  it("says every note in all four languages", () => {
    const planNotes: Note[] = [
      { kind: "notCastable", characterId: LENA },
      { kind: "whoUnknown", characterId: EVA },
      { kind: "takeCancelled", characterId: EVA },
      { kind: "takeCancelledFormat", from: "wide", to: "vertical" },
      { kind: "takeArmed", still: { id: "g-2", n: 2 } },
      { kind: "needsStill", characterId: EVA, format: "wide" },
      { kind: "needsStill", characterId: null, format: "square" },
      { kind: "hourPlotOff", scheme: "golden-hour", hour: 21 },
      { kind: "hourWaits", scheme: "contre-jour", hour: 12 },
      { kind: "moonKept", hour: 22 },
      { kind: "outfitOff", characterId: MARCO },
      { kind: "builtFromWords" },
    ];
    const pageNotes: PageNote[] = [
      { kind: "stepped", key: CAR.key },
      { kind: "cameraFollowed" },
      { kind: "frameLineMoved" },
      { kind: "notStarted" },
      { kind: "undoHand" },
      { kind: "undoAstra" },
      { kind: "undoAstraText" },
      { kind: "stillsStay" },
      { kind: "undoNone" },
    ];
    for (const l of LOCALES) {
      const facts = factsOf({ locale: l }, WORDS[l]);
      const plan = { ...planTurn({ pose: "sit" }, stateOf()), notes: planNotes };
      const text = replyText(composeReply(plan, { chips: [], notes: pageNotes }, facts, WORDS[l]));
      expectClean(text, l);
      // One line per note: nothing dropped in silence.
      expect(text.split("\n").length, l).toBeGreaterThanOrEqual(planNotes.length + pageNotes.length);
    }
  });

  it("reads the same words ⌘K reads: the rig words are the rig panel's and the palette's own", () => {
    const w = replyWordsOf(en);
    expect(w.rig.lensCharacter).toBe(en.sets.rig.lens);
    expect(w.rig.timePresets).toBe(en.sets.palette.timePresets);
    expect(w.rig.genres).toBe(en.sets.rig.genres);
    expect(w.still).toBe(en.sets.stillTile);
    expect(w.autoMode).toBe(en.sets.shootWithoutAsking);
  });
});

describe("gender in es, pt and it (critic item 9; check of the spec, item 10)", () => {
  it("says a pose as the chip does, 'Pose · Sentada', which agrees with the noun for Marco and Eva alike", () => {
    const { text } = reply({ pose: "sit" }, {}, {}, WORDS.es);
    expect(text).toContain("Pose · Sentada");
    for (const l of ["es", "pt", "it"]) {
      for (const who of [MARCO, EVA]) {
        const facts = factsOf({ locale: l, characterId: who, pose: "sit" }, WORDS[l]);
        const where = answerFor("where", facts, WORDS[l]).text;
        expect(where, `${l} ${who}`).toContain(`${CATALOGS[l].sets.pose} · ${CATALOGS[l].sets.poses.sit}`);
      }
    }
  });

  it("never says 'farlo somigliare' in Italian: the likeness line is neutral for Eva", () => {
    const line = cantLine("likeness", "come Zendaya", factsOf({ locale: "it", characterId: EVA }, WORDS.it), WORDS.it).text;
    expect(line).toContain("Eva appare con il proprio volto");
    expect(line).not.toContain("farlo");
    expect(cantLine("likeness", null, factsOf({ locale: "es", characterId: EVA }, WORDS.es), WORDS.es).text).toContain("alguien real");
  });
});

describe("the nine exchanges (spec §1)", () => {
  it("1. many instructions in one breath: every part said in order, nothing spent", () => {
    const { text, model } = reply({
      characterId: EVA,
      happens: { keep: [], add: ["Eva leans on the car"] },
      near: { thing: { key: CAR.key }, side: "beside" },
      pose: "lean",
      height: "low",
      rig: ["time:golden", "character:anamorphic", "stock:film35"],
    });
    const done = model.lines.find((l) => l.kind === "done");
    expect(done?.text).toBe(
      "Done: Eva (was Marco) · Car · beside · Pose · Leaning · Camera low · 0.7 m · Time of day · Golden hour · 17:30 · Lens · Anamorphic · Film stock · 35 mm film · What happens: “Eva leans on the car.”",
    );
    expect(done?.buttons).toEqual([{ kind: "undo", label: "Undo" }]);
    // The camera keys set the camera, so it does not follow her; with none, it does, and says so.
    expect(text).not.toContain("The camera moved with");
    expect(text).not.toContain("credit");
    expect(reply({ nudge: { right: -2, toward: 0 } }).text).toBe("Done: Moved · 2 m left. [Undo]\nThe camera moved with Marco, so the framing holds.");
  });

  it("2. a correction: 'no, lower — and from the other side', where the camera lands", () => {
    const { text } = reply({ steps: ["lower", "other_side"] });
    expect(text).toContain("Lower · Camera 0.3 m (as low as words go) · From the other side · ");
  });

  it("2. then 'undo that': what came back, and nothing when there is nothing", () => {
    const plan = planTurn({ undo: true }, stateOf());
    const undone = replyText(
      composeReply(plan, { chips: [{ kind: "height", height: null, m: 0.7 }, { kind: "side", side: "front_left" }], notes: [] }, factsOf(), EN),
    );
    expect(undone).toBe("Undone: Camera 0.7 m · From the front left.");
    expect(replyText(composeReply(plan, { chips: [], notes: [{ kind: "undoNone" }] }, factsOf(), EN))).toBe(EN.reply.noteUndoNone);
    expect(replyText(composeReply(plan, null, factsOf(), EN))).toBe(EN.reply.replyUndoneLast);
    // The rest of an undo turn is offered, never run.
    const rest = replyText(composeReply(planTurn({ undo: true, rig: ["time:night"] }, stateOf()), { chips: [], notes: [{ kind: "undoNone" }] }, factsOf(), EN));
    expect(rest).toContain("Here's what I'd do: Time of day · Night · 21:00. Nothing moves until you press. [Do it]");
  });

  it("3. a question: answered from the page, nothing moves", () => {
    const { text } = reply({ ask: ["lens", "edits_left"] });
    expect(text).toBe("50 mm on full frame, no lens look.\nYou have 4 Astra changes left this month.");
  });

  it("4. free, paid and can't in one message: done, the plot off, not yet, and the card with its count", () => {
    const reading: ShotReading = {
      rig: ["time:night"],
      pose: "sit",
      near: { thing: { key: CAR.key }, side: "front" },
      setChange: { said: "add a row of flags along the pit wall", gloss: "a row of small flags along the pit wall", cut: false },
      cant: [{ code: "raise_figure", said: "sit on the bonnet" }],
    };
    const golden = { rig: { ...NEW_SET_RIG, light: { scheme: "golden-hour", azimuthDeg: 120, elevationDeg: 9 } } } as const;
    const { text, model } = reply(reading, golden, { rig: golden.rig });
    expect(text).toContain("Done: Car · in front · Pose · Sitting · Time of day · Night · 21:00.");
    expect(text).toContain("The Golden hour light brings its own sun, so I turned it off to show 21:00.");
    expect(text).toContain("Not yet — “sit on the bonnet”: Marco can't sit or stand on top of things yet: the figure stays on the ground, so Marco is beside it.");
    expect(text).toContain(
      "Changing the set itself is Astra's job: “add a row of flags along the pit wall”. It uses 1 of your 4 changes left this month, only if it saves, and takes a minute or more. [Change the set] [Change it, then shoot · 1 credit] [Not now]",
    );
    expect(model.astra).toEqual({ said: "add a row of flags along the pit wall", cut: false, card: "ask", canGo: true, shootCredits: CREDITS.still });
    // In "Shoot without asking" too, nothing is shot, and it says what would.
    const auto = reply(reading, { ...golden, mode: "auto" }, { rig: golden.rig });
    expect(auto.text).toContain(EN.reply.replyHeldShot);
    expect(auto.text).toContain(`Needs your OK: [Shoot as it is · ${creditsLabel(EN.reply, CREDITS.still)}]`);
    expect(auto.text).not.toContain("Shooting this frame");
  });

  it("5. Just talking: the idea, labelled, and ways to try it, each with Do it and its price", () => {
    const { text } = reply(
      {
        idea: "A low sun behind him makes a rim, and a long lens lets the track fall soft.",
        suggest: [
          { rig: ["light:contre-jour", "palette:amber-hour", "stop:2"], lensMm: 85, size: "medium", height: "low" },
          { size: "wide", rig: ["time:night", "palette:sodium-rain", "stock:film35"] },
        ],
      },
      { mode: "talk" },
      { mode: "talk" },
    );
    expect(text).toBe(
      [
        "Astra's idea: “A low sun behind him makes a rim, and a long lens lets the track fall soft.”",
        "Ways to try it:",
        "Medium shot · Camera low · 0.7 m · 85 mm · Light · Contre-jour · Palette · Amber Hour · Stop · f/2 [Do it] [Do it and shoot · 1 credit]",
        "Wide shot · Time of day · Night · 21:00 · Palette · Sodium Rain · Film stock · 35 mm film [Do it] [Do it and shoot · 1 credit]",
      ].join("\n"),
    );
  });

  it("5. Just talking with changes: what it would do, with Do it and the price of doing it and shooting", () => {
    const { model } = reply({ rig: ["time:night"] }, { mode: "talk" }, { mode: "talk" });
    expect(model.lines).toEqual([
      {
        kind: "planned",
        text: "Here's what I'd do: Time of day · Night · 21:00. Nothing moves until you press.",
        buttons: [
          { kind: "doIt", row: "plan", label: "Do it" },
          { kind: "doItShoot", row: "plan", credits: CREDITS.still, label: "Do it and shoot · 1 credit" },
        ],
        // The same line as parts, for the pills (Cut 2, step 11b).
        items: { lead: "Here's what I'd do: ", chips: ["Time of day · Night · 21:00"], tail: ". Nothing moves until you press." },
      },
    ]);
  });

  it("6. a moving shot: the take set up from Marco's own still, and its priced press", () => {
    const { text } = reply({ size: "close_up", move: "push-in", textures: ["slow-motion"] });
    expect(text).toContain("Done: Close-up · Take from Still 2 · Take move · Push in · Slow motion.");
    expect(text).toContain("The take starts at Still 2 and waits for your press.");
    expect(text).toContain(`Needs your OK: [Take · ${creditsLabel(EN.reply, CREDITS.take.omni)}]`);
    // With Eva on the chip and no 16:9 still of her: nothing to start from, and it says so.
    const eva = reply({ size: "close_up", move: "push-in" }, { characterId: EVA, shots: [SHOTS[0]] }, { characterId: EVA });
    expect(eva.text).toContain("Done: Close-up.");
    expect(eva.text).toContain("A camera move needs a start still of Eva in this frame's shape (16 : 9): shoot this frame first, then ask for the move.");
    expect(eva.text).not.toContain("[Take");
  });

  it("7. an honest 'not yet': three lines with where to go, and the closest thing now", () => {
    const { text } = reply({
      cant: [
        { code: "roll", said: "Dutch angle" },
        { code: "camera_inside", said: "from inside the car" },
        { code: "film_beats", said: "then she drives off" },
      ],
      suggest: [{ height: "low", side: "front", size: "medium" }],
    });
    expect(text).toBe(
      [
        "Not yet — “Dutch angle”: The camera can't tilt the horizon yet.",
        "Not yet — “from inside the car”: The camera can't go inside something built yet.",
        "Not yet — “then she drives off”: Directing a film beat by beat in words isn't here yet; Film does it by hand. [Open Film]",
        "Closest now:",
        "Medium shot · Camera low · 0.7 m · From the front [Do it] [Do it and shoot · 1 credit]",
      ].join("\n"),
    );
  });

  it("8. in Spanish, every chip in Spanish", () => {
    const { text } = reply(
      { characterId: EVA, near: { thing: { key: CAR.key }, side: "beside" }, rig: ["time:golden", "palette:silver-print"] },
      {},
      { locale: "es" },
      WORDS.es,
    );
    expect(text).toContain("Hecho: Eva (antes Marco) · Coche · al lado · Hora del día · Hora dorada · 17:30 · Paleta · Copia de Plata.");
  });

  it("9. thirds: 'put her on the left third'", () => {
    expect(reply({ frameX: "left_third" }).text).toBe("Done: On the left third. [Undo]");
  });
});

describe("Done is what happened (spec §5.2)", () => {
  it("says the side the camera REACHED, not the side asked, and what was already so", () => {
    const plan = planTurn({ side: "front_left", markId: "m1" }, stateOf());
    const text = replyText(composeReply(plan, { chips: [{ kind: "side", side: "back_right" }], notes: [{ kind: "frameLineMoved" }] }, factsOf(), EN));
    expect(text).toContain("Done: From behind, right.");
    expect(text).not.toContain("From the front left");
    expect(text).toContain("Already so: Mark · Starting grid.");
    expect(text).toContain("Something built was in the way, so the camera moved to keep Marco in view.");
  });

  it("says nothing was done when no executor changed anything, and never falls silent", () => {
    const plan = planTurn({ pose: "stand" }, stateOf());
    expect(replyText(composeReply(plan, { chips: [], notes: [] }, factsOf(), EN))).toBe("Already so: Pose · Standing.");
    expect(replyText(composeReply(planTurn({}, stateOf()), null, factsOf(), EN))).toBe(EN.reply.replyNothing);
  });

  it("puts the lines in §5.1's order, and at most three 'not yet' lines, then how many more", () => {
    const { model } = reply(
      {
        ask: ["cost"],
        pose: "lean",
        markId: "m1",
        cant: CANT_CODES.slice(0, 5).map((code) => ({ code, said: null })),
        setChange: { said: "remove the barriers", gloss: null, cut: false },
        suggest: [{ size: "wide" }],
      },
      { dropped: ["near.thing"] },
    );
    expect(model.lines.map((l) => l.kind)).toEqual(["answer", "done", "already", "notYet", "notYet", "notYet", "notYetMore", "needs", "astra", "ways", "way", "dropped"]);
    expect(model.lines.find((l) => l.kind === "notYetMore")?.text).toBe(`+${5 - NOT_YET_SHOWN} more`);
  });
});

describe("the lines for what went wrong (spec §3.7)", () => {
  it("down: nothing changed, with Use my words and Try again", () => {
    const { model } = reply(null, { why: "down" });
    expect(replyText(model)).toBe("I couldn't read that just now, so nothing changed. [Use my words as what happens] [Try again]");
    expect(model.lines[0].buttons.map((b) => b.kind)).toEqual(["useMyWords", "tryAgain"]);
  });

  it("busy: too many messages; off and empty: nothing at all (the page uses v1, or nothing was sent)", () => {
    expect(reply(null, { why: "limited" }).text).toBe(EN.reply.replyReaderBusy);
    expect(reply(null, { why: "off" }).model.lines).toEqual([]);
    expect(reply(null, { why: "empty" }).model.lines).toEqual([]);
  });

  it("cut: the message past 600, and what happens past 300 with the tail it lost", () => {
    const long = { happens: { keep: [], add: ["x ".repeat(160).trim(), "and the tail that did not fit"] } };
    const { text } = reply(long, { messageCut: true });
    expect(text).toContain("I read the first 600 characters.");
    expect(text).toContain("What happens keeps 300 characters; “…");
    expect(text).toContain("didn't fit.");
  });

  it("dropped: said once, whatever did not match", () => {
    expect(reply({ pose: "sit" }, { dropped: ["near.thing", "gaze.thing"] }).text.split("\n").filter((l) => l === EN.reply.replyDropped)).toHaveLength(1);
  });

  it("held: a shot asked for past a 'not yet' is not taken, and the reply offers it, priced", () => {
    const { text } = reply({ shoot: true, cant: [{ code: "weather", said: "rain" }] });
    expect(text).toContain(EN.reply.replyHeldShot);
    expect(text).toContain("[Shoot as it is · 1 credit]");
  });

  it("shooting: a shot the turn takes says so, with its price", () => {
    expect(reply({ shoot: true }).text).toBe("Shooting this frame · 1 credit.");
    const take = reply({ shoot: true }, { takeStart: { id: "g-2", n: 2, armedBy: "person" } });
    expect(take.text).toBe(`Shooting this frame · ${creditsLabel(EN.reply, CREDITS.take.omni)}.`);
    for (const l of ["es", "pt", "it"]) expect(reply({ shoot: true }, {}, { locale: l }, WORDS[l]).text).toContain(fill(WORDS[l].reply.replyShooting, { credits: WORDS[l].reply.creditOne }));
  });
});

describe("every paid button carries its price (money rule 7)", () => {
  const PAID = new Set(["doItShoot", "doItTake", "take", "shootAsIs", "astraGoShoot"]);

  it("a take the chat set up waits for [Take · n], and a shot it held offers [Shoot as it is · n], each priced by what it does", () => {
    const chat = { takeStart: { id: "g-2", n: 2, armedBy: "chat" as const } };
    const { model } = reply({ steps: ["closer"] }, { ...chat, mode: "auto" });
    const needs = model.lines.find((l) => l.kind === "needs");
    expect(needs?.buttons).toEqual([
      { kind: "take", credits: CREDITS.take.omni, label: `Take · ${creditsLabel(EN.reply, CREDITS.take.omni)}` },
      { kind: "shootAsIs", press: "still", credits: CREDITS.still, label: "Shoot as it is · 1 credit" },
    ]);
    // The person's own take: "Shoot as it is" reads as the take, at the take's price.
    const person = reply({ shoot: true, cant: [{ code: "sound", said: "music" }] }, { takeStart: { id: "g-2", n: 2, armedBy: "person" } });
    expect(person.model.lines.find((l) => l.kind === "needs")?.buttons).toEqual([
      { kind: "shootAsIs", press: "take", credits: CREDITS.take.omni, label: `Take · ${creditsLabel(EN.reply, CREDITS.take.omni)}` },
    ]);
  });

  it("scans every button of many replies: a paid one always shows its credits, a free one never does", () => {
    const readings: [ShotReading, Partial<PageState>][] = [
      [{ size: "close_up", move: "push-in" }, {}],
      [{ shoot: true, cant: [{ code: "roll", said: "Dutch" }] }, {}],
      [{ suggest: [{ size: "wide" }, { move: "orbit-90" }] }, {}],
      [{ suggest: [{ size: "wide" }] }, { takeStart: { id: "g-2", n: 2, armedBy: "person" } }],
      [{ setChange: { said: "remove the barriers", gloss: null, cut: false } }, {}],
      [{ rig: ["time:night"] }, { mode: "talk" }],
      [{ steps: ["closer"] }, { mode: "auto", takeStart: { id: "g-2", n: 2, armedBy: "chat" } }],
    ];
    let paid = 0;
    for (const l of LOCALES) {
      for (const [reading, state] of readings) {
        const { model } = reply(reading, state, { locale: l, mode: state.mode ?? "ask" }, WORDS[l]);
        for (const b of model.lines.flatMap((x) => x.buttons)) {
          if (PAID.has(b.kind)) {
            paid += 1;
            expect("credits" in b && b.label.includes(creditsLabel(WORDS[l].reply, b.credits)), `${l} ${b.kind} ${b.label}`).toBe(true);
          } else {
            expect(b.label.includes(WORDS[l].reply.creditOne), `${l} ${b.kind}`).toBe(false);
          }
        }
      }
    }
    expect(paid).toBeGreaterThan(20);
  });
});

describe("answers from the page's facts (spec §5.6)", () => {
  const say = (topic: (typeof ASK_TOPICS)[number], over: Partial<ReplyFacts> = {}) => answerFor(topic, factsOf(over), EN);

  it("answers after the turn's changes, and in Just talking about the page as it is", () => {
    const asked: ShotReading = { rig: ["time:night"], ask: ["light"] };
    expect(reply(asked).text).toContain("Light: As built. Time: 21:00.");
    expect(reply(asked, { mode: "talk" }, { mode: "talk" }).text).toContain("Light: As built. Time: As built.");
  });

  it("the lens, on its body, with its look", () => {
    expect(say("lens").text).toBe("50 mm on full frame, no lens look.");
    expect(say("lens", { lensMm: 35, rig: { ...NEW_SET_RIG, sensor: "super35", lens: "anamorphic" } }).text).toBe("35 mm on Super 35, Anamorphic look.");
  });

  it("the focus, from the real depth of field", () => {
    const rig: SetRig = { ...NEW_SET_RIG, stop: 2 };
    const dof = depthOfField(50, 2, 2.4, sensorCocMm("fullframe"));
    expect(say("focus", { rig }).text).toBe(`At f/2, sharp from ${formatMetres(dof.nearM, "en")} to ${formatMetres(dof.farM, "en")} m.`);
    expect(say("focus", { rig: { ...NEW_SET_RIG, stop: 11 }, lensMm: 18, distanceM: 30 }).text).toMatch(/^At f\/11, sharp from .* m to the horizon\.$/);
    expect(say("focus").text).toBe(EN.reply.answerFocusNone);
  });

  it("the frame, the light and the hour, the look", () => {
    expect(say("format").text).toBe("Frame: 16 : 9.");
    expect(say("format", { rig: { ...NEW_SET_RIG, format: "scope", squeeze: 2 } }).text).toBe("Frame: Scope, 2× squeeze.");
    expect(say("light").text).toBe("Light: As built. Time: As built.");
    expect(say("light", { rig: { ...NEW_SET_RIG, light: { scheme: "golden-hour", azimuthDeg: 1, elevationDeg: 9 }, time: 12 } }).text).toBe(
      "Light: Golden hour. Time: 12:00. The hour waits under that light.",
    );
    expect(say("light", { rig: { ...NEW_SET_RIG, light: { scheme: "moonlight", azimuthDeg: 1, elevationDeg: 30 }, time: 22 } }).text).toBe("Light: Moonlight. Time: 22:00.");
    expect(say("look").text).toBe(EN.reply.answerLookNone);
    expect(say("look", { rig: { ...NEW_SET_RIG, stock: "film35", palette: "silver-print" } }).text).toBe("Look: Film stock · 35 mm film · Palette · Silver Print.");
  });

  it("who, where, what happens", () => {
    expect(say("who").text).toBe("Marco is in the frame.");
    expect(say("who", { characterId: null }).text).toBe(EN.reply.answerWhoNone);
    expect(say("where", { pose: "lean" }).text).toBe("Marco: Mark · Starting grid · Facing · the camera · Pose · Leaning.");
    expect(say("where", { markId: null, facing: "away" }).text).toBe("Marco: Own spot · Facing · away · Pose · Standing.");
    expect(say("happens", { direction: "She leans on the car." }).text).toBe("What happens: “She leans on the car.”");
    expect(say("happens").text).toBe(EN.reply.answerHappensNone);
  });

  it("the cost, of a still and of the take it would start", () => {
    expect(say("cost").text).toBe(`A still here is 1 credit. A take from Still 2 is ${creditsLabel(EN.reply, CREDITS.take.omni)}.`);
    expect(say("cost", { takeFrom: null }).text).toBe("A still here is 1 credit.");
    expect(say("cost", { takeEngine: "veo" }).text).toContain(creditsLabel(EN.reply, CREDITS.take.veo));
  });

  it("the month's Astra changes, in each of the card's cases (critic item 6)", () => {
    expect(say("edits_left").text).toBe("You have 4 Astra changes left this month.");
    expect(say("edits_left", { editsLeft: 1 }).text).toBe("You have 1 Astra change left this month.");
    expect(say("edits_left", { editsLeft: 0 }).text).toBe("You have no Astra changes left this month; the Build editor's own tools still work.");
    expect(say("edits_left", { editsLeft: null, editsCap: 0 }).text).toBe("You have no Astra changes left this month; the Build editor's own tools still work.");
    expect(say("edits_left", { editsLeft: null, editsCap: -1 }).text).toBe("This account has no monthly cap on Astra changes.");
    expect(say("edits_left", { editsLeft: null, editsCap: 4 }).text).toBe("Your plan has 4 Astra changes a month; I couldn't read how many are left.");
  });

  it("the last still, the set's things", () => {
    expect(say("last_still").text).toBe("Still 2: finished, identity 88.");
    expect(say("last_still", { lastStill: { n: 3, status: "generating", score: null } }).text).toBe("Still 3: still rendering.");
    expect(say("last_still", { lastStill: null }).text).toBe(EN.reply.answerNoStill);
    expect(say("things").text).toBe("On this set: Car (red).");
    expect(say("things", { things: [] }).text).toBe(EN.reply.answerThingsNone);
  });

  it("what it can do says what it spends in each mode (check of the spec, item 5)", () => {
    expect(say("help").text).toContain("I ask before anything that costs credits");
    expect(say("help", { mode: "talk" }).text).toBe(say("help").text);
    const auto = say("help", { mode: "auto" }).text;
    expect(auto).toContain("In Shoot without asking, a changed frame is shot at once (1 credit); I always ask before changing the set itself.");
    expect(auto).not.toContain("I ask before anything that costs credits");
    for (const l of ["es", "pt", "it"]) {
      const text = answerFor("help", factsOf({ locale: l, mode: "auto" }, WORDS[l]), WORDS[l]).text;
      expect(text, l).toContain(CATALOGS[l].sets.shootWithoutAsking);
    }
  });

  it("elsewhere: Settings, and the Producer only where the lamp is", () => {
    expect(say("elsewhere")).toEqual({ text: "That's outside this set: Settings → Plan & billing has your plan and credits.", buttons: [] });
    expect(say("elsewhere", { producerOn: true })).toEqual({
      text: "That's outside this set: Settings → Plan & billing has your plan and credits. Or ask the Producer (the lamp).",
      buttons: [{ kind: "askProducer", label: "Ask the Producer" }],
    });
  });
});

describe("which one, and the things by the page's own names", () => {
  /** The showroom with a second car, a blue copy of the first 9 m along. */
  const showroom = (() => {
    const base = specOf(showroomOpen);
    const car = setElements(base).find((e) => e.kind === "car");
    if (!car) throw new Error("the showroom has its car");
    const members = [...new Set(car.members.map(([o]) => o))];
    const copies = members.map((i) => ({ ...base.objects[i], position: [base.objects[i].position[0] - 9, base.objects[i].position[1], base.objects[i].position[2]] }) as SetObject);
    return specOf({ ...base, objects: [...base.objects, ...copies] });
  })();
  const [car1, car2] = setElements(showroom).filter((e) => e.kind === "car");

  it("asks which, one button per car, named as the page names them, with its colour and side", () => {
    const things = replyThingsOf(showroom, showroom.marks[0], EN);
    expect(things.filter((t) => t.kind === "car").map((t) => t.name).sort()).toEqual(["Car 1", "Car 2"]);
    const { model } = reply({ near: { thing: { candidates: [car1.key, car2.key] }, side: "beside" } }, {}, { things });
    const which = model.lines.find((l) => l.kind === "which");
    expect(which?.text).toBe("Which one do you mean?");
    expect(which?.buttons.map((b) => b.kind)).toEqual(["which", "which"]);
    for (const b of which?.buttons ?? []) {
      expect(b.label).toMatch(/^Car [12] · [a-z]+ · (in front of them|to their left|to their right|behind them)$/);
    }
    // In Portuguese, "Carro 2".
    const ptThings = replyThingsOf(showroom, showroom.marks[0], WORDS.pt);
    expect(ptThings.filter((t) => t.kind === "car").map((t) => t.name).sort()).toEqual(["Carro 1", "Carro 2"]);
  });
});

describe("the small parts", () => {
  it("fills in one pass: a name or a quote holding a placeholder stays as written", () => {
    expect(fill("{name} (was {was})", { name: "{was}", was: "Marco" })).toBe("{was} (was Marco)");
    expect(fill("A {x} and {y}", { x: 1 })).toBe("A 1 and {y}");
    expect(fill("no holes", {})).toBe("no holes");
  });

  it("says metres in each language's own way, and exposure in thirds", () => {
    expect(formatMetres(2.64, "en")).toBe("2.6");
    expect(formatMetres(2.64, "es")).toBe("2,6");
    expect(formatMetres(-0.01, "it")).toBe("0");
    expect(formatMetres(3, "pt")).toBe("3");
    expect([3, 1, -5, 0, 2, -3].map(formatEv)).toEqual(["+1", "+⅓", "−1⅔", "0", "+⅔", "−1"]);
  });

  it("writes LAST TURNS from what the page did, with the reading's own aliases, never the words", () => {
    const plan = planTurn({ characterId: EVA, near: { thing: { key: CAR.key }, side: "beside" }, pose: "lean", height: "low", rig: ["time:golden"], happens: { keep: [], add: ["she leans"] } }, stateOf());
    const did = turnDid(
      plan,
      { chips: [{ kind: "who", characterId: EVA, was: MARCO }, { kind: "near", key: CAR.key, side: "beside" }, { kind: "pose", pose: "lean" }, { kind: "height", height: "low", m: 0.7 }, { kind: "rig", id: "time:golden" }, { kind: "happens", text: "She leans." }], notes: [] },
      { things: { t1: CAR.key }, people: { p1: EVA, p2: MARCO } },
    );
    expect(did).toBe("who p1; near t1 beside; pose lean; camera low 0.7 m; happens set; rig time:golden");
    expect(did).not.toContain("leans.");
    const card = planTurn({ setChange: { said: "remove the barriers", gloss: null, cut: false } }, stateOf());
    expect(turnDid(card, { chips: [], notes: [] }, { things: {}, people: {} })).toBe("astra change pending");
  });

  it("says the engine's own length on its chip", () => {
    expect(chipFor({ kind: "engine", engine: "veo" }, factsOf(), EN)).toBe(`Veo · ${SET_TAKE_ENGINES.veo.seconds} s`);
  });
});

// The reply drawn as pills (Cut 2, step 11b, astra-reply.tsx): a line of
// chips carries its parts, and they say exactly what its sentence says.
describe("a line of chips, as parts for the pills", () => {
  it("every chip line's parts put back together are its sentence, in every language", () => {
    const readings: ShotReading[] = [
      { characterId: EVA, near: { thing: { key: CAR.key }, side: "beside" }, pose: "lean", height: "low", rig: ["time:golden", "character:anamorphic"] },
      { rig: ["time:night"], happens: { keep: [], add: ["she leans on the car"] } },
      { cameraId: "c2", pose: "stand" },
      { idea: "A low sun behind him.", suggest: [{ size: "wide", rig: ["time:night"] }, { lensMm: 85 }] },
    ];
    let seen = 0;
    for (const l of LOCALES) {
      for (const reading of readings) {
        for (const mode of ["ask", "talk"] as const) {
          const { model } = reply(reading, { mode }, { mode, locale: l }, WORDS[l]);
          for (const line of model.lines) {
            if (!line.items) continue;
            seen += 1;
            const { lead, chips, tail } = line.items;
            expect(chips.length, `${l} ${line.kind}`).toBeGreaterThan(0);
            expect(`${lead}${chips.join(" · ")}${tail}`, `${l} ${line.kind}`).toBe(line.text);
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(20);
  });

  it("a last chip that closes its own sentence gets no second full stop in the parts either", () => {
    const { model } = reply({ happens: { keep: [], add: ["she leans on the car"] } });
    const done = model.lines.find((l) => l.kind === "done");
    expect(done?.items?.chips[done.items.chips.length - 1]).toBe("What happens: “She leans on the car.”");
    expect(done?.items?.tail).toBe("");
    expect(done?.text.endsWith("car.”")).toBe(true);
  });

  it("lines that aren't lists of chips have no parts", () => {
    const { model } = reply({ ask: ["lens"], cant: [{ code: "roll", said: "Dutch angle" }] });
    for (const line of model.lines) if (line.kind !== "done" && line.kind !== "already" && line.kind !== "way") expect(line.items, line.kind).toBeUndefined();
  });
});

// The frame card's dot (spec §5.1): the rows the last message moved, from
// what the page reached.
describe("the frame card's rows a turn changed", () => {
  const run = { kind: "run" } as const;
  it("maps each outcome to the row that shows it", () => {
    expect(
      frameRowsChanged(run, {
        chips: [
          { kind: "who", characterId: EVA, was: MARCO },
          { kind: "near", key: CAR.key, side: "beside" },
          { kind: "height", height: "low", m: 0.7 },
          { kind: "rig", id: "time:golden" },
          { kind: "rig", id: "character:anamorphic" },
          { kind: "happens", text: "She leans." },
        ],
        notes: [],
      }).sort(),
    ).toEqual(["camera", "happens", "rig", "time", "where", "who"]);
    expect(frameRowsChanged(run, { chips: [{ kind: "rig", id: "genre:noir" }], notes: [] }).sort()).toEqual(["light", "palette"]);
    expect(frameRowsChanged(run, { chips: [{ kind: "rig", id: "format:wide" }, { kind: "hour", hour: 18.25 }], notes: [] }).sort()).toEqual(["camera", "time"]);
    // Rows the card doesn't show get no dot: an era, the exposure, the take's move.
    expect(frameRowsChanged(run, { chips: [{ kind: "rig", id: "era:1970s" }, { kind: "ev", ev: 1 }, { kind: "move", move: "push-in" }], notes: [] })).toEqual([]);
  });

  it("says nothing for a preview, a failed reading or a turn said as planned", () => {
    const chips: TurnOutcomes = { chips: [{ kind: "who", characterId: EVA, was: MARCO }], notes: [] };
    for (const kind of ["proposal", "guard", "nothing"] as const) expect(frameRowsChanged({ kind }, chips), kind).toEqual([]);
    expect(frameRowsChanged(run, null)).toEqual([]);
    expect(frameRowsChanged({ kind: "undo" }, chips)).toEqual(["who"]);
  });

  it("knows every rig command's group, or leaves it out on purpose", () => {
    const shown = new Set(["format", "squeeze", "stop", "stock", "character", "light", "time", "palette", "genre"]);
    for (const id of rigCommandIds()) {
      const rows = frameRowsChanged(run, { chips: [{ kind: "rig", id }], notes: [] });
      expect(rows.length > 0, id).toBe(shown.has(id.slice(0, id.indexOf(":"))));
    }
  });
});

describe("meaning, not words: a source pin", () => {
  it("has no regular expression and reads no message", () => {
    const code = readFileSync(join(__dirname, "turn-reply.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/\bRegExp\b/);
    expect(code).not.toMatch(/\.(test|match|matchAll|search|replace|replaceAll|split)\(/);
    expect(code).not.toMatch(/(?:[(,=:!&|?]|\breturn)\s*\/(?![/*])[^/\n]+\/[a-z]*/);
    expect(code.replace(/"(?:[^"\\\n]|\\.)*"/g, '""')).not.toMatch(/\bmessage\b/);
    expect(code).not.toMatch(/\b(said|gloss)\.(includes|indexOf|startsWith|endsWith|toLowerCase)\(/);
  });
});

// ---------------------------------------------------------------------------
// The review of Cut 2 (2026-09-25): replies that said something the page did not do.
// ---------------------------------------------------------------------------

describe("replies that say only what happened (review of Cut 2)", () => {
  it("a mark and a thing said at once: the mark used, said in its own line, never 'didn't match' for a car that is there (understanding N4)", () => {
    for (const l of LOCALES) {
      const { text, model } = reply({ markId: "m2", near: { thing: { key: CAR.key }, side: "beside" } }, {}, { locale: l }, WORDS[l]);
      expectClean(text, l);
      expect(text, l).toContain(fill(WORDS[l].reply.notePlaceKept, { name: "Marco", mark: race.marks[1].label }));
      expect(model.lines.some((x) => x.kind === "dropped"), l).toBe(false);
    }
    // Still held in Shoot without asking: two places were asked for.
    const auto = stateOf({ mode: "auto" });
    expect(shootDecision(planTurn({ markId: "m2", near: { thing: { key: CAR.key }, side: "beside" } }, auto), auto).kind).toBe("none");
  });

  it("a held shot is said by what held it: Try again alone, the chat's own take alone, or a part that isn't done (W1, understanding N1)", () => {
    for (const l of LOCALES) {
      const w = WORDS[l];
      // Try again, with every step done: it only didn't shoot because Try again never does.
      const retry = reply({ steps: ["closer"], shoot: true }, { source: "retry" }, { locale: l }, w).text;
      expect(retry, l).toContain(w.reply.replyRetryHeld);
      expect(retry, l).not.toContain(w.reply.replyHeldShot);
      // "A bit closer" in Shoot without asking with the chat's take waiting: the take waits for its press.
      const take = reply({ steps: ["closer"] }, { mode: "auto", takeStart: { id: "g-2", n: 2, armedBy: "chat" } }, { locale: l }, w).text;
      expect(take, l).toContain(fill(w.reply.replyHeldTake, { take: w.reply.takeWord }));
      expect(take, l).not.toContain(w.reply.replyHeldShot);
      // A "not yet": part of it isn't done.
      expect(reply({ shoot: true, cant: [{ code: "weather", said: null }] }, {}, { locale: l }, w).text, l).toContain(w.reply.replyHeldShot);
    }
  });

  it("the Sets home's message held in Ask before shooting says why, and offers [Shoot as it is · n] (Helios Cut 3, money fix)", () => {
    for (const l of LOCALES) {
      const w = WORDS[l];
      const s = stateOf();
      const plan = planTurn({ steps: ["closer"], shoot: true }, s);
      const shot = shootDecision(plan, s, { home: true });
      const model = composeReply(plan, null, plannedFacts(plan, factsOf({ mode: s.mode, shot, locale: l }, w)), w);
      const text = replyText(model);
      expectClean(text, l);
      expect(text, l).toContain(w.reply.replyHomeHeld);
      expect(text, l).not.toContain(w.reply.replyHeldShot);
      expect(model.lines.find((x) => x.kind === "needs")?.buttons, l).toEqual([
        { kind: "shootAsIs", press: "still", credits: CREDITS.still, label: fill(w.reply.shootAsIs, { credits: creditsLabel(w.reply, CREDITS.still) }) },
      ]);
    }
  });

  it("the figure is 'beside it' only when the turn put her by the thing (W5)", () => {
    for (const l of LOCALES) {
      const w = WORDS[l];
      const beside = reply({ pose: "sit", near: { thing: { key: CAR.key }, side: "front" }, cant: [{ code: "raise_figure", said: null }] }, {}, { locale: l }, w).text;
      const alone = reply({ pose: "sit", cant: [{ code: "raise_figure", said: null }] }, {}, { locale: l }, w).text;
      expect(beside, l).toContain(fill(w.reply.cant.raise_figure, { name: "Marco" }).slice(1));
      expect(alone, l).toContain(fill(w.reply.cantRaiseGround, { name: "Marco" }).slice(1));
      expect(alone, l).not.toContain(fill(w.reply.cant.raise_figure, { name: "Marco" }).slice(1));
      expectClean(alone, l);
    }
  });

  it("the help in Shoot without asking prices the person's own take when it is set up (W6)", () => {
    const auto = factsOf({ mode: "auto" });
    expect(answerFor("help", auto, EN).text).toContain(`(${creditsLabel(EN.reply, CREDITS.still)})`);
    const withTake = answerFor("help", { ...auto, takeArmedBy: "person" }, EN).text;
    expect(withTake).toContain(`(as your take, ${creditsLabel(EN.reply, CREDITS.take.omni)})`);
    // The chat's own take never renders on its own: the still's price.
    expect(answerFor("help", { ...auto, takeArmedBy: "chat" }, EN).text).toContain(`(${creditsLabel(EN.reply, CREDITS.still)})`);
    for (const l of LOCALES) expectClean(answerFor("help", { ...factsOf({ mode: "auto", locale: l }, WORDS[l]), takeArmedBy: "person" }, WORDS[l]).text, l);
  });

  it("an Undo whose Astra change could not be undone says so, never 'Undone: the last change.' (W7)", () => {
    for (const l of LOCALES) {
      const w = WORDS[l];
      const plan = planTurn({ undo: true }, stateOf());
      const text = replyText(composeReply(plan, { chips: [], notes: [{ kind: "undoAstraFailed" }] }, factsOf({ locale: l }, w), w));
      expect(text, l).toContain(w.reply.noteUndoAstraFailed);
      expect(text, l).not.toContain(w.reply.replyUndoneLast);
    }
  });

  it("the weather line names the palette and the hour as this language's rig does (W9)", () => {
    for (const l of LOCALES) {
      const w = WORDS[l];
      const text = cantLine("weather", null, factsOf({ locale: l }, w), w).text;
      expect(text, l).toContain(w.rig.palettes["harbour-4am"]);
      expect(text, l).toContain(w.rig.timePresets.night);
      expect(text, l).not.toContain("Harbour 4am");
      expectClean(text, l);
    }
  });

  it("the reply's Astra line says Astra's own cut, not the reader's (W3)", () => {
    const long = `${"make the barriers brick red and ".repeat(15)}and the end`;
    const { text } = reply({ setChange: { said: long.slice(0, 300), gloss: null, cut: true } });
    expect(text).toContain(fill(EN.reply.astraCutMessage, { n: 300 }));
    expect(text).not.toContain(fill(EN.reply.replyCutMessage, { n: 300 }));
  });

  it("'turn left' says whose left: the figure's own (W10)", () => {
    for (const l of LOCALES) expect(WORDS[l].reply.chips.turnWays.left, l).not.toBe(WORDS[l].reply.chips.turnWays.right);
    expect(EN.reply.chips.turnWays.left).toBe("to their own left");
  });
});
