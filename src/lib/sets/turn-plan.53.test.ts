import { describe, expect, it } from "vitest";
import raceTrack from "./fixtures-race-track.json";
import showroomOpen from "./fixtures-showroom-open.json";
import { setElements } from "./elements";
import { NEW_SET_RIG } from "./rig";
import { normaliseSetSpec, type SetObject, type SetSpec } from "./set-spec";
import { CANT_CODES, type ShotReading } from "./shot-reading";
import { takesCredits } from "./take";
import { blockersOf, planSays, planTurn, shootDecision, type PageState, type PlanShot, type StepKind, type TurnPlan } from "./turn-plan";
import en from "../i18n/messages/en";
import { composeReply, plannedFacts, replyText, replyThingsOf, replyWordsOf, type ReplyFacts } from "./turn-reply";

// The 53 audited requests, re-run free (Helios Cut 2 spec §7.3, step 7,
// 2026-09-25 — operator: "Run, keep going."). One hand-written reading per
// request, as the reader is designed to answer it, through planTurn and
// shootDecision on the race set (#44 on the showroom, with a second car).
// It proves the routing — the bucket, that there is something to say, that
// every "not yet" is named, and that nothing paid runs without its press.
// It does not prove the model reads the phrases that way: only check A,
// which the owner runs, does that (spec §7.4). Step 8 adds the reply
// (turn-reply.ts composeReply): every row's is composed, never empty, and
// names each "not yet" it shows.

const specOf = (json: unknown): SetSpec => {
  const n = normaliseSetSpec(json);
  if (!n.ok) throw new Error("fixture");
  return n.spec;
};
const race = specOf(raceTrack);
const CAR = setElements(race).find((e) => e.kind === "car")?.key ?? "";

/** The showroom with a second car, a blue copy of the first 9 m along: the "other car" needs two. */
const showroom = (() => {
  const base = specOf(showroomOpen);
  const car = setElements(base).find((e) => e.kind === "car");
  if (!car) throw new Error("the showroom has its car");
  const members = [...new Set(car.members.map(([o]) => o))];
  const volume = (o: SetObject) => o.size[0] * o.size[1] * o.size[2];
  const largest = members.reduce((a, b) => (volume(base.objects[b]) > volume(base.objects[a]) ? b : a));
  const copies = members.map((i) => {
    const o = base.objects[i];
    return { ...o, position: [o.position[0] - 9, o.position[1], o.position[2]] as SetObject["position"], color: i === largest ? "#1f4fd1" : o.color };
  });
  return specOf({ ...base, objects: [...base.objects, ...copies] });
})();
const [SHOW_CAR1, SHOW_CAR2] = setElements(showroom)
  .filter((e) => e.kind === "car")
  .map((e) => e.key);

const EVA = "0b0f7c1e-3a44-4c2a-9d1e-6a1f2b3c4d5e";
const MARCO = "7d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";
const CREDITS = {
  still: takesCredits("omni", { clips: 0, stills: 1 }),
  take: { omni: takesCredits("omni", { clips: 1, stills: 1 }), veo: takesCredits("veo", { clips: 1, stills: 1 }) },
};
/** Still 2 (Marco) and Still 1 (Eva), both 16:9, newest first: the spec's set-up for the nine exchanges. */
const SHOTS: PlanShot[] = [
  { generationId: "g-2", kind: "still", status: "succeeded", format: "wide", characterId: MARCO },
  { generationId: "g-1", kind: "still", status: "succeeded", format: "wide", characterId: EVA },
];

