import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import raceTrack from "./fixtures-race-track.json";
import { fovForLens } from "./build-scene";
import { widenFovDeg } from "./compare";
import { setElements } from "./elements";
import { solveMatchPose, type CameraPose } from "./match-shot";
import { NEW_SET_RIG, formatFrame, sensorHeightMm, type RigFormat, type SetRig } from "./rig";
import { normaliseSetSpec, type SetSpec } from "./set-spec";
import { SET_MAX_TILT_DOWN_DEG, SET_MAX_TILT_UP_DEG } from "./set-config";
import type { ShotReading } from "./shot-reading";
import { wordsToMatch } from "./shot-words";
import { takesCredits } from "./take";
import { findVehicles } from "./vehicles";
import {
  EYE_ROOM,
  FRAME_X_AT,
  GAZE_POINT_M,
  NEAR_CLEARANCE_M,
  TURN_UNDO_MAX,
  USE_HOUR_READING,
  bandFovDeg,
  blockersOf,
  cameraSpotOf,
  cameraStep,
  cameraSteps,
  changesFrame,
  facingToward,
  framedMatch,
  frameXAfter,
  gazeFor,
  hourClash,
  keepSnapshot,
  largestObjectOf,
  lookPatch,
  nudgeMark,
  paidDecision,
  pickTakeStart,
  planSays,
  planTurn,
  pointBeside,
  pressFor,
  resolveWhich,
  secondButton,
  shiftPose,
  shootDecision,
  snapshotDiff,
  spotToMatch,
  turnedFacing,
  undoPlan,
  undoneTake,
  vehicleOf,
  type CameraSpot,
  type Need,
  type PageState,
  type PlanShot,
  type TakeStart,
  type TurnMode,
  type TurnSnapshot,
  type TurnState,
} from "./turn-plan";

// The turn plan (Helios Cut 2, step 7, 2026-09-25 — operator: "Run, keep
// going."): one reading, one ordered plan, and whether a picture is taken.

const DEG = Math.PI / 180;
const specOf = (json: unknown): SetSpec => {
  const n = normaliseSetSpec(json);
  if (!n.ok) throw new Error("fixture");
  return n.spec;
};
const race = specOf(raceTrack);
const MARK = race.marks[0];
const C2 = race.cameras.find((c) => c.id === "c2") ?? race.cameras[0];
const C2_POSE: CameraPose = { position: [...C2.position], target: [...C2.target], fovDeg: C2.fovDeg };
const CAR = setElements(race).find((e) => e.kind === "car");
if (!CAR) throw new Error("the race set has its car");
const CAR2 = "c_0badcafe_80_0";
const EVA = "0b0f7c1e-3a44-4c2a-9d1e-6a1f2b3c4d5e";
const MARCO = "7d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";
const LENA = "2c3d4e5f-6a7b-4c8d-9e0f-a1b2c3d4e5f6";
const bearingOf = (p: readonly number[], m: { x: number; z: number }) => (((Math.atan2(p[0] - m.x, p[2] - m.z) / DEG) % 360) + 360) % 360;

const CREDITS = {
  still: takesCredits("omni", { clips: 0, stills: 1 }),
  take: { omni: takesCredits("omni", { clips: 1, stills: 1 }), veo: takesCredits("veo", { clips: 1, stills: 1 }) },
};
const still = (id: string, over: Partial<PlanShot> = {}): PlanShot => ({ generationId: id, kind: "still", status: "succeeded", format: "wide", characterId: null, ...over });
/** The race set's filmstrip, newest first: Still 2 (Marco), Still 1 (Eva), both 16:9. */
const SHOTS: PlanShot[] = [still("g-2", { characterId: MARCO }), still("g-1", { characterId: EVA })];

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
    cameraBearingDeg: bearingOf(C2.position, MARK),
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
const kinds = (r: ShotReading, s: PageState = stateOf()) => planTurn(r, s).steps.map((x) => x.kind);
const decide = (r: ShotReading | null, over: Partial<PageState> = {}) => {
  const s = stateOf(over);
  return shootDecision(planTurn(r, s), s);
};
const GOLDEN_PLOT = { scheme: "golden-hour", azimuthDeg: 120, elevationDeg: 9 } as const;
const MOON_PLOT = { scheme: "moonlight", azimuthDeg: 40, elevationDeg: 30 } as const;
const rigWith = (over: Partial<SetRig>): SetRig => ({ ...NEW_SET_RIG, ...over });

// ---------------------------------------------------------------------------

describe("planTurn: the order of work (spec §3.1)", () => {
  const exchange1: ShotReading = {
    characterId: EVA,
    happens: { keep: [], add: ["Eva leans on the car"] },
    near: { thing: { key: CAR.key }, side: "beside" },
    pose: "lean",
    height: "low",
    rig: ["time:golden", "character:anamorphic", "stock:film35"],
  };

  it("runs who, place, pose, camera, look, words in that order, and every step is free", () => {
    const plan = planTurn(exchange1, stateOf());
    expect(plan.kind).toBe("run");
    expect(plan.steps.map((s) => s.kind)).toEqual(["who", "place", "pose", "camera", "look", "words"]);
    expect(plan.steps[0]).toEqual({ kind: "who", characterId: EVA, was: MARCO });
    // A camera key is in the reading: the camera is solved, not dragged along.
    expect(plan.steps[1]).toEqual({ kind: "place", near: { key: CAR.key, side: "beside" }, cameraFollows: false });
    expect(plan.steps[4]).toEqual({ kind: "look", ids: ["time:golden", "character:anamorphic", "stock:film35"] });
    expect(plan.steps[5]).toEqual({ kind: "words", happens: { text: "Eva leans on the car.", cut: null }, outfitOff: false });
    expect(plan.needs).toEqual([]);
    expect(shootDecision(plan, stateOf())).toEqual({ kind: "none", held: [], offer: null });
    expect(shootDecision(plan, stateOf({ mode: "auto" }))).toEqual({ kind: "still", held: [], offer: null });
  });

  it("puts the frame's shape before anything is solved, and the look after the camera", () => {
    expect(kinds({ rig: ["format:scope", "time:night"], size: "wide", pose: "sit" })).toEqual(["frame", "pose", "camera", "look"]);
  });

  it("aims a light plot from where the camera ENDS: contre-jour from behind her backlights her from the new side", () => {
    const plan = planTurn({ side: "back", rig: ["light:contre-jour"] }, stateOf());
    const look = plan.steps.find((s) => s.kind === "look");
    if (look?.kind !== "look") throw new Error("look");
    const final = (MARK.facingDeg + 180) % 360;
    const lit = lookPatch(look, stateOf().rig, final).patch.light;
    // The sun faces the camera across her: the camera's bearing + 192° (light-schemes.ts contre-jour).
    expect(lit?.azimuthDeg).toBeCloseTo((final + 192) % 360, 1);
    expect(lookPatch(look, stateOf().rig, stateOf().cameraBearingDeg).patch.light?.azimuthDeg).not.toBeCloseTo(lit?.azimuthDeg ?? 0, 0);
  });

  // Review of Cut 2, U2 (2026-09-25): a plot was "already so" by its scheme
  // alone, but it is anchored in the world from where the camera stood.
  it("a light plot is already so only when aimed the same way; restated after the camera moved, or with a camera move, it is aimed again", () => {
    const fromFront = { scheme: "contre-jour" as const, azimuthDeg: 192, elevationDeg: 5 };
    // Set from bearing 0; the camera is now at 180: the same words are a new aim.
    const moved = planTurn({ rig: ["light:contre-jour"] }, stateOf({ rig: rigWith({ light: fromFront }), cameraBearingDeg: 180 }));
    expect(moved.already).toEqual([]);
    expect(moved.steps).toEqual([{ kind: "look", ids: ["light:contre-jour"] }]);
    // Asked from where it was set: already so.
    const same = planTurn({ rig: ["light:contre-jour"] }, stateOf({ rig: rigWith({ light: fromFront }), cameraBearingDeg: 0 }));
    expect(same.already).toEqual(["light:contre-jour"]);
    expect(same.steps).toEqual([]);
    // With a camera move in the same words, where the camera ends decides: never already so.
    const withMove = planTurn({ side: "back", rig: ["light:contre-jour"] }, stateOf({ rig: rigWith({ light: fromFront }), cameraBearingDeg: 0 }));
    expect(withMove.already).not.toContain("light:contre-jour");
    expect(withMove.steps.find((st) => st.kind === "look")).toEqual({ kind: "look", ids: ["light:contre-jour"] });
    // A plot off stays off: "as built" is already so without a camera to aim from.
    expect(planTurn({ rig: ["light:as-built"] }, stateOf()).already).toEqual(["light:as-built"]);
    expect(planTurn({ side: "back", rig: ["light:as-built"] }, stateOf()).already).toEqual(["light:as-built"]);
  });

  it("says what was already so, and runs nothing for it", () => {
    const plan = planTurn({ characterId: MARCO, pose: "stand", markId: "m1", cameraId: "c2", rig: ["format:wide"] }, stateOf());
    expect(plan.steps).toEqual([]);
    expect(plan.already).toEqual(["who", "format:wide", "mark", "pose", "cameraId"]);
    expect(shootDecision(plan, stateOf({ mode: "auto" }))).toEqual({ kind: "none", held: [], offer: null });
    expect(planSays(plan)).toBe(true);
  });

  it("never reads words: a source pin — no regular expression, and no read of the message", () => {
    const code = readFileSync(join(__dirname, "turn-plan.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/\bRegExp\b/);
    expect(code).not.toMatch(/\.(test|match|matchAll|search|replace|replaceAll|split)\(/);
    // A regex literal: a slash opening an expression (after ( , = : ! & | ? or return).
    expect(code).not.toMatch(/(?:[(,=:!&|?]|\breturn)\s*\/(?![/*])[^/\n]+\/[a-z]*/);
    // The message is never read: no identifier names it (a string such as the "message" source is not a read).
    expect(code.replace(/"(?:[^"\\\n]|\\.)*"/g, '""')).not.toMatch(/\bmessage\b/);
    expect(code).not.toMatch(/\b(said|gloss)\.(includes|indexOf|startsWith|endsWith|toLowerCase)\(/);
  });
});

describe("who (spec §3.1 step 4)", () => {
  it("casts someone with a photo; says why not for no photo or someone unknown, and holds the shot", () => {
    expect(kinds({ characterId: EVA })).toEqual(["who"]);
    const lena = planTurn({ characterId: LENA, rig: ["time:night"] }, stateOf());
    expect(lena.steps.map((s) => s.kind)).toEqual(["look"]);
    expect(lena.notes).toEqual([{ kind: "notCastable", characterId: LENA }]);
    expect(blockersOf(lena)).toEqual(["who"]);
    expect(shootDecision(lena, stateOf({ mode: "auto" }))).toEqual({ kind: "none", held: ["who"], offer: "still" });
    const stranger = planTurn({ characterId: "99999999-9999-4999-8999-999999999999" }, stateOf());
    expect(stranger.notes).toEqual([{ kind: "whoUnknown", characterId: "99999999-9999-4999-8999-999999999999" }]);
    expect(planTurn({ characterId: MARCO }, stateOf()).already).toEqual(["who"]);
  });

  it("cancels a take that starts on a still of someone else (Cut 1's person check), and says whose", () => {
    const take: TakeStart = { id: "g-2", n: 2, armedBy: "person" };
    const plan = planTurn({ characterId: EVA }, stateOf({ takeStart: take }));
    expect(plan.steps).toEqual([
      { kind: "who", characterId: EVA, was: MARCO },
      { kind: "takeCancel", why: "who", still: { id: "g-2", n: 2 } },
    ]);
    expect(plan.notes).toEqual([{ kind: "takeCancelled", characterId: MARCO }]);
    expect(plan.takeAfter).toBeNull();
    // A still with no one on record passes the check, so its take stays.
    const open = planTurn({ characterId: EVA }, stateOf({ shots: [still("g-3"), ...SHOTS], takeStart: { id: "g-3", n: 3, armedBy: "person" } }));
    expect(open.steps.map((s) => s.kind)).toEqual(["who"]);
    expect(open.takeAfter).toEqual({ id: "g-3", n: 3, armedBy: "person" });
  });

  it("with a move in the same message, sets the take up again from the new person's own still", () => {
    const plan = planTurn({ characterId: EVA, move: "push-in" }, stateOf({ takeStart: { id: "g-2", n: 2, armedBy: "chat" } }));
    expect(plan.steps.map((s) => s.kind)).toEqual(["who", "takeCancel", "takeArm", "motion"]);
    expect(plan.takeAfter).toEqual({ id: "g-1", n: 1, armedBy: "chat" });
    expect(plan.notes.map((n) => n.kind)).toEqual(["takeCancelled", "takeArmed"]);
    expect(plan.needs).toEqual([{ kind: "take", still: { id: "g-1", n: 1 }, engine: "omni", credits: CREDITS.take.omni }]);
  });

  it("the chat's own take, cancelled by a new person, is set up again with the move it kept", () => {
    const plan = planTurn(
      { characterId: EVA },
      stateOf({ takeStart: { id: "g-2", n: 2, armedBy: "chat" }, takeMove: { move: "push-in", textures: ["slow-motion"] } }),
    );
    expect(plan.steps.map((s) => s.kind)).toEqual(["who", "takeCancel", "takeArm", "motion"]);
    expect(plan.steps.at(-1)).toEqual({ kind: "motion", move: "push-in", textures: ["slow-motion"], layEnd: false });
    expect(plan.takeAfter).toEqual({ id: "g-1", n: 1, armedBy: "chat" });
  });
});

describe("the frame's shape and an armed take (check of the spec, item 7)", () => {
  it("cancels the chat's own take when the frame changes shape, and sets it up again from a still of the new shape", () => {
    const shots = [still("g-3", { characterId: MARCO, format: "vertical" }), ...SHOTS];
    const plan = planTurn({ rig: ["format:vertical"] }, stateOf({ shots, takeStart: { id: "g-2", n: 2, armedBy: "chat" }, takeMove: { move: "push-in", textures: [] } }));
    expect(plan.steps.map((s) => s.kind)).toEqual(["frame", "takeCancel", "takeArm", "motion"]);
    expect(plan.notes.slice(0, 2)).toEqual([
      { kind: "takeCancelledFormat", from: "wide", to: "vertical" },
      { kind: "takeArmed", still: { id: "g-3", n: 3 } },
    ]);
    expect(plan.takeAfter).toEqual({ id: "g-3", n: 3, armedBy: "chat" });
  });

  it("says what it needs when no still has the new shape", () => {
    const plan = planTurn({ rig: ["format:vertical"] }, stateOf({ takeStart: { id: "g-2", n: 2, armedBy: "chat" }, takeMove: { move: "push-in", textures: [] } }));
    expect(plan.steps.map((s) => s.kind)).toEqual(["frame", "takeCancel"]);
    expect(plan.notes).toEqual([
      { kind: "takeCancelledFormat", from: "wide", to: "vertical" },
      { kind: "needsStill", characterId: MARCO, format: "vertical" },
    ]);
    expect(plan.takeAfter).toBeNull();
  });

  it("keeps the person's own take and asks — and holds any automatic shot until it is settled", () => {
    const s = stateOf({ mode: "auto", takeStart: { id: "g-2", n: 2, armedBy: "person" } });
    const plan = planTurn({ rig: ["format:vertical"] }, s);
    expect(plan.steps.map((x) => x.kind)).toEqual(["frame"]);
    expect(plan.needs).toEqual([{ kind: "takeFormat", still: { id: "g-2", n: 2 }, stillFormat: "wide", format: "vertical" }]);
    expect(plan.takeAfter).toEqual({ id: "g-2", n: 2, armedBy: "person" });
    expect(shootDecision(plan, s)).toEqual({ kind: "none", held: ["takeFormat"], offer: "take" });
  });

  it("a squeeze or the same shape leaves the take alone", () => {
    const plan = planTurn({ rig: ["squeeze:1.33"] }, stateOf({ takeStart: { id: "g-2", n: 2, armedBy: "chat" } }));
    expect(plan.steps.map((s) => s.kind)).toEqual(["frame"]);
    expect(plan.takeAfter).toEqual({ id: "g-2", n: 2, armedBy: "chat" });
  });
});

describe("pickTakeStart (spec §3.1 step 13)", () => {
  it("takes the newest finished still of the chip's person in the rig's shape", () => {
    expect(pickTakeStart(SHOTS, MARCO, "wide")).toEqual({ id: "g-2", n: 2 });
    // Still 2 is Marco's: Eva's take starts on Still 1, never on his.
    expect(pickTakeStart(SHOTS, EVA, "wide")).toEqual({ id: "g-1", n: 1 });
  });

  it("lets a still with no one on record through, and skips another shape, a failed still and a take", () => {
    const shots = [
      still("g-take", { kind: "take", characterId: EVA }),
      still("g-5", { characterId: EVA, status: "failed" }),
      still("g-4", { characterId: EVA, format: "square" }),
      still("g-3", { characterId: null }),
      ...SHOTS,
    ];
    expect(pickTakeStart(shots, EVA, "wide")).toEqual({ id: "g-3", n: 3 });
    expect(pickTakeStart(shots, EVA, "square")).toEqual({ id: "g-4", n: 4 });
    expect(pickTakeStart(shots, EVA, "vertical")).toBeNull();
    expect(pickTakeStart(shots, null, "wide")).toBeNull();
  });

  it("a move with no still to start from says what it needs, and offers no take", () => {
    const plan = planTurn({ size: "close_up", move: "push-in" }, stateOf({ characterId: EVA, shots: [SHOTS[0]] }));
    // No take to keep the move for: the camera moves, the move waits for a still.
    expect(plan.steps.map((s) => s.kind)).toEqual(["camera"]);
    expect(plan.notes).toEqual([{ kind: "needsStill", characterId: EVA, format: "wide" }]);
    expect(plan.needs).toEqual([]);
    expect(plan.takeAfter).toBeNull();
  });
});

describe("a moving shot (exchange 6, critic item 1)", () => {
  it("sets a take up for free from Still 2, lays no end over camera words, and waits for the priced press", () => {
    const plan = planTurn({ size: "close_up", move: "push-in", textures: ["slow-motion"] }, stateOf());
    expect(plan.steps).toEqual([
      { kind: "camera", size: "close_up" },
      { kind: "takeArm", still: { id: "g-2", n: 2 } },
      { kind: "motion", move: "push-in", textures: ["slow-motion"], layEnd: false },
    ]);
    expect(plan.needs).toEqual([{ kind: "take", still: { id: "g-2", n: 2 }, engine: "omni", credits: CREDITS.take.omni }]);
    for (const mode of ["talk", "ask", "auto"] as TurnMode[]) expect(shootDecision(plan, stateOf({ mode })).kind).toBe("none");
  });

  it("with no camera words, the move lays the end frame; an engine said prices the take on it", () => {
    const plan = planTurn({ move: "arc-left", engine: "veo" }, stateOf());
    expect(plan.steps.at(-1)).toEqual({ kind: "motion", move: "arc-left", engine: "veo", layEnd: true });
    expect(plan.needs).toEqual([{ kind: "take", still: { id: "g-2", n: 2 }, engine: "veo", credits: CREDITS.take.veo }]);
  });

  // Review of Cut 2, S3 (2026-09-25): the chat's take kept the last engine chosen, so one Veo take made every later take the chat set up a Veo take.
  it("a take the chat sets up starts on the default engine, whatever engine an earlier take used, unless the words name one", () => {
    const plan = planTurn({ move: "push-in" }, stateOf({ takeEngine: "veo" }));
    expect(plan.steps.at(-1)).toEqual({ kind: "motion", move: "push-in", engine: "omni", layEnd: true });
    expect(plan.needs).toEqual([{ kind: "take", still: { id: "g-2", n: 2 }, engine: "omni", credits: CREDITS.take.omni }]);
    expect(secondButton(planTurn({ move: "push-in" }, stateOf({ source: "button", takeEngine: "veo" })), stateOf({ takeEngine: "veo" }))).toEqual({
      kind: "take",
      credits: CREDITS.take.omni,
    });
    // Named, it is that engine; a move that rides a take already set up keeps that take's engine.
    expect(planTurn({ move: "push-in", engine: "veo" }, stateOf({ takeEngine: "veo" })).needs).toEqual([{ kind: "take", still: { id: "g-2", n: 2 }, engine: "veo", credits: CREDITS.take.veo }]);
    const riding = planTurn({ move: "crane-up" }, stateOf({ takeEngine: "veo", takeStart: { id: "g-2", n: 2, armedBy: "person" } }));
    expect(riding.steps).toEqual([{ kind: "motion", move: "crane-up", layEnd: false }]);
    // The chat's own take set up again after a new person cancelled it is the same take: it keeps its engine.
    const again = planTurn(
      { characterId: EVA },
      stateOf({ takeEngine: "veo", takeStart: { id: "g-2", n: 2, armedBy: "chat" }, takeMove: { move: "push-in", textures: [] } }),
    );
    expect(again.needs).toEqual([{ kind: "take", still: { id: "g-1", n: 1 }, engine: "veo", credits: CREDITS.take.veo }]);
  });

  it("an armed take keeps the move for its press; Film open makes it a beat, for later", () => {
    const kept = planTurn({ move: "crane-up" }, stateOf({ takeStart: { id: "g-2", n: 2, armedBy: "person" } }));
    expect(kept.steps).toEqual([{ kind: "motion", move: "crane-up", layEnd: false }]);
    const film = planTurn({ move: "crane-up" }, stateOf({ filmOpen: true }));
    expect(film.steps).toEqual([]);
    expect(film.cant).toEqual([{ code: "film_beats", said: null }]);
  });
});

describe("the hour and the light plot (spec §3.1 step 11)", () => {
  it("a time asked for alone under a plot with its own sun turns the plot off, so the hour shows", () => {
    const before = rigWith({ light: { ...GOLDEN_PLOT } });
    const { patch, clash } = lookPatch({ ids: ["time:night"] }, before, 30);
    expect(clash).toEqual({ kind: "plotOff", scheme: "golden-hour", hour: 21 });
    expect(patch).toEqual({ time: 21, light: null });
    const plan = planTurn({ rig: ["time:night"] }, stateOf({ rig: before }));
    expect(plan.notes).toEqual([{ kind: "hourPlotOff", scheme: "golden-hour", hour: 21 }]);
    expect(plan.needs).toEqual([]);
  });

  it("keeps moonlight at a night hour: it carries the hour", () => {
    expect(hourClash(rigWith({ light: { ...MOON_PLOT } }), rigWith({ light: { ...MOON_PLOT }, time: 21 }), { time: 21 })).toEqual({ kind: "moonKept", hour: 21 });
    const plan = planTurn({ rig: ["time:night"] }, stateOf({ rig: rigWith({ light: { ...MOON_PLOT } }) }));
    expect(plan.notes).toEqual([{ kind: "moonKept", hour: 21 }]);
    // Moonlight at a day hour hides the hour like any plot.
    expect(lookPatch({ ids: ["time:golden"] }, rigWith({ light: { ...MOON_PLOT } }), 0).clash).toEqual({ kind: "plotOff", scheme: "moonlight", hour: 17.5 });
  });

  it("a sun plot set while a time is set keeps both, says the hour waits, and offers the hour", () => {
    const plan = planTurn({ rig: ["light:golden-hour"] }, stateOf({ rig: rigWith({ time: 21 }) }));
    expect(plan.notes).toEqual([{ kind: "hourWaits", scheme: "golden-hour", hour: 21 }]);
    expect(plan.needs).toEqual([{ kind: "hour" }]);
    // A genre that brings a sun plot does the same: romance is golden hour.
    const romance = planTurn({ rig: ["genre:romance"] }, stateOf({ rig: rigWith({ time: 7 }) }));
    expect(romance.notes).toEqual([{ kind: "hourWaits", scheme: "golden-hour", hour: 7 }]);
    // Both in one message: both kept, the hour waits.
    const both = lookPatch({ ids: ["time:dawn", "light:hard-noon"] }, rigWith({}), 0);
    expect(both.clash).toEqual({ kind: "waits", scheme: "hard-noon", hour: 7 });
    expect(both.patch.light?.scheme).toBe("hard-noon");
    expect(both.patch.time).toBe(7);
  });

  it("says nothing when neither the time nor the light changed, or no plot brings a sun", () => {
    expect(hourClash(rigWith({ time: 21, light: { ...GOLDEN_PLOT } }), rigWith({ time: 21, light: { ...GOLDEN_PLOT }, stock: "film35" }), { stock: "film35" })).toBeNull();
    expect(lookPatch({ ids: ["time:night"] }, rigWith({}), 0).clash).toBeNull();
    expect(lookPatch({ ids: ["time:night", "light:practicals"] }, rigWith({}), 0).clash).toBeNull();
  });

  it("[Use the hour instead] is a button turn: the plot off, and never a shot", () => {
    const s = stateOf({ mode: "auto", source: "button", rig: rigWith({ time: 21, light: { ...GOLDEN_PLOT } }) });
    const plan = planTurn(USE_HOUR_READING, s);
    expect(plan.steps).toEqual([{ kind: "look", ids: ["light:as-built"] }]);
    expect(shootDecision(plan, s).kind).toBe("none");
  });

  it("an hour said as a clock time, and an exposure in thirds, ride the look step", () => {
    const plan = planTurn({ hour: 18.5, evThirds: 2 }, stateOf());
    expect(plan.steps).toEqual([{ kind: "look", ids: [], hour: 18.5, evThirds: 2 }]);
    expect(lookPatch({ ids: [], hour: 18.5, evThirds: 2 }, rigWith({}), 0).patch).toEqual({ time: 18.5, ev: 0.667 });
  });
});

describe("what happens and the outfit (spec §3.1 step 12)", () => {
  it("keeps and adds only the person's own pieces", () => {
    const plan = planTurn({ happens: { keep: ["She leans on the car"], add: ["she's smiling"] } }, stateOf({ direction: "She leans on the car." }));
    expect(plan.steps).toEqual([{ kind: "words", happens: { text: "She leans on the car. She's smiling.", cut: null }, outfitOff: false }]);
  });

  it("a cut direction is said and holds the shot", () => {
    const long = "x".repeat(200);
    const plan = planTurn({ happens: { keep: [], add: [`${long} one`, `${long} two`] } }, stateOf());
    expect(plan.directionCut).not.toBeNull();
    expect(shootDecision(plan, stateOf({ mode: "auto" }))).toEqual({ kind: "none", held: ["cut"], offer: "still" });
  });

  it("sets the saved outfit aside only for someone who has one", () => {
    const marco = planTurn({ happens: { keep: [], add: ["She wears the racing suit"] }, wardrobe: true }, stateOf());
    expect(marco.steps).toEqual([{ kind: "words", happens: { text: "She wears the racing suit.", cut: null }, outfitOff: true }]);
    expect(marco.notes).toEqual([{ kind: "outfitOff", characterId: MARCO }]);
    const eva = planTurn({ happens: { keep: [], add: ["She wears the racing suit"] }, wardrobe: true }, stateOf({ characterId: EVA }));
    expect(eva.steps).toEqual([{ kind: "words", happens: { text: "She wears the racing suit.", cut: null }, outfitOff: false }]);
    expect(eva.notes).toEqual([]);
  });

  it("clearing an empty direction is already so", () => {
    expect(planTurn({ happens: { keep: [], add: [] } }, stateOf()).already).toEqual(["happens"]);
  });
});

describe("the Astra card (spec §3.2, the owner's decision 1)", () => {
  const change: ShotReading = { setChange: { said: "add a row of flags along the pit wall", gloss: "a row of small flags", cut: false } };
  const card = (over: Partial<PageState>) => planTurn(change, stateOf(over)).needs[0];

  it("is always a card with the person's words, in every mode, for every account — never a step", () => {
    for (const mode of ["ask", "auto"] as TurnMode[]) {
      const plan = planTurn({ ...change, shoot: true }, stateOf({ mode }));
      expect(plan.steps).toEqual([]);
      expect(plan.needs).toEqual([{ kind: "astra", said: "add a row of flags along the pit wall", gloss: "a row of small flags", seal: null, cut: false, card: "ask", canGo: true }]);
      expect(shootDecision(plan, stateOf({ mode }))).toEqual({ kind: "none", held: ["astra"], offer: "still" });
    }
  });

  it("says the five things §3.2 says, with no button when nothing can come of the press", () => {
    expect(card({ editsLeft: 4, editsCap: 4 })).toMatchObject({ card: "ask", canGo: true });
    expect(card({ editsLeft: 1, editsCap: 4 })).toMatchObject({ card: "askLast", canGo: true });
    expect(card({ editsLeft: null, editsCap: -1 })).toMatchObject({ card: "askOpen", canGo: true });
    expect(card({ editsLeft: null, editsCap: 4 })).toMatchObject({ card: "askUnknown", canGo: true });
    expect(card({ editsLeft: 0, editsCap: 4 })).toMatchObject({ card: "none", canGo: false });
    expect(card({ editsLeft: null, editsCap: 0 })).toMatchObject({ card: "none", canGo: false });
    expect(card({ tooBig: true })).toMatchObject({ card: "tooBig", canGo: false });
  });

  it("on the Sets home's build turn, the place part is not sent again, and 'a different place' is not asked", () => {
    const plan = planTurn({ ...change, rig: ["time:golden"], cant: [{ code: "rebuild", said: null }, { code: "weather", said: null }] }, stateOf({ origin: "build" }));
    expect(plan.needs).toEqual([]);
    expect(plan.notes).toEqual([{ kind: "builtFromWords" }]);
    expect(plan.cant).toEqual([{ code: "weather", said: null }]);
    // A later message on the same set is not the build turn: the card is back.
    expect(planTurn(change, stateOf({ origin: null })).needs.map((n) => n.kind)).toEqual(["astra"]);
  });
});

describe("which one? (spec §3.5)", () => {
  it("waits for the tap, runs the rest, and holds the shot", () => {
    const s = stateOf({ mode: "auto" });
    const plan = planTurn({ near: { thing: { candidates: [CAR.key, CAR2] }, side: "beside" }, rig: ["time:night"] }, s);
    expect(plan.steps.map((x) => x.kind)).toEqual(["look"]);
    const which = plan.needs[0] as Extract<Need, { kind: "which" }>;
    expect(which).toEqual({ kind: "which", slot: "near", candidates: [CAR.key, CAR2], side: "beside" });
    expect(shootDecision(plan, s)).toEqual({ kind: "none", held: ["which"], offer: "still" });
    // The tap: a button turn with the thing chosen — no new reading, no shot.
    const tap = resolveWhich(plan.reading as ShotReading, which, CAR2);
    expect(tap).toEqual({ near: { thing: { key: CAR2 }, side: "beside" } });
    const tapState = stateOf({ mode: "auto", source: "button" });
    const tapped = planTurn(tap, tapState);
    expect(tapped.steps).toEqual([{ kind: "place", near: { key: CAR2, side: "beside" }, cameraFollows: true }]);
    expect(shootDecision(tapped, tapState).kind).toBe("none");
    expect(resolveWhich(plan.reading as ShotReading, which, "c_not_offered_0_0")).toEqual({});
  });

  it("an eye-line or a facing on things that fit equally waits the same way", () => {
    expect(planTurn({ gaze: { candidates: [CAR.key, CAR2] } }, stateOf()).needs).toEqual([{ kind: "which", slot: "gaze", candidates: [CAR.key, CAR2] }]);
    expect(planTurn({ facing: { candidates: [CAR.key, CAR2] } }, stateOf()).needs).toEqual([{ kind: "which", slot: "facing", candidates: [CAR.key, CAR2] }]);
  });

  it("a mark and a thing at once: the mark is kept, the thing is named as not matched", () => {
    const plan = planTurn({ markId: "m2", near: { thing: { key: CAR.key }, side: "front" } }, stateOf());
    expect(plan.steps).toEqual([{ kind: "place", markId: "m2", cameraFollows: true }]);
    expect(plan.notes).toEqual([{ kind: "placeKept", markId: "m2" }]);
    expect(plan.dropped).toEqual(["near"]);
  });
});

describe("the shoot matrix (spec §3.3), every cell", () => {
  const MODES: TurnMode[] = ["talk", "ask", "auto"];
  const row = (r: ShotReading | null, over: Partial<PageState> = {}) => MODES.map((mode) => decide(r, { ...over, mode }));
  const kindsOf = (ds: ReturnType<typeof row>) => ds.map((d) => d.kind);
  const person: TakeStart = { id: "g-2", n: 2, armedBy: "person" };
  const chat: TakeStart = { id: "g-2", n: 2, armedBy: "chat" };

  it("a message that asks to shoot, with nothing holding it: none, still, still — the person's own take when armed", () => {
    expect(kindsOf(row({ shoot: true }))).toEqual(["none", "still", "still"]);
    expect(kindsOf(row({ shoot: true }, { takeStart: person }))).toEqual(["none", "take", "take"]);
  });

  it("a message that changes the frame: only Shoot without asking shoots", () => {
    expect(kindsOf(row({ steps: ["closer"] }))).toEqual(["none", "none", "still"]);
    expect(kindsOf(row({ steps: ["closer"] }, { takeStart: person }))).toEqual(["none", "none", "take"]);
    // Nothing really changed on the stage: nothing to shoot.
    const s = stateOf({ mode: "auto" });
    expect(shootDecision(planTurn({ steps: ["closer"] }, s), s, { changed: false }).kind).toBe("none");
  });

  it("a message with a blocker shoots nothing, and offers [Shoot as it is] only when a shot was asked or due", () => {
    const blocked: [string, ShotReading, Partial<PageState>][] = [
      ["cant", { rig: ["time:night"], cant: [{ code: "weather", said: "rain" }] }, {}],
      ["dropped", { rig: ["time:night"] }, { dropped: ["who"] }],
      ["which", { rig: ["time:night"], near: { thing: { candidates: [CAR.key, CAR2] }, side: "beside" } }, {}],
      ["astra", { rig: ["time:night"], setChange: { said: "remove the barriers", gloss: null, cut: false } }, {}],
      ["hour", { rig: ["light:golden-hour"] }, { rig: rigWith({ time: 21 }) }],
      ["take", { steps: ["closer"] }, { takeStart: chat }],
      ["cut", { happens: { keep: [], add: ["a".repeat(200), "b".repeat(200)] } }, {}],
      ["messageCut", { rig: ["time:night"] }, { messageCut: true }],
      ["who", { characterId: LENA, rig: ["time:night"] }, {}],
    ];
    for (const [blocker, reading, over] of blocked) {
      const quiet = row(reading, over);
      expect(quiet.map((d) => [d.kind, d.offer]), blocker).toEqual([
        ["none", null],
        ["none", null],
        ["none", "still"],
      ]);
      expect(quiet[2].held, blocker).toContain(blocker);
      const asked = row({ ...reading, shoot: true }, over);
      expect(asked.map((d) => [d.kind, d.offer]), blocker).toEqual([
        ["none", null],
        ["none", "still"],
        ["none", "still"],
      ]);
    }
    // A reading that failed or was limited: nothing, whatever the mode (decision 2).
    for (const why of ["down", "limited"] as const) expect(kindsOf(row(null, { why }))).toEqual(["none", "none", "none"]);
    expect(decide({ shoot: true }, { why: "down", mode: "auto" })).toEqual({ kind: "none", held: ["why"], offer: null });
  });

  it("a question, or an undo, never shoots", () => {
    expect(kindsOf(row({ ask: ["lens"] }))).toEqual(["none", "none", "none"]);
    expect(kindsOf(row({ idea: "A low sun behind him.", suggest: [{ height: "low" }] }))).toEqual(["none", "none", "none"]);
    expect(kindsOf(row({ undo: true }))).toEqual(["none", "none", "none"]);
    expect(kindsOf(row({ cant: [{ code: "roll", said: "Dutch angle" }], suggest: [{ height: "low" }] }))).toEqual(["none", "none", "none"]);
  });

  it("Do it, which-one, Use the hour, Undo, Not now and Use my words are buttons: never a shot, in any mode", () => {
    for (const reading of [{ steps: ["closer"] }, { shoot: true, rig: ["time:night"] }, USE_HOUR_READING, { undo: true }, { happens: { keep: [], add: ["my words"] } }] as ShotReading[]) {
      expect(kindsOf(row(reading, { source: "button" }))).toEqual(["none", "none", "none"]);
      expect(kindsOf(row(reading, { source: "button", takeStart: person }))).toEqual(["none", "none", "none"]);
    }
  });

  it("[Try again] reads again but never shoots; it offers [Shoot as it is] instead (check of the spec, item 1)", () => {
    expect(row({ shoot: true }, { source: "retry" }).map((d) => [d.kind, d.offer])).toEqual([
      ["none", null],
      ["none", "still"],
      ["none", "still"],
    ]);
    expect(decide({ steps: ["closer"] }, { source: "retry", mode: "auto" })).toEqual({ kind: "none", held: ["retry"], offer: "still" });
  });

  it("the priced buttons shoot what their label says, in every mode", () => {
    const s = (takeStart: TakeStart | null) => stateOf({ takeStart });
    expect(pressFor("doItShoot", s(chat))).toEqual({ kind: "still", credits: CREDITS.still, afterSave: false });
    expect(pressFor("shootAsIs", s(null))).toEqual({ kind: "still", credits: CREDITS.still, afterSave: false });
    expect(pressFor("shootAsIs", s(person))).toEqual({ kind: "take", credits: CREDITS.take.omni, afterSave: false });
    expect(pressFor("take", s(chat))).toEqual({ kind: "take", credits: CREDITS.take.omni, afterSave: false });
    expect(pressFor("doItTake", stateOf({ takeStart: chat, takeEngine: "veo" }))).toEqual({ kind: "take", credits: CREDITS.take.veo, afterSave: false });
    expect(pressFor("astraThenShoot", s(null))).toEqual({ kind: "still", credits: CREDITS.still, afterSave: true });
  });

  it("⌘K's Shoot, the '/' Shoot and an empty Enter never render the chat's take, and say the price of what they do", () => {
    expect(pressFor("shoot", stateOf({ takeStart: chat }))).toEqual({ kind: "still", credits: CREDITS.still, afterSave: false });
    expect(pressFor("shoot", stateOf({ takeStart: person }))).toEqual({ kind: "take", credits: CREDITS.take.omni, afterSave: false });
    expect(pressFor("shoot", stateOf({ takeStart: null }))).toEqual({ kind: "still", credits: CREDITS.still, afterSave: false });
  });

  it("the chat's take waits for its priced press on every later turn: 'a bit closer' in Shoot without asking takes nothing and asks again", () => {
    const s = stateOf({ mode: "auto", takeStart: chat });
    const plan = planTurn({ steps: ["closer"] }, s);
    expect(shootDecision(plan, s)).toEqual({ kind: "none", held: ["take"], offer: "still" });
    expect(plan.needs).toEqual([{ kind: "take", still: { id: "g-2", n: 2 }, engine: "omni", credits: CREDITS.take.omni }]);
    // Asked to shoot in Ask before shooting: the take waits, [Take · n] and [Shoot as it is · n] are both offered.
    const ask = stateOf({ takeStart: chat });
    const asked = planTurn({ shoot: true }, ask);
    expect(shootDecision(asked, ask)).toEqual({ kind: "none", held: ["take"], offer: "still" });
    expect(asked.needs.map((n) => n.kind)).toEqual(["take"]);
    // No message, mode or shot of this turn renders it: the matrix never answers "take" for a chat-armed take.
    for (const mode of MODES) {
      for (const reading of [{ shoot: true }, { steps: ["closer"] }, { rig: ["time:night"], shoot: true }] as ShotReading[]) {
        expect(decide(reading, { mode, takeStart: chat }).kind).not.toBe("take");
      }
    }
  });

  it("the person's own take renders when a frame changes in Shoot without asking", () => {
    expect(decide({ steps: ["closer"] }, { mode: "auto", takeStart: person })).toEqual({ kind: "take", held: [], offer: null });
  });

  it("a 'not yet' the stage met (a raise past what words do) holds it too", () => {
    const s = stateOf({ mode: "auto" });
    expect(shootDecision(planTurn({ steps: ["higher"] }, s), s, { changed: true, cant: true })).toEqual({ kind: "none", held: ["cant"], offer: "still" });
  });

  it("Just talking shows what it would do and runs nothing; Do it runs it as a button turn", () => {
    const talk = stateOf({ mode: "talk" });
    const plan = planTurn({ rig: ["time:night"], setChange: { said: "remove the barriers", gloss: null, cut: false }, shoot: true }, talk);
    expect(plan.kind).toBe("proposal");
    expect(plan.needs).toEqual([]);
    expect(plan.notes).toEqual([]);
    expect(shootDecision(plan, talk).kind).toBe("none");
    const doIt = stateOf({ mode: "talk", source: "button" });
    const ran = planTurn(plan.reading as ShotReading, doIt);
    expect(ran.kind).toBe("run");
    expect(ran.steps.map((s) => s.kind)).toEqual(["look"]);
    expect(ran.needs.map((n) => n.kind)).toEqual(["astra"]);
    expect(shootDecision(ran, doIt).kind).toBe("none");
  });
});

describe("the priced second button (spec §3.6)", () => {
  const second = (r: ShotReading, over: Partial<PageState> = {}) => {
    const s = stateOf({ source: "button", ...over });
    return secondButton(planTurn(r, s), s);
  };

  it("is a still's price for a frame, and the take's for a move that has a still to start on", () => {
    expect(second({ size: "wide", rig: ["time:night"] })).toEqual({ kind: "shoot", credits: CREDITS.still });
    expect(second({ move: "push-in" })).toEqual({ kind: "take", credits: CREDITS.take.omni });
    expect(second({ move: "push-in", engine: "veo" })).toEqual({ kind: "take", credits: CREDITS.take.veo });
    expect(second({ size: "wide" }, { takeStart: { id: "g-2", n: 2, armedBy: "person" } })).toEqual({ kind: "take", credits: CREDITS.take.omni });
    // A move that rides the chat's waiting take is a priced Take press; a frame alone is a still.
    expect(second({ move: "arc-left" }, { takeStart: { id: "g-2", n: 2, armedBy: "chat" } })).toEqual({ kind: "take", credits: CREDITS.take.omni });
    expect(second({ size: "wide" }, { takeStart: { id: "g-2", n: 2, armedBy: "chat" } })).toEqual({ kind: "shoot", credits: CREDITS.still });
  });

  it("is none for a move with no still to start on, and for a change to the set (its card has its own)", () => {
    expect(second({ move: "push-in" }, { characterId: EVA, shots: [SHOTS[0]] })).toBeNull();
    expect(second({ setChange: { said: "remove the barriers", gloss: null, cut: false } })).toBeNull();
    // The Just-talking preview works it out the same way.
    const talk = stateOf({ mode: "talk" });
    expect(secondButton(planTurn({ move: "push-in" }, talk), talk)).toEqual({ kind: "take", credits: CREDITS.take.omni });
    expect(secondButton(planTurn({ move: "push-in" }, stateOf({ mode: "talk", characterId: EVA, shots: [SHOTS[0]] })), talk)).toBeNull();
  });

  // Review of Cut 2, S1 (2026-09-25): a row that still waits on something was offered "Do it and shoot · 1 credit".
  it("is none for a row that waits on a which-one, a take on a still of another shape, or a person who can't be cast", () => {
    const TWO_CARS = [CAR.key, CAR2];
    expect(second({ near: { thing: { candidates: TWO_CARS }, side: "beside" } })).toBeNull();
    expect(second({ gaze: { candidates: TWO_CARS } })).toBeNull();
    expect(second({ rig: ["format:square"] }, { takeStart: { id: "g-2", n: 2, armedBy: "person" } })).toBeNull();
    expect(second({ characterId: LENA, size: "wide" })).toBeNull();
    expect(second({ characterId: "not-a-character", size: "wide" })).toBeNull();
    // The Just-talking preview the same.
    const talk = stateOf({ mode: "talk" });
    expect(secondButton(planTurn({ near: { thing: { candidates: TWO_CARS }, side: "beside" } }, talk), talk)).toBeNull();
    expect(secondButton(planTurn({ characterId: LENA }, talk), talk)).toBeNull();
    // And in a suggestion row.
    const plan = planTurn({ suggest: [{ characterId: LENA, size: "wide" }, { size: "wide" }] }, stateOf());
    expect(plan.suggestions.map((x) => x.second)).toEqual([null, { kind: "shoot", credits: CREDITS.still }]);
  });

  it("a priced row shoots what it paid for only past nothing that holds it; held, it offers Shoot as it is (paidDecision)", () => {
    const button = stateOf({ source: "button" });
    expect(paidDecision(planTurn({ size: "wide" }, button), "still")).toEqual({ kind: "still", held: [], offer: null });
    expect(paidDecision(planTurn({ move: "push-in" }, button), "take")).toEqual({ kind: "take", held: [], offer: null });
    // A which-one the row ran into, a take on another shape, a person with no photo.
    expect(paidDecision(planTurn({ near: { thing: { candidates: [CAR.key, CAR2] }, side: "beside" } }, button), "still")).toEqual({ kind: "none", held: ["which"], offer: "still" });
    const person: TakeStart = { id: "g-2", n: 2, armedBy: "person" };
    expect(paidDecision(planTurn({ rig: ["format:square"] }, stateOf({ source: "button", takeStart: person })), "take")).toEqual({ kind: "none", held: ["takeFormat"], offer: "take" });
    expect(paidDecision(planTurn({ characterId: LENA, size: "wide" }, button), "still")).toEqual({ kind: "none", held: ["who"], offer: "still" });
    // The chat's own waiting take holds neither: a still leaves it waiting, "Do it and take" is its priced press.
    const chat = stateOf({ source: "button", takeStart: { id: "g-2", n: 2, armedBy: "chat" } });
    expect(paidDecision(planTurn({ size: "wide" }, chat), "still")).toEqual({ kind: "still", held: [], offer: null });
    expect(paidDecision(planTurn({ move: "arc-left" }, chat), "take")).toEqual({ kind: "take", held: [], offer: null });
  });

  it("each suggestion row carries its own, from the state the turn leaves", () => {
    const plan = planTurn({ suggest: [{ rig: ["light:contre-jour"], lensMm: 85 }, { move: "push-in" }, { move: "orbit-90", characterId: EVA }] }, stateOf());
    expect(plan.suggestions.map((s) => s.second)).toEqual([
      { kind: "shoot", credits: CREDITS.still },
      { kind: "take", credits: CREDITS.take.omni },
      { kind: "take", credits: CREDITS.take.omni },
    ]);
  });
});

describe("undo (spec §3.5)", () => {
  const stateNow = (over: Partial<TurnState> = {}): TurnState => ({
    characterId: MARCO,
    markId: "m1",
    mark: { x: MARK.x, z: MARK.z, facingDeg: 0 },
    pose: "stand",
    gaze: null,
    cameraId: "c2",
    camera: C2_POSE,
    rig: { ...NEW_SET_RIG },
    direction: "",
    frameX: "centre",
    takeStart: null,
    takeMove: null,
    takeEngine: "omni",
    outfitOff: false,
    look: { pinned: false },
    ...over,
  });

  it("is the whole turn: the rest of the message becomes a proposal with [Do it], and nothing shoots", () => {
    const plan = planTurn({ undo: true, rig: ["time:night"], ask: ["lens"], shoot: true }, stateOf({ mode: "auto" }));
    expect(plan.kind).toBe("undo");
    expect(plan.steps).toEqual([]);
    expect(plan.proposal).toEqual({ rig: ["time:night"] });
    expect(plan.ask).toEqual(["lens"]);
    expect(shootDecision(plan, stateOf({ mode: "auto" })).kind).toBe("none");
    expect(planTurn({ undo: true }, stateOf()).proposal).toBeNull();
  });

  it("brings the Astra change back through the seal, never through Astra; a rebuild's words were never changed", () => {
    const before = stateNow();
    const after = stateNow({ rig: rigWith({ time: 21 }) });
    const sealed: TurnSnapshot = { before, after, astra: { before: race, undo: { text: { title: "t", description: "d", labels: [] }, seal: "s" }, kind: "edit", landed: true } };
    expect(undoPlan([sealed], after, true)).toMatchObject({ kind: "restore", handMoves: false, astra: { kind: "edit", sealed: true }, stillsStay: false });
    const unsealed: TurnSnapshot = { ...sealed, astra: { before: race, undo: null, kind: "edit", landed: true } };
    expect(undoPlan([unsealed], after, true)).toMatchObject({ astra: { sealed: false } });
    const rebuild: TurnSnapshot = { ...sealed, astra: { before: race, undo: null, kind: "rebuild", landed: true } };
    expect(undoPlan([rebuild], after, true)).toMatchObject({ astra: { kind: "rebuild", sealed: true } });
    // Not landed, or no longer the set's latest: the stage steps back, the set is left alone.
    expect(undoPlan([{ ...sealed, astra: { ...sealed.astra!, landed: false } }], after, true)).toMatchObject({ astra: null });
    expect(undoPlan([sealed], after, false)).toMatchObject({ astra: null });
  });

  it("says when the person's own moves since then go too, when a still stays, and when there is nothing to undo", () => {
    const before = stateNow();
    const after = stateNow({ pose: "sit" });
    const moved = stateNow({ pose: "sit", mark: { x: MARK.x + 1, z: MARK.z, facingDeg: 0 } });
    expect(undoPlan([{ before, after, stillShot: true }], moved, false)).toMatchObject({ kind: "restore", handMoves: true, stillsStay: true });
    expect(undoPlan([], after, false)).toEqual({ kind: "none" });
  });

  // Review of Cut 2, S2 (2026-09-25): Undo re-armed a take the person had already rendered, as their own.
  it("brings a take back only while it is as that turn left it: a rendered, cancelled or replaced take is never set up again", () => {
    const person: TakeStart = { id: "g-2", n: 2, armedBy: "person" };
    const before = stateNow({ takeStart: person, takeEngine: "veo" });
    const after = stateNow({ takeStart: person, takeEngine: "veo", camera: { ...C2_POSE, fovDeg: 30 } });
    // The take rendered since (take() clears it), and the engine went back: Undo leaves it gone, and it's no move of theirs.
    const rendered = stateNow({ takeStart: null, takeEngine: "omni", camera: { ...C2_POSE, fovDeg: 30 } });
    const u = undoPlan([{ before, after }], rendered, false);
    if (u.kind !== "restore") throw new Error("restore");
    expect(u.restore.takeStart).toBeNull();
    expect(u.restore.takeEngine).toBe("omni");
    expect(u.restore.camera).toEqual(before.camera);
    expect(u.handMoves).toBe(false);
    expect(undoneTake({ before, after }, rendered)).toEqual({ takeStart: null, takeMove: null, takeEngine: "omni" });
    // So an automatic message after it shoots a still, never a take.
    const auto = stateOf({ mode: "auto", takeStart: u.restore.takeStart, takeEngine: u.restore.takeEngine });
    expect(shootDecision(planTurn({ size: "wide" }, auto), auto).kind).toBe("still");
    // Nothing since: the take the turn found comes back, with its engine.
    const same = undoPlan([{ before: stateNow(), after: stateNow({ takeStart: { ...person, armedBy: "chat" } }) }], stateNow({ takeStart: { ...person, armedBy: "chat" } }), false);
    if (same.kind !== "restore") throw new Error("restore");
    expect(same.restore.takeStart).toBeNull();
    const kept = undoPlan([{ before, after }], after, false);
    if (kept.kind !== "restore") throw new Error("restore");
    expect(kept.restore.takeStart).toEqual(person);
    expect(kept.restore.takeEngine).toBe("veo");
    // The person set another take up since: it stays.
    const other: TakeStart = { id: "g-1", n: 1, armedBy: "person" };
    const replaced = undoPlan([{ before, after }], stateNow({ takeStart: other, camera: { ...C2_POSE, fovDeg: 30 } }), false);
    if (replaced.kind !== "restore") throw new Error("restore");
    expect(replaced.restore.takeStart).toEqual(other);
  });

  // Review of Cut 2, U6 (2026-09-25).
  it("a look picked is part of the turn: Undo sees it, and a look that follows the newest still is no one's move", () => {
    const before = stateNow();
    const after = stateNow({ look: { pinned: true, id: "g-1" } });
    expect(snapshotDiff(before, after)).toEqual(["look"]);
    // Following the newest still whatever it is: the same look.
    expect(snapshotDiff(stateNow({ look: { pinned: false } }), stateNow({ look: { pinned: false } }))).toEqual([]);
    const u = undoPlan([{ before, after }], after, false);
    if (u.kind !== "restore") throw new Error("restore");
    expect(u.restore.look).toEqual({ pinned: false });
    expect(u.handMoves).toBe(false);
  });

  it("the outfit flag a shot used up is no move of theirs (review of Cut 2, N2)", () => {
    const before = stateNow();
    const after = stateNow({ direction: "In a red coat.", outfitOff: true });
    const shot = stateNow({ direction: "In a red coat.", outfitOff: false });
    expect(undoPlan([{ before, after, stillShot: true }], shot, false)).toMatchObject({ kind: "restore", handMoves: false });
  });

  it("compares states to a thousandth, and keeps twelve turns", () => {
    const a = stateNow();
    expect(snapshotDiff(a, stateNow({ mark: { x: MARK.x + 0.0004, z: MARK.z, facingDeg: 0 } }))).toEqual([]);
    expect(snapshotDiff(a, stateNow({ frameX: "left_third", direction: "x" }))).toEqual(["direction", "frameX"]);
    let stack: TurnSnapshot[] = [];
    for (let i = 0; i < 15; i++) stack = keepSnapshot(stack, { before: a, after: stateNow({ direction: String(i) }) });
    expect(stack).toHaveLength(TURN_UNDO_MAX);
    expect(stack.at(-1)?.after.direction).toBe("14");
  });
});

describe("where she stands (spec §3.1 step 6)", () => {
  const box = { min: [-2, 0, -1] as [number, number, number], max: [2, 1.5, 1] as [number, number, number], centre: [0, 0.75, 0] as [number, number, number] };
  const camera: CameraPose = { position: [0, 1.5, 10], target: [0, 1, 0], fovDeg: 40 };
  const out = PERSON_RADIUS_PLUS();
  function PERSON_RADIUS_PLUS() {
    return 0.3 + NEAR_CLEARANCE_M;
  }

  it("stands her past a thing's edge by her radius and 0.15 m, on the picture's sides", () => {
    expect(pointBeside(box, "front", { camera, mark: { x: 5, z: 0 } })).toEqual({ x: 0, z: 1 + out });
    expect(pointBeside(box, "back", { camera, mark: { x: 5, z: 0 } })).toEqual({ x: 0, z: -(1 + out) });
    // The camera at +Z looks toward −Z: its right is +X.
    expect(pointBeside(box, "right", { camera, mark: { x: 5, z: 0 } })).toEqual({ x: 2 + out, z: 0 });
    expect(pointBeside(box, "left", { camera, mark: { x: 5, z: 0 } })).toEqual({ x: -(2 + out), z: 0 });
    // Beside: whichever side is nearer where she stands, so she moves the least.
    expect(pointBeside(box, "beside", { camera, mark: { x: 5, z: 0 } })).toEqual({ x: 2 + out, z: 0 });
    expect(pointBeside(box, "beside", { camera, mark: { x: -5, z: 3 } })).toEqual({ x: -(2 + out), z: 0 });
    // Held inside the set.
    expect(pointBeside(box, "right", { camera, mark: { x: 0, z: 0 }, bounds: { x: 4, z: 10 } })).toEqual({ x: 1.7, z: 0 });
  });

  it("a car's front and back are its own, read from its lamps", () => {
    const vehicles = findVehicles(race);
    const v = vehicleOf(CAR, vehicles);
    expect(v?.frontDeg).toBe(0);
    const front = pointBeside(CAR, "front", { camera: C2_POSE, mark: MARK }, v);
    expect(front.x).toBeCloseTo(v!.x, 2);
    expect(front.z).toBeCloseTo(v!.z + v!.halfLength + out, 2);
    const back = pointBeside(CAR, "back", { camera: C2_POSE, mark: MARK }, v);
    expect(back.z).toBeCloseTo(v!.z - v!.halfLength - out, 2);
    expect(vehicleOf({ ...CAR, kind: "object" }, vehicles)).toBeNull();
  });

  it("a nudge is in the picture's terms, and the camera can follow by the same offset", () => {
    const m = { x: 0, z: 0, facingDeg: 30 };
    expect(nudgeMark(m, camera, 2, 0)).toEqual({ x: 2, z: 0, facingDeg: 30 });
    expect(nudgeMark(m, camera, -2, 1)).toEqual({ x: -2, z: 1, facingDeg: 30 });
    expect(shiftPose(camera, { x: 0, z: 0 }, { x: -2, z: 1 })).toEqual({ position: [-2, 1.5, 11], target: [-2, 1, 1], fovDeg: 40 });
  });

  it("the camera follows a nudge or a new place unless the words moved the camera themselves", () => {
    expect(planTurn({ nudge: { right: -2, toward: 0 } }, stateOf()).steps).toEqual([{ kind: "place", nudge: { right: -2, toward: 0 }, cameraFollows: true }]);
    expect(planTurn({ nudge: { right: -2, toward: 0 }, side: "back" }, stateOf()).steps[0]).toMatchObject({ kind: "place", cameraFollows: false });
    expect(planTurn({ markId: "m2" }, stateOf()).steps).toEqual([{ kind: "place", markId: "m2", cameraFollows: true }]);
  });
});

describe("facing and eye-line (spec §3.1 steps 9 and 10)", () => {
  it("turns from the way she faces: her own left, right, around", () => {
    expect(turnedFacing(0, "left")).toBe(30);
    expect(turnedFacing(10, "right")).toBe(340);
    expect(turnedFacing(90, "around")).toBe(270);
    expect(facingToward({ x: 0, z: 0 }, { x: 3, z: 0 })).toBe(90);
  });

  it("looks at a thing's largest block, the camera, nothing, or a point out of frame on her side", () => {
    expect(largestObjectOf(CAR, race.objects)).not.toBeNull();
    const m = { x: 1, z: 2, facingDeg: 0 };
    expect(gazeFor("camera", m)).toEqual({ at: "camera" });
    expect(gazeFor("none", m)).toBeNull();
    expect(gazeFor({ objectIndex: 3 }, m)).toEqual({ at: "object", index: 3 });
    expect(gazeFor({ side: "ahead" }, m)).toEqual({ at: "point", x: 1, z: 2 + GAZE_POINT_M });
    expect(gazeFor({ side: "left" }, m)).toEqual({ at: "point", x: 1 + GAZE_POINT_M, z: 2 });
    expect(gazeFor({ side: "right" }, m)).toEqual({ at: "point", x: 1 - GAZE_POINT_M, z: 2 });
    expect(gazeFor({ side: "behind" }, m)).toEqual({ at: "point", x: 1, z: 2 - GAZE_POINT_M });
  });
});

describe("the camera's word steps (spec §3.5, check of the spec item 6)", () => {
  const facing = { facingDeg: 0 };
  const spot = (over: Partial<CameraSpot> = {}): CameraSpot => ({ bearingDeg: 30, distanceM: 2.4, heightM: 1.45, pitchDeg: 0, fovDeg: fovForLens(50), ...over });
  const step = (s: Parameters<typeof cameraStep>[0], over: Partial<CameraSpot> = {}) => cameraStep(s, spot(over), facing);

  it("closer and further by a quarter, never nearer than 0.6 m", () => {
    expect(step("closer").spot.distanceM).toBeCloseTo(1.8, 6);
    expect(step("further").spot.distanceM).toBeCloseTo(3.2, 6);
    expect(step("closer", { distanceM: 0.7 })).toMatchObject({ spot: { distanceM: 0.6 }, clamp: "near" });
    expect(step("closer", { distanceM: 0.5 }).spot.distanceM).toBe(0.5);
  });

  it("lower stops at 0.3 m and never raises; from an 8 m camera it is 7.6 m, not 2.6", () => {
    expect(step("lower")).toMatchObject({ clamp: null, cant: null });
    expect(step("lower").spot.heightM).toBeCloseTo(1.05, 6);
    expect(step("lower", { heightM: 0.7 })).toMatchObject({ spot: { heightM: 0.3 }, clamp: "low" });
    expect(step("lower", { heightM: 0.2 }).spot.heightM).toBe(0.2);
    expect(step("lower", { heightM: 8 }).spot.heightM).toBeCloseTo(7.6, 6);
  });

  it("higher raises to 2.6 m at most, says 'not yet' past it, and never lowers a camera already above it", () => {
    expect(step("higher").spot.heightM).toBeCloseTo(1.85, 6);
    expect(step("higher", { heightM: 2.2 })).toMatchObject({ spot: { heightM: 2.6 }, clamp: "high", cant: null });
    expect(step("higher", { heightM: 2.4 })).toMatchObject({ spot: { heightM: 2.6 }, clamp: "high", cant: "altitude" });
    expect(step("higher", { heightM: 6 })).toMatchObject({ spot: { heightM: 6 }, clamp: "high", cant: "altitude" });
  });

  // Review of Cut 2, U3 (2026-09-25): the steps kept the tilt, so "lower"
  // from eye level, or "closer" from a low or high framing, pushed her eyes
  // out of the picture.
  it("closer, further, higher and lower keep her eyes inside the band, from a high, an eye-level and a low start", () => {
    const eye = 1.65;
    const band = formatFrame("wide").heightShare;
    const half = Math.atan(band * Math.tan((fovForLens(50) * DEG) / 2)) / DEG;
    const offAxis = (sp: CameraSpot) => Math.atan2(eye - sp.heightM, sp.distanceM) / DEG - sp.pitchDeg;
    const eyeFrom = (h: number, d: number) => Math.atan2(eye - h, d) / DEG;
    const starts: Record<string, CameraSpot> = {
      "eye-level close-up": spot({ distanceM: 1, heightM: 1.65, pitchDeg: 0 }),
      "high close-up": spot({ distanceM: 1.2, heightM: 2.4, pitchDeg: eyeFrom(2.4, 1.2) }),
      // 0.7 m high, 2.4 m away, her eyes near the top of the band (the review's probe had them at +0.76).
      "low medium": spot({ distanceM: 2.4, heightM: 0.7, pitchDeg: eyeFrom(0.7, 2.4) - 0.76 * half }),
    };
    for (const [name, start] of Object.entries(starts)) {
      expect(Math.abs(offAxis(start)), name).toBeLessThanOrEqual(half);
      for (const st of ["closer", "further", "higher", "lower"] as const) {
        const after = cameraStep(st, start, facing, undefined, eye, band).spot;
        expect(Math.abs(offAxis(after)), `${name}, ${st}`).toBeLessThan(half);
        // Within EYE_ROOM, unless the stage's own tilt limit stopped the camera following her.
        if (after.pitchDeg < SET_MAX_TILT_UP_DEG - 1e-6) expect(Math.abs(offAxis(after)), `${name}, ${st}`).toBeLessThanOrEqual(Math.max(half * EYE_ROOM, Math.abs(offAxis(start))) + 1e-6);
      }
      // And a chain of them, each from the last (inside what the stage can tilt: from 0.3 m and a metre away, +20° can't reach her eyes).
      const chained = cameraSteps(["closer", "higher", "further", "lower"], start, facing, undefined, eye, band).spot;
      expect(Math.abs(offAxis(chained)), `${name}, chained`).toBeLessThan(half);
    }
    // "No, lower" from the low medium looks up at her from 0.3 m instead of keeping its tilt.
    const lower = cameraStep("lower", starts["low medium"], facing, undefined, eye, band).spot;
    expect(lower.heightM).toBeCloseTo(0.3, 6);
    expect(lower.pitchDeg).toBeGreaterThan(starts["low medium"].pitchDeg);
    // What it aimed at stays where it was when her eyes are in anyway: "further" from eye level keeps the level aim.
    expect(cameraStep("further", starts["eye-level close-up"], facing, undefined, eye, band).spot.pitchDeg).toBeCloseTo(0, 6);
    // tilt_up and tilt_down still change the tilt itself.
    expect(cameraStep("tilt_down", starts["eye-level close-up"], facing, undefined, eye, band).spot.pitchDeg).toBeCloseTo(-5, 6);
  });

  it("left and right orbit the camera to its own side by 20°; the other side mirrors across her facing", () => {
    expect(step("right").spot.bearingDeg).toBe(50);
    expect(step("left").spot.bearingDeg).toBe(10);
    expect(step("left", { bearingDeg: 5 }).spot.bearingDeg).toBe(345);
    // From the front left (her left is +, people.ts) to the front right.
    expect(step("other_side", { bearingDeg: 40 }).spot.bearingDeg).toBe(320);
    // On her facing line, front and back swap.
    expect(step("other_side", { bearingDeg: 0 }).spot.bearingDeg).toBe(180);
    expect(step("other_side", { bearingDeg: 180 }).spot.bearingDeg).toBe(0);
  });

  it("tilts 5° a step within the stage's limits, and steps the lens along the listed ones", () => {
    expect(step("tilt_up").spot.pitchDeg).toBe(5);
    expect(step("tilt_down", { pitchDeg: -78 })).toMatchObject({ spot: { pitchDeg: -SET_MAX_TILT_DOWN_DEG }, clamp: "tilt" });
    expect(step("tilt_up", { pitchDeg: 18 })).toMatchObject({ spot: { pitchDeg: SET_MAX_TILT_UP_DEG }, clamp: "tilt" });
    expect(step("wider").spot.fovDeg).toBeCloseTo(fovForLens(35), 6);
    expect(step("longer").spot.fovDeg).toBeCloseTo(fovForLens(85), 6);
    expect(step("wider", { fovDeg: fovForLens(18) })).toMatchObject({ clamp: "widest" });
    expect(step("longer", { fovDeg: fovForLens(135) })).toMatchObject({ clamp: "longest" });
    // On the rig's own body: 50 mm on Super 35 steps to 85 mm on Super 35.
    const s35 = sensorHeightMm("super35", "wide");
    expect(cameraStep("longer", spot({ fovDeg: fovForLens(50, s35) }), facing, s35).spot.fovDeg).toBeCloseTo(fovForLens(85, s35), 6);
  });

  it("chains up to four, in order: exchange 2's 'no, lower — and from the other side'", () => {
    const r = cameraSteps(["lower", "other_side"], spot({ bearingDeg: 40, heightM: 0.7 }), facing);
    expect(r.spot).toMatchObject({ heightM: 0.3, bearingDeg: 320 });
    expect(r.clamps).toEqual(["low"]);
    expect(r.cant).toBeNull();
  });

  it("reads a pose back as a spot, and a spot as the matched shot the solver places on that bearing", () => {
    const s = cameraSpotOf(C2_POSE, MARK);
    expect(s.bearingDeg).toBeCloseTo(bearingOf(C2.position, MARK), 6);
    expect(s.heightM).toBe(C2.position[1]);
    const { match, from } = spotToMatch({ ...s, heightM: 0.7 }, MARK);
    const solved = solveMatchPose(match, { mark: MARK, current: from, referenceAspect: 1, bounds: race.bounds, canvasAspect: 1.5 });
    expect(bearingOf(solved.pose.position, MARK)).toBeCloseTo(s.bearingDeg, 3);
    expect(solved.pose.position[1]).toBeCloseTo(0.7, 6);
    expect(solved.pose.fovDeg).toBeCloseTo(C2.fovDeg, 6);
  });
});

describe("the thirds (the owner's decision 5)", () => {
  /** Where the mark falls across the band, 0 at its left edge: the mark's vertical line where it crosses the screen's horizontal centre line. */
  function projectX(pose: CameraPose, mark: { x: number; z: number }, band: { bandAspect: number; heightShare: number }): number {
    const [cx, cy, cz] = pose.position;
    const f0 = [pose.target[0] - cx, pose.target[1] - cy, pose.target[2] - cz];
    const fl = Math.hypot(...f0);
    const f = f0.map((v) => v / fl);
    const r0 = [-f[2], 0, f[0]];
    const rl = Math.hypot(...r0);
    const right = r0.map((v) => v / rl);
    const up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
    const y = cy - ((mark.x - cx) * up[0] + (mark.z - cz) * up[2]) / up[1];
    const d = [mark.x - cx, y - cy, mark.z - cz];
    const sx = (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / (d[0] * f[0] + d[1] * f[1] + d[2] * f[2]);
    const half = band.bandAspect * Math.min(1, band.heightShare) * Math.tan((pose.fovDeg * DEG) / 2);
    return 0.5 + (0.5 * sx) / half;
  }

  function solveThird(format: RigFormat, frameX: "left_third" | "centre" | "right_third", words: { size?: "medium" | "wide"; height?: "eye" | "high" | "low" } = {}) {
    const band = formatFrame(format, 1);
    const sensor = sensorHeightMm("fullframe", format);
    const { match, from } = wordsToMatch(
      { side: null, size: words.size ?? "medium", height: words.height ?? "eye", tiltDeg: null, lensMm: 50 },
      { mark: MARK, current: C2_POSE, sensorHeightMm: sensor, frame: { heightShare: band.heightShare } },
    );
    const framed = framedMatch(match, frameX, band);
    const solved = solveMatchPose(framed.match, { mark: MARK, current: from, referenceAspect: 1, bounds: race.bounds, canvasAspect: 1.5, frame: framed.frame });
    return { band, sensor, match, framed, solved };
  }

  it("hands the solver the band's field of view, which its widening turns back into the render's exactly", () => {
    for (const format of ["wide", "scope", "vertical", "classic", "square"] as RigFormat[]) {
      const hs = formatFrame(format, 1).heightShare;
      for (const fov of [10, 26.99, 40, 73.7]) expect(widenFovDeg(bandFovDeg(fov, hs), 1 / Math.min(1, hs))).toBeCloseTo(fov, 9);
    }
    expect(bandFovDeg(40, 1.18)).toBeCloseTo(40, 9);
  });

  it("50 mm on Scope stays 50 mm with her on the left third, and her mark lands a third in", () => {
    const { solved, sensor, band } = solveThird("scope", "left_third");
    expect(Math.abs(solved.pose.fovDeg - fovForLens(50, sensor))).toBeLessThan(0.01);
    expect(Math.abs(projectX(solved.pose, MARK, band) - FRAME_X_AT.left_third)).toBeLessThan(0.01);
  });

  it("lands on either third on wide, Scope and vertical, level or tilted down from high", () => {
    for (const format of ["wide", "scope", "vertical"] as RigFormat[]) {
      for (const frameX of ["left_third", "right_third"] as const) {
        for (const height of ["eye", "high"] as const) {
          const { solved, band, sensor } = solveThird(format, frameX, { height });
          expect(Math.abs(solved.pose.fovDeg - fovForLens(50, sensor)), `${format} ${frameX} ${height} lens`).toBeLessThan(0.01);
          expect(Math.abs(projectX(solved.pose, MARK, band) - FRAME_X_AT[frameX]), `${format} ${frameX} ${height}`).toBeLessThan(0.01);
        }
      }
    }
  });

  it("'centre' is today's call, byte for byte: the same match, no frame", () => {
    const { match, framed } = solveThird("scope", "centre");
    expect(framed.match).toBe(match);
    expect("frame" in framed).toBe(false);
  });

  it("a later 'lower' keeps the third; a hand move, a named camera or a Match centres her", () => {
    const first = solveThird("wide", "left_third");
    const kept = frameXAfter("left_third", { kind: "words" });
    expect(kept).toBe("left_third");
    const lowered = cameraStep("lower", cameraSpotOf(first.solved.pose, MARK), MARK, first.sensor);
    const { match, from } = spotToMatch(lowered.spot, MARK);
    const framed = framedMatch(match, kept, first.band);
    const again = solveMatchPose(framed.match, { mark: MARK, current: from, referenceAspect: 1, bounds: race.bounds, canvasAspect: 1.5, frame: framed.frame });
    expect(again.pose.position[1]).toBeCloseTo(first.solved.pose.position[1] - 0.4, 6);
    expect(Math.abs(again.pose.fovDeg - fovForLens(50, first.sensor))).toBeLessThan(0.01);
    expect(Math.abs(projectX(again.pose, MARK, first.band) - 1 / 3)).toBeLessThan(0.01);

    expect(frameXAfter("left_third", { kind: "hand" })).toBe("centre");
    expect(frameXAfter("left_third", { kind: "match" })).toBe("centre");
    expect(frameXAfter("left_third", { kind: "camera" })).toBe("centre");
    expect(frameXAfter("centre", { kind: "camera", frameX: "right_third" })).toBe("right_third");
    expect(frameXAfter("centre", { kind: "words", frameX: "right_third" })).toBe("right_third");
  });

  it("a third on its own is a camera step; the third already set is already so", () => {
    expect(planTurn({ frameX: "left_third" }, stateOf()).steps).toEqual([{ kind: "camera", frameX: "left_third" }]);
    expect(planTurn({ frameX: "left_third" }, stateOf({ frameX: "left_third" })).already).toEqual(["frameX"]);
    expect(changesFrame(planTurn({ frameX: "left_third" }, stateOf()))).toBe(true);
  });
});