/** The race set as the spec's exchanges start: Marco on the chip, Ask before shooting, 4 Astra changes left of 4. */
function raceState(over: Partial<PageState> = {}): PageState {
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

type Bucket = "full" | "afterPress" | "partly" | "notYet";
type Row = {
  n: number;
  request: string;
  reading: ShotReading;
  bucket: Bucket;
  state?: Partial<PageState>;
  /** Its "not yet" line carries a button that does it elsewhere now (Build a new place; the car's card): partly, in the spec's count. */
  where?: true;
  /** The request asks for the look, and the options are it: done after Do it. */
  doIt?: true;
};

const said = (code: (typeof CANT_CODES)[number], words: string | null = null) => ({ code, said: words });

const ROWS: Row[] = [
  { n: 1, request: "Dolly in slowly on her face", reading: { size: "close_up", move: "push-in" }, bucket: "afterPress" },
  { n: 2, request: "Over-the-shoulder", reading: { side: "back_left", cant: [said("two_people", "over-the-shoulder")] }, bucket: "partly" },
  { n: 3, request: "From inside the car", reading: { cant: [said("camera_inside", "from inside the car")], suggest: [{ height: "low", side: "front", size: "medium" }] }, bucket: "notYet" },
  { n: 4, request: "Drone shot rising", reading: { height: "high", size: "wide", move: "rise-reveal", cant: [said("altitude", "Drone shot")] }, bucket: "partly" },
  { n: 5, request: "Dutch angle", reading: { cant: [said("roll", "Dutch angle")] }, bucket: "notYet" },
  { n: 6, request: "Match this reference photo", reading: { cant: [said("photo", "this reference photo")] }, bucket: "notYet" },
  { n: 7, request: "Low, 24 mm, from behind", reading: { height: "low", lensMm: 24, side: "back" }, bucket: "full" },
  { n: 8, request: "Switch to the wide camera", reading: { cameraId: "c1" }, bucket: "full" },
  { n: 9, request: "Close-up on the front wheel", reading: { cant: [said("aim_thing", "the car's front wheel")], suggest: [{ size: "close_up", height: "low" }] }, bucket: "notYet" },
  {
    n: 10,
    request: "Left third, car filling the right",
    reading: { frameX: "left_third", near: { thing: { key: CAR }, side: "beside" }, cant: [said("aim_thing", "the car filling the right")] },
    bucket: "partly",
  },
  { n: 11, request: "Wide establishing of the circuit", reading: { cameraId: "c1" }, bucket: "full" },
  { n: 12, request: "She leans on the car", reading: { near: { thing: { key: CAR }, side: "beside" }, pose: "lean", happens: { keep: [], add: ["She leans on the car"] } }, bucket: "full" },
  { n: 13, request: "Sits on the bonnet", reading: { pose: "sit", near: { thing: { key: CAR }, side: "front" }, cant: [said("raise_figure", "sits on the bonnet")] }, bucket: "partly" },
  { n: 14, request: "Walks toward the camera", reading: { pose: "walk", facing: "camera", happens: { keep: [], add: ["She walks toward the camera"] } }, bucket: "full" },
  { n: 15, request: "Eva and Marco face to face", reading: { cant: [said("two_people", "Eva and Marco talk face to face")] }, bucket: "notYet" },
  { n: 16, request: "Hands him the helmet", reading: { cant: [said("two_people", "hands him the helmet")] }, bucket: "notYet" },
  { n: 17, request: "Looks at the car", reading: { gaze: { key: CAR } }, bucket: "full" },
  { n: 18, request: "Starting-grid mark", reading: { markId: "m1" }, bucket: "full", state: { markId: "m2" } },
  { n: 19, request: "Face the grandstand", reading: { cant: [said("thing_unknown", "the grandstand")] }, bucket: "notYet" },
  { n: 20, request: "Add rain", reading: { rig: ["time:night", "palette:harbour-4am"], cant: [said("weather", "rain")] }, bucket: "partly" },
  {
    n: 21,
    request: "Make it night",
    reading: { rig: ["time:night"] },
    bucket: "full",
    state: { rig: { ...NEW_SET_RIG, light: { scheme: "golden-hour", azimuthDeg: 155, elevationDeg: 9 } } },
  },
  {
    n: 22,
    request: "Red Ferrari by the pit wall",
    reading: { setChange: { said: "Put a red Ferrari by the pit wall", gloss: "a red sports car by the pit wall", cut: false }, cant: [said("brand", "Ferrari")] },
    bucket: "partly",
  },
  { n: 23, request: "Remove the barriers", reading: { setChange: { said: "Remove the barriers", gloss: null, cut: false } }, bucket: "afterPress" },
  { n: 24, request: "Bigger crowd", reading: { cant: [said("extras", "the crowd in the stands bigger")] }, bucket: "notYet" },
  { n: 25, request: "Track to a city street", reading: { cant: [said("rebuild", "Change the track to a city street")] }, bucket: "partly", where: true },
  {
    n: 26,
    request: "Brick-red walls",
    reading: { setChange: { said: "Make the walls brick red", gloss: null, cut: false } },
    bucket: "afterPress",
  },
  {
    n: 27,
    request: "Racing suit from my photo",
    reading: { happens: { keep: [], add: ["She wears the racing suit"] }, wardrobe: true, cant: [said("photo", "from my photo")] },
    bucket: "partly",
  },
  { n: 28, request: "Holding a coffee cup", reading: { happens: { keep: [], add: ["She's holding a coffee cup"] } }, bucket: "full" },
  { n: 29, request: "Helmet on the car's roof", reading: { happens: { keep: [], add: ["her helmet on the car's roof"] } }, bucket: "full" },
  { n: 30, request: "Gets in and drives off", reading: { cant: [said("film_beats", "Then she gets in"), said("mover", "drives off")] }, bucket: "notYet" },
  { n: 31, request: "Cut to a close-up", reading: { size: "close_up", cant: [said("film_beats", "Cut to")] }, bucket: "partly" },
  { n: 32, request: "In slow motion", reading: { textures: ["slow-motion"] }, bucket: "afterPress" },
  { n: 33, request: "10-second shot", reading: { engine: "veo", cant: [said("clip_length", "a 10-second shot")] }, bucket: "partly" },
  { n: 34, request: "Car drives past behind her", reading: { cant: [said("mover", "The car drives past behind her")] }, bucket: "notYet" },
  {
    n: 35,
    request: "Like a Michael Mann film",
    reading: { idea: "Cool night, sodium streets, a long lens.", suggest: [{ rig: ["genre:thriller", "palette:sodium-rain", "stock:digital"], lensMm: 85 }, { rig: ["time:night", "palette:harbour-4am"], lensMm: 85 }] },
    bucket: "afterPress",
    doIt: true,
  },
  { n: 36, request: "Anamorphic", reading: { rig: ["character:anamorphic"] }, bucket: "full" },
  { n: 37, request: "35mm film grain", reading: { rig: ["stock:film35"] }, bucket: "full" },
  { n: 38, request: "Black and white", reading: { rig: ["palette:silver-print"] }, bucket: "full" },
  { n: 39, request: "Dog at her feet", reading: { happens: { keep: [], add: ["A dog sitting at her feet"] } }, bucket: "full" },
  { n: 40, request: "Golden hour", reading: { rig: ["time:golden"] }, bucket: "full" },
  { n: 41, request: "Neon rim from behind", reading: { rig: ["light:contre-jour", "palette:neon-undertow"], cant: [said("other", "Neon rim light")] }, bucket: "partly" },
  { n: 42, request: "Photo as the location", reading: { cant: [said("photo", "this photo as the location")] }, bucket: "notYet" },
  { n: 43, request: "Car look like this photo", reading: { cant: [said("photo", "like this photo")] }, bucket: "partly", where: true },
  {
    n: 44,
    request: "No, the other car",
    reading: { near: { thing: { key: SHOW_CAR2 }, side: "beside" } },
    bucket: "full",
    state: { characterId: EVA, markId: null, cameraId: "c2", pose: "lean", direction: "She leans on the red car." },
  },
  { n: 45, request: "Two metres to the left", reading: { nudge: { right: -2, toward: 0 } }, bucket: "full" },
  { n: 46, request: "Undo that", reading: { undo: true }, bucket: "full", state: { rig: { ...NEW_SET_RIG, time: 21 } } },
  { n: 47, request: "Night + low angle ('shoot her from a low angle')", reading: { rig: ["time:night"], height: "low" }, bucket: "full" },
  {
    n: 48,
    request: "Now she's smiling",
    reading: { happens: { keep: ["She leans on the car"], add: ["she's smiling"] } },
    bucket: "full",
    state: { direction: "She leans on the car." },
  },
  { n: 49, request: "Eva by the car, from behind (Marco on chip)", reading: { characterId: EVA, near: { thing: { key: CAR }, side: "beside" }, side: "back" }, bucket: "full" },
  {
    n: 50,
    request: "A paragraph over 300 characters",
    reading: {
      near: { thing: { key: CAR }, side: "beside" },
      happens: {
        keep: [],
        add: [
          "She stands beside the car after the race, exhausted but proud, her helmet tucked under one arm and her racing gloves half pulled off, hair stuck to her forehead, a streak of oil across one cheek",
          "laughing at something one of the mechanics just shouted from the pit lane, while she shakes out her free hand and keeps half an eye on the scoreboard",
        ],
      },
      wardrobe: true,
    },
    bucket: "partly",
  },
  {
    n: 51,
    request: "What would look good (Just talking)",
    reading: { idea: "A low sun behind him makes a rim, and a long lens lets the track fall soft.", suggest: [{ rig: ["light:contre-jour", "palette:amber-hour", "stop:2"], lensMm: 85, size: "medium", height: "low" }, { size: "wide", rig: ["time:night", "palette:sodium-rain", "stock:film35"] }] },
    bucket: "full",
    state: { mode: "talk" },
  },
  { n: 52, request: "Wide camera, low, 85 mm", reading: { cameraId: "c1", height: "low", lensMm: 85 }, bucket: "full" },
  { n: 53, request: "Any Astra change", reading: { setChange: { said: "Remove the flags", gloss: null, cut: false } }, bucket: "afterPress" },
];

/** Every step kind a plan may run: each is free (spec §3.2). A still, a take or an Astra change is never a step. */
const FREE_STEPS: ReadonlySet<StepKind> = new Set<StepKind>(["who", "takeCancel", "frame", "place", "pose", "camera", "facing", "gaze", "look", "words", "takeArm", "motion"]);

function bucketOf(plan: TurnPlan, row: Row): Bucket {
  const runs = plan.kind === "undo" || plan.steps.length > 0;
  const presses = plan.needs.some((n) => n.kind === "astra" || n.kind === "take");
  const answers = plan.ask.length > 0 || plan.idea !== null || plan.suggestions.length > 0;
  if (plan.cant.length > 0 || plan.directionCut !== null) return runs || presses || row.where ? "partly" : "notYet";
  if (presses) return "afterPress";
  if (runs) return "full";
  if (answers) return row.doIt ? "afterPress" : "full";
  return "notYet";
}

const stateFor = (row: Row, over: Partial<PageState> = {}) => raceState({ ...row.state, ...over });

const EN = replyWordsOf(en);
/** The page's facts as a row leaves them, for its reply: the race set's names (#44: the showroom's two cars). */
function factsFor(row: Row, plan: TurnPlan, state: PageState): ReplyFacts {
  const spec = row.n === 44 ? showroom : race;
  const base: ReplyFacts = {
    locale: "en",
    mode: state.mode,
    characters: state.characters.map((c) => ({ id: c.id, name: c.name })),
    characterId: state.characterId,
    marks: spec.marks.map((m) => ({ id: m.id, label: m.label })),
    cameras: spec.cameras.map((c) => ({ id: c.id, label: c.label })),
    things: replyThingsOf(spec, spec.marks[0], EN),
    markId: state.markId,
    pose: state.pose,
    facing: "camera",
    cameraId: state.cameraId,
    frameX: state.frameX,
    rig: state.rig,
    direction: state.direction,
    lensMm: 50,
    distanceM: 2.4,
    spot: null,
    credits: state.credits,
    takeEngine: state.takeEngine,
    takeFrom: 2,
    newestStill: 2,
    lastStill: { n: 2, status: "succeeded", score: 88 },
    editsLeft: state.editsLeft,
    editsCap: state.editsCap,
    tooBig: state.tooBig,
    producerOn: false,
    shot: shootDecision(plan, state),
  };
  return plannedFacts(plan, base);
}
/** A row's reply, composed as planned. */
const replyFor = (row: Row, state: PageState) => {
  const plan = planTurn(row.reading, state);
  return replyText(composeReply(plan, null, factsFor(row, plan, state), EN));
};

describe("the 53 audited requests (spec §7.3)", () => {
  it("has all 53, numbered, each once", () => {
    expect(ROWS.map((r) => r.n)).toEqual(Array.from({ length: 53 }, (_, i) => i + 1));
    expect(SHOW_CAR1).toBeTruthy();
    expect(SHOW_CAR2).toBeTruthy();
    expect(SHOW_CAR2).not.toBe(SHOW_CAR1);
  });

  for (const row of ROWS) {
    it(`#${row.n} ${row.request}: ${row.bucket}, named, nothing paid without its press`, () => {
      const state = stateFor(row);
      const plan = planTurn(row.reading, state);

      expect(bucketOf(plan, row)).toBe(row.bucket);
      // The reply has something to say, and says it (step 8, turn-reply.ts).
      expect(planSays(plan)).toBe(true);
      const said = replyFor(row, state);
      expect(said.trim().length).toBeGreaterThan(0);
      expect(said).not.toMatch(/\{\w+\}/);
      // Each "not yet" it shows is named in words, with their own when quoted.
      for (const c of (row.reading.cant ?? []).slice(0, 3)) expect(said, c.code).toContain(c.said ? `Not yet — “${c.said}”` : "Not yet — part of that");
      // Every "not yet" the reading had is named, each with its code.
      for (const c of row.reading.cant ?? []) expect(plan.cant).toContainEqual(c);
      // Only free steps run.
      for (const s of plan.steps) expect(FREE_STEPS.has(s.kind), s.kind).toBe(true);
      // An Astra change is a card with the changes left, never a step.
      if (row.reading.setChange) expect(plan.needs.filter((n) => n.kind === "astra")).toHaveLength(1);
      // The mode the request was audited in shoots nothing (every row's expectShoot is none).
      expect(shootDecision(plan, state).kind).toBe("none");

      // In "Shoot without asking" too, anything paid or unfinished holds the shot, and the chat's own take never renders.
      const auto = stateFor(row, { mode: row.state?.mode === "talk" ? "talk" : "auto" });
      const autoPlan = planTurn(row.reading, auto);
      const decision = shootDecision(autoPlan, auto);
      if (blockersOf(autoPlan).length > 0) expect(decision.kind).toBe("none");
      // Held by the plan's own facts, not only by blockersOf's reading of them (decision 3).
      if (autoPlan.cant.length > 0 || autoPlan.dropped.length > 0 || autoPlan.directionCut !== null) expect(decision.kind).toBe("none");
      if (autoPlan.takeAfter?.armedBy === "chat") expect(decision.kind).not.toBe("take");
      if (autoPlan.needs.some((n) => n.kind === "astra" || n.kind === "take" || n.kind === "which")) expect(decision.kind).toBe("none");
    });
  }

  it("counts as the spec does: 29 full (23 outright, 6 after one press), 13 partly, 11 not yet — none silent", () => {
    const count = (b: Bucket) => ROWS.filter((row) => bucketOf(planTurn(row.reading, stateFor(row)), row) === b).length;
    expect(count("full")).toBe(23);
    expect(count("afterPress")).toBe(6);
    expect(count("partly")).toBe(13);
    expect(count("notYet")).toBe(11);
    expect(ROWS.every((row) => planSays(planTurn(row.reading, stateFor(row))))).toBe(true);
    // None silent, in "Shoot without asking" too.
    for (const row of ROWS) expect(replyFor(row, stateFor(row, { mode: row.state?.mode === "talk" ? "talk" : "auto" })).trim().length, `#${row.n}`).toBeGreaterThan(0);
  });
});

describe("the conditions the table names (spec §7.3)", () => {
  it("#1 and #32 set the take up from Marco's own 16:9 still, never Eva's, and wait for its priced press", () => {
    for (const n of [1, 32]) {
      const row = ROWS[n - 1];
      const plan = planTurn(row.reading, stateFor(row));
      expect(plan.takeAfter).toEqual({ id: "g-2", n: 2, armedBy: "chat" });
      expect(plan.needs).toEqual([{ kind: "take", still: { id: "g-2", n: 2 }, engine: "omni", credits: CREDITS.take.omni }]);
    }
    // With Eva on the chip and only Marco's still, there is nothing to start from: it says so.
    const eva = planTurn(ROWS[0].reading, raceState({ characterId: EVA, shots: [SHOTS[0]] }));
    expect(eva.takeAfter).toBeNull();
    expect(eva.notes).toEqual([{ kind: "needsStill", characterId: EVA, format: "wide" }]);
  });

  it("#21 turns the golden-hour plot off so night shows, and says so", () => {
    const row = ROWS[20];
    expect(planTurn(row.reading, stateFor(row)).notes).toEqual([{ kind: "hourPlotOff", scheme: "golden-hour", hour: 21 }]);
  });

  it("#27 sets Marco's saved outfit aside for his own words", () => {
    const row = ROWS[26];
    expect(planTurn(row.reading, stateFor(row)).notes).toEqual([{ kind: "outfitOff", characterId: MARCO }]);
  });

  it("#44 stands her by the other car of two", () => {
    const row = ROWS[43];
    expect(planTurn(row.reading, stateFor(row)).steps).toEqual([{ kind: "place", near: { key: SHOW_CAR2, side: "beside" }, cameraFollows: true }]);
  });

  it("#46 steps back a turn: never Astra, never a shot", () => {
    const row = ROWS[45];
    const plan = planTurn(row.reading, stateFor(row, { mode: "auto" }));
    expect(plan.kind).toBe("undo");
    expect(plan.proposal).toBeNull();
    expect(shootDecision(plan, stateFor(row, { mode: "auto" })).kind).toBe("none");
  });

  it("#47 'shoot her from a low angle' is camera words: night and low in one turn, and no shot in Ask before shooting", () => {
    const row = ROWS[46];
    const plan = planTurn(row.reading, stateFor(row));
    expect(plan.steps.map((s) => s.kind)).toEqual(["camera", "look"]);
    expect(shootDecision(plan, stateFor(row)).kind).toBe("none");
  });

  it("#50 keeps what fits of what happens and names the tail", () => {
    const row = ROWS[49];
    const plan = planTurn(row.reading, stateFor(row));
    expect(plan.directionCut).toContain("scoreboard");
    const words = plan.steps.find((s) => s.kind === "words");
    expect(words?.kind === "words" && Array.from(words.happens?.text ?? "").length).toBeLessThanOrEqual(300);
  });

  it("#51 in Just talking answers and offers, and moves nothing", () => {
    const row = ROWS[50];
    const plan = planTurn(row.reading, stateFor(row));
    expect(plan.kind).toBe("proposal");
    expect(plan.suggestions).toHaveLength(2);
    expect(plan.suggestions.every((s) => s.second?.kind === "shoot" && s.second.credits === CREDITS.still)).toBe(true);
  });
});
