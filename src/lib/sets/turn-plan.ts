// The turn plan (Helios Cut 2, "Astra understands", step 7, 2026-09-25 —
// operator: "Run, keep going.").
//
// WHAT. One reading (shot-reading.ts ShotReading) becomes one ordered plan
// for the page (spec §3.1): who, the frame's shape, where they stand, the
// pose, the camera, the facing, the eye-line, the look and the light, what
// happens, a moving shot — every one free — then what needs a press before
// anything is spent (an Astra change, "which one?", a take the chat set
// up), the questions, the "not yet" items, and whether a picture is taken
// at all (shootDecision). The page runs the steps with the handlers it
// already has (set-view.tsx runTurn, step 11a) and the reply says what they
// did (turn-reply.ts, step 8). Nothing here moves the stage or spends.
//
// THE MONEY RULES (spec §3.8) are decided here, so each is a pure function
// a test holds cell by cell:
// - an Astra change is always a card with its press (the owner's decision 1);
// - a failed or limited reading plans nothing and shoots nothing (decision 2);
// - a "not yet", a part that didn't match, a pending card, a cut direction,
//   a question or an undo never shoots from a message (decision 3);
// - a take the chat set up renders only from a priced Take press, on this
//   turn or any later one (critic item 1), and a generic Shoot — ⌘K, "/",
//   an empty Enter — never renders it (check of the spec, item 1);
// - Do it, which-one, Use the hour, Not now, Undo and Try again never shoot.
//
// MEANING, NOT WORDS (his standard). Routing is by the reading's fields
// only: no regular expression and no read of the message anywhere in this
// file (a source pin holds it).
//
// Pure, relative imports only: the page and the tests share it.

import { fovForLens, LENSES_MM, nearestLens, STAND_IN_EYE_M } from "./build-scene";
import { rigPatchFor } from "./commands";
import { astraCardCanGo, astraCardKind, type AstraCardKind } from "./astra-card";
import type { EditUndo } from "./edit-seal";
import type { SetElement } from "./elements";
import { schemeHasSun } from "./light-schemes";
import type { CameraPose, ShotMatch } from "./match-shot";
import { PERSON_RADIUS_M } from "./marks";
import type { FilmMove, FilmTexture } from "./moves";
import type { Gaze } from "./people";
import { stepEv, type RigFormat, type RigLightScheme, type RigLightState, type SetRig } from "./rig";
import { SET_MAX_TILT_DOWN_DEG, SET_MAX_TILT_UP_DEG } from "./set-config";
import type { SetObject, SetSpec, StandPose } from "./set-spec";
import {
  composeHappens,
  isQuestionOnly,
  isUndoOnly,
  type CantCode,
  type FrameX,
  type GazeSide,
  type NearSide,
  type ReaderStep,
  type ReaderWhy,
  type ShotAct,
  type ShotReading,
  type ThingPick,
  type TurnWord,
} from "./shot-reading";
import { HEIGHT_M, type CameraHeight, type CameraSide, type FigureFacing, type LensMm, type ShotSize } from "./shot-words";
import { SET_TAKE_DEFAULT_ENGINE, type SetTakeEngine } from "./take";
import type { Vehicle } from "./vehicles";

// ---------------------------------------------------------------------------
// The numbers.
// ---------------------------------------------------------------------------

/** A turn of the figure in words, degrees (the page's ↺ ↻ step, set-view.tsx TURN_STEP). */
export const TURN_STEP_DEG = 30;
/** The camera's word steps (spec §3.5). */
export const WORD_STEP = {
  /** closer ×0.75, further ÷0.75, never nearer than MIN_DISTANCE_M (shot-words.ts). */
  distanceScale: 0.75,
  minDistanceM: 0.6,
  /** higher / lower, metres. */
  heightM: 0.4,
  /** The floor words lower the camera to. */
  minHeightM: 0.3,
  /** The ceiling words RAISE it to (HEIGHT_M.high): a camera already above it stays where it is (check of the spec, item 6). */
  maxHeightM: HEIGHT_M.high,
  /** left / right, round the figure. */
  orbitDeg: 20,
  /** tilt_up / tilt_down. */
  tiltDeg: 5,
} as const;
/** How far off the axis a word step lets her eyes go, as a share of the band's half-height: inside, with a little air (review of Cut 2, U3). */
export const EYE_ROOM = 0.8;
/** Beside a thing: its edge, the person's own radius (marks.ts), and this much air. */
export const NEAR_CLEARANCE_M = 0.15;
/** A look out of frame is at a point this far out on that side. */
export const GAZE_POINT_M = 4;
/** Where across the band the figure stands (solveMatchPose's subjectX): the thirds, owner's decision 5. */
export const FRAME_X_AT: Record<FrameX, number> = { left_third: 1 / 3, centre: 0.5, right_third: 2 / 3 };
/** Turns one visit keeps to undo, like the frame's revisions (set-view.tsx REVISIONS_MAX). */
export const TURN_UNDO_MAX = 12;

const DEG = Math.PI / 180;
const EPS = 1e-6;
const wrapDeg = (d: number) => ((d % 360) + 360) % 360;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ---------------------------------------------------------------------------
// The page, as the plan sees it.
// ---------------------------------------------------------------------------

/** The composer's three modes: Just talking, Ask before shooting, Shoot without asking. */
export type TurnMode = "talk" | "ask" | "auto";
/**
 * Where a turn came from: a message (typed, or the Sets home's); a button
 * that runs a stored reading (Do it, a which-one choice, Use the hour, Not
 * now); or [Try again] after a failed reading — a new message turn that
 * reads again but never shoots (check of the spec, item 1).
 */
export type TurnSource = "message" | "button" | "retry";
/** Who set a take up: the chat (renders only from a priced Take press) or the person, by hand. */
export type TakeArmedBy = "chat" | "person";
export type TakeStart = { id: string; n: number; armedBy: TakeArmedBy };
export type TakeMove = { move: FilmMove | null; textures: FilmTexture[] };
/** What the plan reads of a shot (types.ts SetShot): newest first, as the filmstrip holds them. */
export type PlanShot = { generationId: string; kind: "still" | "take"; status: string; format: RigFormat; characterId?: string | null };
/** One of the person's characters: castable only with a photo; `hasOutfit` when a saved outfit photo rides their shots. */
export type PlanCharacter = { id: string; name: string; hasPhoto: boolean; hasOutfit?: boolean };

export type PageState = {
  mode: TurnMode;
  source: TurnSource;
  /** "build" only on the Sets home's first message to a set it just built (the address's from=build). */
  origin?: "build" | null;
  /** How the reading came back; a button's stored reading is "ok". */
  why?: ReaderWhy;
  /** What the reading could not match (parseShotReading), by key name. */
  dropped?: readonly string[];
  /** The message was longer than the reader was given (600). */
  messageCut?: boolean;
  characterId: string | null;
  characters: readonly PlanCharacter[];
  markId: string | null;
  pose: StandPose;
  cameraId: string | null;
  frameX: FrameX;
  rig: SetRig;
  /** Where the camera stands from the figure now (light plots are aimed from it). */
  cameraBearingDeg: number;
  direction: string;
  takeStart: TakeStart | null;
  /** The move and textures kept for an armed take (set-view.tsx takeMoveRef). */
  takeMove?: TakeMove | null;
  takeEngine: SetTakeEngine;
  shots: readonly PlanShot[];
  filmOpen: boolean;
  editsLeft: number | null;
  editsCap: number;
  /** The working copy is past what Astra can answer whole (astra-card.ts astraTooBig). */
  tooBig: boolean;
  /** The month's Astra tries are spent (Helios Cut 4, step A3): the card is "paused", with no button. */
  paused?: boolean;
  /** The page's prices, as its own buttons show them: a still (quote.totalCredits) and a take per engine (take.ts takesCredits, one clip and one still). */
  credits: { still: number; take: Record<SetTakeEngine, number> };
};

// ---------------------------------------------------------------------------
// The plan.
// ---------------------------------------------------------------------------

/** One thing the page does, in the §3.1 order. Every one is free. */
export type Step =
  | { kind: "who"; characterId: string; was: string | null }
  | { kind: "takeCancel"; why: "who" | "format"; still: { id: string; n: number } }
  /** Frame ids (format:*, squeeze:*), applied with rigPatchFor before anything is solved: the band feeds the size and the thirds. */
  | { kind: "frame"; ids: string[]; format: RigFormat }
  | { kind: "place"; markId?: string; near?: { key: string; side: NearSide }; nudge?: { right: number; toward: number }; cameraFollows: boolean }
  | { kind: "pose"; pose: StandPose }
  | {
      kind: "camera";
      cameraId?: string;
      side?: CameraSide;
      size?: ShotSize;
      height?: CameraHeight;
      tiltDeg?: number;
      lensMm?: LensMm;
      frameX?: FrameX;
      steps?: ReaderStep[];
    }
  | { kind: "facing"; facing?: FigureFacing | { key: string }; turn?: TurnWord }
  | { kind: "gaze"; gaze: "camera" | "none" | { key: string } | { side: GazeSide } }
  /** The look and the light, applied with lookPatch from the camera's FINAL bearing. */
  | { kind: "look"; ids: string[]; hour?: number; evThirds?: number; look?: "newest" | "off" | number }
  | { kind: "words"; happens?: { text: string; cut: string | null }; outfitOff: boolean }
  | { kind: "takeArm"; still: { id: string; n: number } }
  /** A moving shot's move and textures, kept for the take; `layEnd` when the move lays the end frame (no camera keys). */
  | { kind: "motion"; move?: FilmMove; textures?: FilmTexture[]; engine?: SetTakeEngine; layEnd: boolean };

export type StepKind = Step["kind"];

/** What waits for a press before it happens. */
export type Need =
  /** `seal`: the server's over the words and the gloss (edit-seal.ts), without which the gloss never rides to Astra. */
  | { kind: "astra"; said: string; gloss: string | null; seal: string | null; cut: boolean; card: AstraCardKind; canGo: boolean }
  | { kind: "which"; slot: "near" | "facing" | "gaze"; candidates: string[]; side?: NearSide }
  /** [Use the hour instead]: a sun plot was set while a time is set. */
  | { kind: "hour" }
  /** [Take · n credits]: a take the chat set up, waiting for its priced press. */
  | { kind: "take"; still: { id: string; n: number }; engine: SetTakeEngine; credits: number }
  /** A take the person set up starts on a still of another shape than the frame now is (check of the spec, item 7). */
  | { kind: "takeFormat"; still: { id: string; n: number }; stillFormat: RigFormat; format: RigFormat };

/** What the plan says beside what it did. */
export type Note =
  | { kind: "notCastable"; characterId: string }
  | { kind: "whoUnknown"; characterId: string }
  | { kind: "takeCancelled"; characterId: string }
  | { kind: "takeCancelledFormat"; from: RigFormat; to: RigFormat }
  | { kind: "takeArmed"; still: { id: string; n: number } }
  | { kind: "needsStill"; characterId: string | null; format: RigFormat }
  | { kind: "hourPlotOff"; scheme: RigLightScheme; hour: number }
  | { kind: "hourWaits"; scheme: RigLightScheme; hour: number }
  | { kind: "moonKept"; hour: number }
  | { kind: "outfitOff"; characterId: string }
  | { kind: "builtFromWords" }
  /** Two places were asked at once (a mark and a thing): the mark was kept, the thing is named as not matched. */
  | { kind: "placeKept"; markId: string };

/** "Do it and shoot · n" or "Do it and take · n" beside a suggestion or a Just-talking preview. */
export type SecondButton = { kind: "shoot" | "take"; credits: number };

export type TurnPlan = {
  /**
   * guard: the reading failed or was limited — nothing (decision 2);
   * nothing: there were no words;
   * proposal: Just talking — what would run, run by Do it;
   * undo: the last turn steps back, the rest becomes a proposal;
   * run: the steps run now.
   */
  kind: "guard" | "nothing" | "proposal" | "undo" | "run";
  source: TurnSource;
  mode: TurnMode;
  why: ReaderWhy;
  reading: ShotReading | null;
  steps: Step[];
  needs: Need[];
  notes: Note[];
  /** Keys (and rig ids) that were already so: said under "Already so", never run. */
  already: string[];
  cant: { code: CantCode; said: string | null }[];
  ask: NonNullable<ShotReading["ask"]>;
  idea: string | null;
  suggestions: { act: ShotAct; second: SecondButton | null }[];
  /** For an undo turn: the rest of the reading, offered with [Do it] (null when there is none). */
  proposal: ShotReading | null;
  /** The words of what happens that did not fit (composeHappens). */
  directionCut: string | null;
  dropped: string[];
  messageCut: boolean;
  /** The take as it stands after the turn. */
  takeAfter: TakeStart | null;
};

/**
 * Why a message turn that would have shot did not (money rule 2 and critic
 * item 1). "home": the message was carried from the Sets home and the
 * person left "Ask before shooting" on there (Helios Cut 3, money fix).
 */
export type Blocker = "why" | "cant" | "dropped" | "which" | "astra" | "hour" | "take" | "takeFormat" | "cut" | "messageCut" | "who" | "retry" | "home";

export type ShootDecision = {
  kind: "none" | "still" | "take";
  held: Blocker[];
  /** What [Shoot as it is · n] does when a blocker held a shot that was asked for or would have fired: a still, or the person's own take. */
  offer: "still" | "take" | null;
};

// ---------------------------------------------------------------------------
// Small readers.
// ---------------------------------------------------------------------------

const CAMERA_KEYS = ["cameraId", "side", "size", "height", "tiltDeg", "lensMm", "frameX", "steps"] as const satisfies readonly (keyof ShotAct)[];
/** Whether the reading moves the camera itself: then a place moves only the figure, and a move rides the take as words. */
export const hasCameraKeys = (r: ShotAct): boolean => CAMERA_KEYS.some((k) => r[k] !== undefined);

const FRAME_GROUPS = new Set(["format", "squeeze"]);
const groupOf = (id: string) => id.slice(0, id.indexOf(":"));

/** How near a plot's aim must be to count as the same: a light plot is kept to a tenth of a degree, so 2° is "the same" and a camera moved round her is not. */
const LIGHT_SAME_DEG = 2;

/**
 * Whether a light plot is already the rig's: the same scheme AIMED the same
 * way. A plot is anchored in the world from where the camera stood when it
 * was set (light-schemes.ts schemeDefaults), so the same scheme asked for
 * from a camera that has moved since is a new aim, not "already so" (review
 * of Cut 2, U2: "contre-jour" restated from the other side left her
 * front-lit and said it was already so).
 */
function lightAlready(want: RigLightState | null | undefined, have: RigLightState | null): boolean {
  if (!want || !have) return (want ?? null) === (have ?? null);
  const turn = Math.abs(wrapDeg(want.azimuthDeg - have.azimuthDeg + 180) - 180);
  return want.scheme === have.scheme && turn <= LIGHT_SAME_DEG && Math.abs(want.elevationDeg - have.elevationDeg) <= LIGHT_SAME_DEG;
}

/** Whether a rig change is already the rig: a light plot by its scheme and its aim, everything else by value. */
function rigAlready(patch: Partial<SetRig>, rig: SetRig): boolean {
  return (Object.keys(patch) as (keyof SetRig)[]).every((k) => (k === "light" ? lightAlready(patch.light, rig.light) : patch[k] === rig[k]));
}

function stillOf(shots: readonly PlanShot[], id: string): { shot: PlanShot; n: number } | null {
  const stills = shots.filter((s) => s.kind === "still");
  const i = stills.findIndex((s) => s.generationId === id);
  return i < 0 ? null : { shot: stills[i], n: stills.length - i };
}

function pickOf(t: ThingPick): { key: string } | { candidates: string[] } {
  return "key" in t ? { key: t.key } : { candidates: [...t.candidates] };
}

// ---------------------------------------------------------------------------
// The take's start (spec §3.1 step 13, Cut 1's person check).
// ---------------------------------------------------------------------------

/**
 * The still a take the chat sets up starts on: the newest finished still
 * of the chip's person — or of no one on record, which Cut 1's person
 * check lets through — in the rig's own format. The format rule is Cut 1's
 * too: a take is sent at its end still's ratio (take.ts takeAspectRatio),
 * so a start of another shape makes the engine invent the difference.
 * Null with no one on the chip, or no such still (shots newest first).
 */
export function pickTakeStart(shots: readonly PlanShot[], characterId: string | null, format: RigFormat): { id: string; n: number } | null {
  if (!characterId) return null;
  const stills = shots.filter((s) => s.kind === "still");
  for (let i = 0; i < stills.length; i++) {
    const s = stills[i];
    if (s.status !== "succeeded" || s.format !== format) continue;
    if (s.characterId != null && s.characterId !== characterId) continue;
    return { id: s.generationId, n: stills.length - i };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The light and the hour (spec §3.1 step 11).
// ---------------------------------------------------------------------------

export type HourClash =
  /** He asked only for a time, under a plot that brings its own sun: the plot goes, so the hour shows. */
  | { kind: "plotOff"; scheme: RigLightScheme; hour: number }
  /** A sun plot was set (directly, or by a genre) while a time is set: both kept, the hour waits, [Use the hour instead]. */
  | { kind: "waits"; scheme: RigLightScheme; hour: number }
  /** Moonlight at a night hour: no clash — the moon carries the hour. */
  | { kind: "moonKept"; hour: number };

/**
 * The hour against the light plot, on the rig the turn RESULTS in: `before`
 * the turn, `after` it, and the `patch` it made. Nothing to say unless the
 * patch touched the time or the light. schemeHasSun decides "brings its own
 * sun" (moonlight's key is the moon, which counts); the rule reads no words.
 */
export function hourClash(before: SetRig, after: SetRig, patch: Partial<SetRig>): HourClash | null {
  const touchedTime = "time" in patch;
  const touchedLight = "light" in patch;
  if (!touchedTime && !touchedLight) return null;
  if (after.time === null || !after.light || !schemeHasSun(after.light.scheme)) return null;
  const hour = after.time;
  if (after.light.scheme === "moonlight" && (hour >= 19 || hour < 6)) return { kind: "moonKept", hour };
  if (touchedLight) return { kind: "waits", scheme: after.light.scheme, hour };
  const scheme = before.light?.scheme ?? after.light.scheme;
  return { kind: "plotOff", scheme, hour };
}

/**
 * The look step's change to the rig: the ⌘K ids in order (rigPatchFor, a
 * light plot aimed from `cameraBearingDeg` — the camera's FINAL bearing, so
 * the page calls this after the camera has moved), then the hour, then the
 * exposure in thirds; and the clash rule on the result — a plot that would
 * hide the hour he asked for comes off here (light: null, ⌘K's
 * light:as-built), and Undo brings it back.
 */
export function lookPatch(
  look: { ids: readonly string[]; hour?: number; evThirds?: number },
  rig: SetRig,
  cameraBearingDeg: number,
): { patch: Partial<SetRig>; clash: HourClash | null } {
  const patch: Partial<SetRig> = {};
  for (const id of look.ids) Object.assign(patch, rigPatchFor(id, { cameraBearingDeg }) ?? {});
  if (look.hour !== undefined) patch.time = look.hour;
  if (look.evThirds) patch.ev = stepEv(rig.ev, look.evThirds);
  const clash = hourClash(rig, { ...rig, ...patch }, patch);
  if (clash?.kind === "plotOff") patch.light = null;
  return { patch, clash };
}

// ---------------------------------------------------------------------------
// Where she stands (spec §3.1 step 6).
// ---------------------------------------------------------------------------

type Xz = { x: number; z: number };

/** The camera's right on the ground, seen from `from` looking at `to` (three.js: a camera on heading h has its right along (−cos h, sin h)). */
function cameraRight(from: Xz, to: Xz): [number, number] {
  let fx = to.x - from.x;
  let fz = to.z - from.z;
  const len = Math.hypot(fx, fz);
  if (len < EPS) return [1, 0];
  fx /= len;
  fz /= len;
  return [-fz, fx];
}

/** The vehicle a thing is, when the set's lamps say which end is its front (vehicles.ts findVehicles): the one standing inside its box. */
export function vehicleOf(element: Pick<SetElement, "kind" | "min" | "max">, vehicles: readonly Vehicle[]): Vehicle | null {
  if (element.kind === "object") return null;
  return vehicles.find((v) => v.x >= element.min[0] - EPS && v.x <= element.max[0] + EPS && v.z >= element.min[2] - EPS && v.z <= element.max[2] + EPS) ?? null;
}

/**
 * Where she stands by a thing: past its edge by her own radius and 0.15 m.
 * A car's or a vehicle's front and back are its own, read from its lamps;
 * everything else is the picture's — front is toward the camera, back away
 * from it, left and right as the camera sees them, and "beside" the one of
 * those two nearer where she stands now, so she moves the least. Held
 * inside the set; the page then steps her clear of anything built, toward
 * the camera (marks.ts clearMarks).
 */
export function pointBeside(
  element: Pick<SetElement, "min" | "max" | "centre">,
  side: NearSide,
  at: { camera: CameraPose; mark: Xz; bounds?: { x: number; z: number } },
  vehicle?: Pick<Vehicle, "x" | "z" | "frontDeg" | "halfLength"> | null,
): Xz {
  const centre = { x: element.centre[0], z: element.centre[2] };
  const cam = { x: at.camera.position[0], z: at.camera.position[2] };
  const hx = Math.max(0, (element.max[0] - element.min[0]) / 2);
  const hz = Math.max(0, (element.max[2] - element.min[2]) / 2);
  let toward: [number, number] = [cam.x - centre.x, cam.z - centre.z];
  const tl = Math.hypot(...toward);
  toward = tl < EPS ? [0, 1] : [toward[0] / tl, toward[1] / tl];
  const right = cameraRight(cam, centre);
  let origin = centre;
  let dir: [number, number];
  let reach: number | null = null;
  if ((side === "front" || side === "back") && vehicle) {
    const f = vehicle.frontDeg * DEG;
    dir = side === "front" ? [Math.sin(f), Math.cos(f)] : [-Math.sin(f), -Math.cos(f)];
    origin = { x: vehicle.x, z: vehicle.z };
    reach = vehicle.halfLength;
  } else if (side === "front") dir = toward;
  else if (side === "back") dir = [-toward[0], -toward[1]];
  else if (side === "right") dir = right;
  else if (side === "left") dir = [-right[0], -right[1]];
  else {
    const onRight = Math.hypot(at.mark.x - (centre.x + right[0]), at.mark.z - (centre.z + right[1]));
    const onLeft = Math.hypot(at.mark.x - (centre.x - right[0]), at.mark.z - (centre.z - right[1]));
    dir = onLeft < onRight ? [-right[0], -right[1]] : right;
  }
  if (reach === null) {
    const ax = Math.abs(dir[0]) > EPS ? hx / Math.abs(dir[0]) : Infinity;
    const az = Math.abs(dir[1]) > EPS ? hz / Math.abs(dir[1]) : Infinity;
    reach = Math.min(ax, az);
    if (!Number.isFinite(reach)) reach = 0;
  }
  const out = reach + PERSON_RADIUS_M + NEAR_CLEARANCE_M;
  let x = origin.x + dir[0] * out;
  let z = origin.z + dir[1] * out;
  if (at.bounds) {
    const hbx = Math.max(0, at.bounds.x / 2 - PERSON_RADIUS_M);
    const hbz = Math.max(0, at.bounds.z / 2 - PERSON_RADIUS_M);
    x = clamp(x, -hbx, hbx);
    z = clamp(z, -hbz, hbz);
  }
  return { x: r2(x), z: r2(z) };
}

/** A block on the ground: its box as placed (elements.ts PartShape footprints). */
type Footprint = { min: readonly number[]; max: readonly number[] };
/** How low a block's top may be and still be ground she stands ON, not beside (a painted line, a road, a floor), metres. */
const PART_FLAT_TOP_M = 0.3;

/** A point on a part's edge: where, the way out from it toward her, how far, and whether she stands within a block (and whether that block is flat ground). */
export type PartPoint = { x: number; z: number; out: [number, number]; distanceM: number; inside: boolean; flat: boolean };

/**
 * The nearest point of a part to her, on the ground (Helios Cut 4, step
 * B3): over each copy of each of its blocks, never the box round them all,
 * since a part can be two barriers 28 m apart with her between them. With
 * the way out from that point toward her: from inside a block, through its
 * nearest face. `inside` is true when she stands within a block's footprint.
 */
export function nearestOnPart(footprints: readonly Footprint[], at: Xz): PartPoint | null {
  let best: PartPoint | null = null;
  for (const f of footprints) {
    const flat = f.max[1] <= PART_FLAT_TOP_M;
    const x = clamp(at.x, f.min[0], f.max[0]);
    const z = clamp(at.z, f.min[2], f.max[2]);
    const d = Math.hypot(at.x - x, at.z - z);
    let hit: PartPoint;
    if (d > EPS) hit = { x, z, out: [(at.x - x) / d, (at.z - z) / d], distanceM: d, inside: false, flat };
    else {
      // Inside: out through the nearest face.
      const faces: { gap: number; x: number; z: number; out: [number, number] }[] = [
        { gap: at.x - f.min[0], x: f.min[0], z: at.z, out: [-1, 0] },
        { gap: f.max[0] - at.x, x: f.max[0], z: at.z, out: [1, 0] },
        { gap: at.z - f.min[2], x: at.x, z: f.min[2], out: [0, -1] },
        { gap: f.max[2] - at.z, x: at.x, z: f.max[2], out: [0, 1] },
      ];
      const face = faces.reduce((a, b) => (b.gap < a.gap ? b : a));
      hit = { x: face.x, z: face.z, out: face.out, distanceM: 0, inside: true, flat };
    }
    // Standing on a flat block wins (she is at it already); else the nearest.
    const rank = (h: PartPoint) => (h.inside && h.flat ? -1 : h.distanceM);
    if (!best || rank(hit) < rank(best)) best = hit;
  }
  return best;
}

/**
 * Where she stands by a part: at its nearest face, past it by her own
 * radius and 0.15 m, as pointBeside does for a thing. A part has no front
 * of its own, so the side said is not used: a 120 m grandstand's middle can
 * be 60 m away, its nearest face is where a director means. Standing on a
 * flat part (a road, a painted line) already, she stays where she is.
 * Held inside the set; the page then steps her clear of anything built
 * (marks.ts clearMarks).
 */
export function pointByPart(footprints: readonly Footprint[], mark: Xz, bounds?: { x: number; z: number }): Xz {
  const near = nearestOnPart(footprints, mark);
  if (!near || (near.inside && near.flat)) return { x: r2(mark.x), z: r2(mark.z) };
  const out = PERSON_RADIUS_M + NEAR_CLEARANCE_M;
  let x = near.x + near.out[0] * out;
  let z = near.z + near.out[1] * out;
  if (bounds) {
    const hbx = Math.max(0, bounds.x / 2 - PERSON_RADIUS_M);
    const hbz = Math.max(0, bounds.z / 2 - PERSON_RADIUS_M);
    x = clamp(x, -hbx, hbx);
    z = clamp(z, -hbz, hbz);
  }
  return { x: r2(x), z: r2(z) };
}

/** Where she faces to face a part: its nearest point (the middle of a long stand can be far off to one side); from on top of it, its middle. */
export function partFacingPoint(part: { footprints: readonly Footprint[]; min: readonly number[]; max: readonly number[] }, mark: Xz): Xz {
  const near = nearestOnPart(part.footprints, mark);
  if (!near || near.distanceM < 0.05) return { x: (part.min[0] + part.max[0]) / 2, z: (part.min[2] + part.max[2]) / 2 };
  return { x: near.x, z: near.z };
}

/** A move in the picture's terms: + right is picture right, + toward is toward the camera. Her facing is kept. */
export function nudgeMark<M extends Xz>(mark: M, camera: CameraPose, right: number, toward: number): M {
  const cam = { x: camera.position[0], z: camera.position[2] };
  const [rx, rz] = cameraRight(cam, mark);
  let fx = mark.x - cam.x;
  let fz = mark.z - cam.z;
  const len = Math.hypot(fx, fz);
  [fx, fz] = len < EPS ? [0, -1] : [fx / len, fz / len];
  return { ...mark, x: r2(mark.x + rx * right - fx * toward), z: r2(mark.z + rz * right - fz * toward) };
}

/** The camera moved by the same offset as the figure, so the framing holds ("the camera moved with her"). */
export function shiftPose(pose: CameraPose, from: Xz, to: Xz): CameraPose {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return {
    position: [r3(pose.position[0] + dx), pose.position[1], r3(pose.position[2] + dz)],
    target: [r3(pose.target[0] + dx), pose.target[1], r3(pose.target[2] + dz)],
    fovDeg: pose.fovDeg,
  };
}

// ---------------------------------------------------------------------------
// Facing and eye-line (spec §3.1 steps 9 and 10).
// ---------------------------------------------------------------------------

/** Her facing after a turn, from the way she faces now: her own left is + (people.ts sideOf), right −, around 180°. */
export function turnedFacing(facingDeg: number, turn: TurnWord): number {
  const by = turn === "left" ? TURN_STEP_DEG : turn === "right" ? -TURN_STEP_DEG : 180;
  return r1(wrapDeg(facingDeg + by));
}

/** The facing that looks from the mark at a point (a thing's centre): the marks' own rule, 0° faces +Z, 90° faces +X. */
export function facingToward(mark: Xz, point: Xz): number {
  return r1(wrapDeg(Math.atan2(point.x - mark.x, point.z - mark.z) / DEG));
}

/** The block an eye-line on a thing looks at: its largest (people.ts gazes at one object). */
export function largestObjectOf(element: Pick<SetElement, "members">, objects: readonly Pick<SetObject, "size">[]): number | null {
  let best: number | null = null;
  let volume = -1;
  for (const [o] of element.members) {
    const size = objects[o]?.size;
    if (!size) continue;
    const v = size[0] * size[1] * size[2];
    if (v > volume) {
      volume = v;
      best = o;
    }
  }
  return best;
}

/** The eye-line a gaze key asks for (people.ts Gaze): a look out of frame is a point GAZE_POINT_M out on that side of her own front. */
export function gazeFor(gaze: "camera" | "none" | { objectIndex: number } | { side: GazeSide }, mark: Xz & { facingDeg: number }): Gaze | null {
  if (gaze === "camera") return { at: "camera" };
  if (gaze === "none") return null;
  if ("objectIndex" in gaze) return { at: "object", index: gaze.objectIndex };
  const by = gaze.side === "ahead" ? 0 : gaze.side === "left" ? 90 : gaze.side === "right" ? -90 : 180;
  const a = (mark.facingDeg + by) * DEG;
  return { at: "point", x: r3(mark.x + Math.sin(a) * GAZE_POINT_M), z: r3(mark.z + Math.cos(a) * GAZE_POINT_M) };
}

// ---------------------------------------------------------------------------
// The camera's word steps (spec §3.5, check of the spec item 6).
// ---------------------------------------------------------------------------

/** The camera round the figure, as the word steps change it. */
export type CameraSpot = { bearingDeg: number; distanceM: number; heightM: number; pitchDeg: number; fovDeg: number };
/** A step that reached the end of what words do: said on its chip ("as low as words go"). */
export type StepClamp = "low" | "high" | "near" | "tilt" | "widest" | "longest";

/** The spot a pose stands on, round the mark; a camera on the mark stands in front of the figure (shot-words.ts wordsToMatch). */
export function cameraSpotOf(pose: CameraPose, mark: Xz & { facingDeg: number }): CameraSpot {
  const dx = pose.position[0] - mark.x;
  const dz = pose.position[2] - mark.z;
  const distance = Math.hypot(dx, dz);
  const d = [pose.target[0] - pose.position[0], pose.target[1] - pose.position[1], pose.target[2] - pose.position[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  return {
    bearingDeg: distance >= 0.2 ? wrapDeg(Math.atan2(dx, dz) / DEG) : wrapDeg(mark.facingDeg),
    distanceM: distance >= 0.2 ? distance : WORD_STEP.minDistanceM,
    heightM: pose.position[1],
    pitchDeg: len < EPS ? 0 : Math.asin(clamp(d[1] / len, -1, 1)) / DEG,
    fovDeg: pose.fovDeg,
  };
}

/**
 * One word step from where the camera is. Heights: "higher" never lowers
 * the camera and raises it to 2.6 m at most — a raise that would pass it
 * stops there and is "not yet" (altitude), and a camera already above it
 * (an establishing camera, a hand orbit) stays put; "lower" never raises it
 * and stops at 0.3 m, so "lower" from an 8 m camera is 7.6 m, not 2.6
 * (check of the spec, item 6). "left" and "right" orbit the camera to its
 * own left or right round her; "other_side" mirrors it across the way she
 * faces (on that line, front and back swap); the lens steps one along the
 * listed lenses on the rig's own body.
 *
 * Closer, further, higher and lower keep what the camera AIMS at on her,
 * not its tilt: the height where the aim crosses her line, held between
 * her feet and her eyes (`eyeM`, the stand-in's for her pose), and the tilt
 * worked out again from the new spot — "lower" from eye level looks up at
 * her instead of sliding her face out of the top of the frame. When even
 * that would put her eyes past EYE_ROOM of the band's half-height (a step
 * closer from a low medium shot aimed at her waist), the tilt follows her
 * eyes just enough to keep them in (review of Cut 2, U3). `bandShare` is
 * the band's share of the render's height (rig.ts formatFrame heightShare).
 * tilt_up and tilt_down change the tilt itself.
 */
export function cameraStep(
  step: ReaderStep,
  spot: CameraSpot,
  mark: { facingDeg: number },
  sensorHeightMm?: number,
  eyeM: number = STAND_IN_EYE_M.stand,
  bandShare = 1,
): { spot: CameraSpot; clamp: StepClamp | null; cant: "altitude" | null } {
  const out = { ...spot };
  let hit: StepClamp | null = null;
  let cant: "altitude" | null = null;
  switch (step) {
    case "closer": {
      const wanted = spot.distanceM * WORD_STEP.distanceScale;
      out.distanceM = Math.min(spot.distanceM, Math.max(WORD_STEP.minDistanceM, wanted));
      if (wanted <= WORD_STEP.minDistanceM + EPS) hit = "near";
      break;
    }
    case "further":
      out.distanceM = spot.distanceM / WORD_STEP.distanceScale;
      break;
    case "higher": {
      const top = WORD_STEP.maxHeightM;
      const wanted = spot.heightM + WORD_STEP.heightM;
      if (spot.heightM >= top - EPS) {
        cant = "altitude";
        hit = "high";
      } else {
        out.heightM = Math.min(wanted, top);
        if (wanted >= top - EPS) hit = "high";
        if (wanted > top + EPS) cant = "altitude";
      }
      break;
    }
    case "lower": {
      const wanted = spot.heightM - WORD_STEP.heightM;
      out.heightM = Math.min(spot.heightM, Math.max(WORD_STEP.minHeightM, wanted));
      if (wanted <= WORD_STEP.minHeightM + EPS) hit = "low";
      break;
    }
    case "left":
      out.bearingDeg = wrapDeg(spot.bearingDeg - WORD_STEP.orbitDeg);
      break;
    case "right":
      out.bearingDeg = wrapDeg(spot.bearingDeg + WORD_STEP.orbitDeg);
      break;
    case "other_side": {
      let rel = wrapDeg(spot.bearingDeg - mark.facingDeg);
      if (rel > 180) rel -= 360;
      out.bearingDeg = Math.abs(rel) < 2 || Math.abs(rel) > 178 ? wrapDeg(spot.bearingDeg + 180) : wrapDeg(mark.facingDeg - rel);
      break;
    }
    case "tilt_up":
    case "tilt_down": {
      const wanted = spot.pitchDeg + (step === "tilt_up" ? WORD_STEP.tiltDeg : -WORD_STEP.tiltDeg);
      out.pitchDeg = clamp(wanted, -SET_MAX_TILT_DOWN_DEG, SET_MAX_TILT_UP_DEG);
      if (wanted >= SET_MAX_TILT_UP_DEG - EPS || wanted <= -SET_MAX_TILT_DOWN_DEG + EPS) hit = "tilt";
      break;
    }
    case "wider":
    case "longer": {
      const now = nearestLens(spot.fovDeg, sensorHeightMm);
      const i = LENSES_MM.indexOf(now) + (step === "wider" ? -1 : 1);
      if (i < 0 || i >= LENSES_MM.length) hit = step === "wider" ? "widest" : "longest";
      else out.fovDeg = fovForLens(LENSES_MM[i], sensorHeightMm);
      break;
    }
  }
  if (step === "closer" || step === "further" || step === "higher" || step === "lower") {
    const aimY = clamp(spot.heightM + spot.distanceM * Math.tan(spot.pitchDeg * DEG), 0, eyeM);
    let pitch = Math.atan2(aimY - out.heightM, out.distanceM) / DEG;
    // Her eyes, off the axis: kept inside the band's EYE_ROOM.
    const room = EYE_ROOM * (Math.atan(clamp(bandShare, 0.05, 1) * Math.tan((out.fovDeg * DEG) / 2)) / DEG);
    const eyeAt = Math.atan2(eyeM - out.heightM, out.distanceM) / DEG;
    if (eyeAt - pitch > room) pitch = eyeAt - room;
    else if (pitch - eyeAt > room) pitch = eyeAt + room;
    out.pitchDeg = clamp(pitch, -SET_MAX_TILT_DOWN_DEG, SET_MAX_TILT_UP_DEG);
  }
  return { spot: out, clamp: hit, cant };
}

/** Up to four steps, in order, each from the last. */
export function cameraSteps(
  steps: readonly ReaderStep[],
  spot: CameraSpot,
  mark: { facingDeg: number },
  sensorHeightMm?: number,
  eyeM?: number,
  bandShare?: number,
): { spot: CameraSpot; clamps: StepClamp[]; cant: "altitude" | null } {
  let now = spot;
  const clamps: StepClamp[] = [];
  let cant: "altitude" | null = null;
  for (const s of steps) {
    const r = cameraStep(s, now, mark, sensorHeightMm, eyeM, bandShare);
    now = r.spot;
    if (r.clamp && !clamps.includes(r.clamp)) clamps.push(r.clamp);
    cant = cant ?? r.cant;
  }
  return { spot: now, clamps, cant };
}

/** A spot as a matched shot and the camera to solve it from (shot-words.ts wordsToMatch's shape): solveMatchPose keeps its bearing. */
export function spotToMatch(spot: CameraSpot, mark: Xz): { match: ShotMatch; from: CameraPose } {
  const b = spot.bearingDeg * DEG;
  return {
    from: {
      position: [r3(mark.x + Math.sin(b) * spot.distanceM), r3(spot.heightM), r3(mark.z + Math.cos(b) * spot.distanceM)],
      target: [mark.x, 1, mark.z],
      fovDeg: spot.fovDeg,
    },
    match: {
      subjectFound: true,
      cameraHeightM: spot.heightM,
      pitchDeg: spot.pitchDeg,
      verticalFovDeg: spot.fovDeg,
      subjectDistanceM: spot.distanceM,
      subjectX: 0.5,
      framing: null,
      confidence: "high",
    },
  };
}

// ---------------------------------------------------------------------------
// The thirds (the owner's decision 5, spec §3.1).
// ---------------------------------------------------------------------------

/**
 * The band's own field of view for a render's `fovDeg`: 2·atan(share ·
 * tan(fov/2)). solveMatchPose widens what it is handed by the band's share
 * (compare.ts widenFovDeg), so handing it this gives back the render's lens
 * exactly — "50 mm" stays 50 mm with her on a third. The share is held to
 * 1, as the solver holds it.
 */
export function bandFovDeg(fovDeg: number, heightShare: number): number {
  const share = heightShare > 0 ? Math.min(1, heightShare) : 1;
  return (2 * Math.atan(share * Math.tan((fovDeg * DEG) / 2))) / DEG;
}

/**
 * A word solve with her on a third: the match with `subjectX` at 1/3 or
 * 2/3 and the band's field of view, and the band (rig.ts formatFrame) for
 * solveMatchPose's `frame`, whose off-centre turn uses the band's width.
 * The words path passes `referenceAspect: 1` as it always has. "centre"
 * hands the match back untouched and no frame, so today's call is
 * byte-identical.
 */
export function framedMatch(
  match: ShotMatch,
  frameX: FrameX,
  band: { bandAspect: number; heightShare: number },
): { match: ShotMatch; frame?: { bandAspect: number; heightShare: number } } {
  if (frameX === "centre") return { match };
  return {
    match: { ...match, subjectX: FRAME_X_AT[frameX], verticalFovDeg: bandFovDeg(match.verticalFovDeg, band.heightShare) },
    frame: { bandAspect: band.bandAspect, heightShare: band.heightShare },
  };
}

/**
 * Where she stands across the frame after something moves the camera: a
 * word solve keeps the third (steps, a nudge the camera follows) unless it
 * sets one; a camera picked by name starts centred unless the same words
 * put her on a third; a Match, "centre", and every hand move of the camera
 * (an orbit, a drag, Frame the figure, ⌘Z) centre her — after a hand orbit
 * NOW must not still say "on the left third", nor the next "closer" put her
 * back on it (check of the spec, item 6).
 */
export type FrameXEvent = { kind: "words"; frameX?: FrameX } | { kind: "camera"; frameX?: FrameX } | { kind: "hand" } | { kind: "match" };
export function frameXAfter(prev: FrameX, event: FrameXEvent): FrameX {
  if (event.kind === "words") return event.frameX ?? prev;
  if (event.kind === "camera") return event.frameX ?? "centre";
  return "centre";
}

// ---------------------------------------------------------------------------
// The plan (spec §3.1).
// ---------------------------------------------------------------------------

/** A Need a turn leaves waiting that holds an automatic shot. */
const NEED_BLOCKER: Record<Need["kind"], Blocker> = { astra: "astra", which: "which", hour: "hour", take: "take", takeFormat: "takeFormat" };
/** The steps that change the picture: in "Shoot without asking", a turn with one of these shoots (when nothing holds it). */
const FRAME_STEPS: ReadonlySet<StepKind> = new Set<StepKind>(["who", "frame", "place", "pose", "camera", "facing", "gaze", "look", "words"]);

/** Whether the plan changes the picture. */
export const changesFrame = (plan: Pick<TurnPlan, "steps">): boolean => plan.steps.some((s) => FRAME_STEPS.has(s.kind));

function emptyPlan(reading: ShotReading | null, state: PageState): TurnPlan {
  return {
    kind: "run",
    source: state.source,
    mode: state.mode,
    why: state.why ?? "ok",
    reading,
    steps: [],
    needs: [],
    notes: [],
    already: [],
    cant: [],
    ask: [],
    idea: null,
    suggestions: [],
    proposal: null,
    directionCut: null,
    dropped: [...(state.dropped ?? [])],
    messageCut: state.messageCut === true,
    takeAfter: state.takeStart,
  };
}

/** The reading without its undo and its shot: what an undo turn offers with [Do it]. Null when nothing is left. */
function restOf(reading: ShotReading): ShotReading | null {
  const rest: ShotReading = { ...reading };
  delete rest.undo;
  delete rest.shoot;
  delete rest.ask;
  delete rest.idea;
  delete rest.cant;
  return Object.keys(rest).length > 0 ? rest : null;
}

/**
 * The plan for one reading, in the §3.1 order: guard, mode, undo, then who,
 * the frame, place, pose, camera, facing, eye-line, look, words, motion,
 * the set change, answers and "not yet". The page snapshots before it runs
 * any step (step 3) and decides the shot after (shootDecision).
 */
export function planTurn(reading: ShotReading | null, state: PageState): TurnPlan {
  const plan = emptyPlan(reading, state);
  // 0. Guard: a reading that failed, was limited or never happened plans nothing (decision 2).
  if (plan.why !== "ok" || !reading) return { ...plan, kind: plan.why === "empty" ? "nothing" : "guard" };

  plan.ask = [...(reading.ask ?? [])];
  plan.idea = reading.idea ?? null;
  plan.cant = (reading.cant ?? []).map((c) => ({ ...c }));

  // 1. Mode: Just talking shows what it would do; a button (Do it) runs it.
  const proposal = state.mode === "talk" && state.source !== "button";

  // 2. Undo: the last turn steps back (the page's undoPlan), the rest is offered.
  if (reading.undo && !proposal) return { ...plan, kind: "undo", proposal: restOf(reading) };

  const r = reading;
  const steps: Step[] = [];
  const needs: Need[] = [];
  const notes: Note[] = [];
  const already: string[] = [];
  const blocked = (key: string) => {
    if (!plan.dropped.includes(key)) plan.dropped.push(key);
  };
  let who = state.characterId;
  let take = state.takeStart;
  let cancelled: TakeStart | null = null;
  let rig = state.rig;
  const cameraKeys = hasCameraKeys(r);

  // 4. Who: castable only with a photo; the take follows its person (Cut 1).
  if (r.characterId !== undefined) {
    const ch = state.characters.find((c) => c.id === r.characterId);
    if (!ch) notes.push({ kind: "whoUnknown", characterId: r.characterId });
    else if (!ch.hasPhoto) notes.push({ kind: "notCastable", characterId: ch.id });
    else if (ch.id === who) already.push("who");
    else {
      steps.push({ kind: "who", characterId: ch.id, was: who });
      who = ch.id;
      const start = take ? stillOf(state.shots, take.id) : null;
      if (take && start?.shot.characterId && start.shot.characterId !== who) {
        steps.push({ kind: "takeCancel", why: "who", still: { id: take.id, n: take.n } });
        notes.push({ kind: "takeCancelled", characterId: start.shot.characterId });
        cancelled = take;
        take = null;
      }
    }
  }

  // 5. The frame's shape, first: the band feeds the size solve and the thirds.
  const frameIds = (r.rig ?? []).filter((id) => FRAME_GROUPS.has(groupOf(id)));
  const lookIds = (r.rig ?? []).filter((id) => !FRAME_GROUPS.has(groupOf(id)));
  if (frameIds.length > 0) {
    const changed = frameIds.filter((id) => !rigAlready(rigPatchFor(id, { cameraBearingDeg: state.cameraBearingDeg }) ?? {}, rig));
    for (const id of frameIds) if (!changed.includes(id)) already.push(id);
    if (changed.length > 0) {
      const patch: Partial<SetRig> = {};
      for (const id of changed) Object.assign(patch, rigPatchFor(id, { cameraBearingDeg: state.cameraBearingDeg }) ?? {});
      const format = patch.format ?? rig.format;
      steps.push({ kind: "frame", ids: changed, format });
      // A take keeps one shape: its clip is sent at its end still's ratio
      // (take.ts takeAspectRatio), so a start still of the old shape no
      // longer fits. The chat's own take is cancelled, as the who rule
      // does; the person's is kept and asked about (check of the spec, item 7).
      const start = take ? stillOf(state.shots, take.id) : null;
      if (take && start && format !== rig.format && start.shot.format !== format) {
        if (take.armedBy === "chat") {
          steps.push({ kind: "takeCancel", why: "format", still: { id: take.id, n: take.n } });
          notes.push({ kind: "takeCancelledFormat", from: start.shot.format, to: format });
          cancelled = take;
          take = null;
        } else {
          needs.push({ kind: "takeFormat", still: { id: take.id, n: take.n }, stillFormat: start.shot.format, format });
        }
      }
      rig = { ...rig, ...patch };
    }
  }

  // 6. Place: a mark, else a thing; a nudge after either. With no camera
  // keys the camera moves with her, so she stays framed.
  if (r.markId !== undefined || r.near !== undefined || r.nudge !== undefined) {
    const place: Extract<Step, { kind: "place" }> = { kind: "place", cameraFollows: !cameraKeys };
    if (r.markId !== undefined) {
      if (r.markId === state.markId && !r.nudge) already.push("mark");
      else place.markId = r.markId;
      if (r.near) {
        // Two places at once: the named mark wins, and the thing is said
        // not to match rather than dropped in silence.
        notes.push({ kind: "placeKept", markId: r.markId });
        blocked("near");
      }
    } else if (r.near) {
      const pick = pickOf(r.near.thing);
      if ("key" in pick) place.near = { key: pick.key, side: r.near.side };
      else needs.push({ kind: "which", slot: "near", candidates: pick.candidates, side: r.near.side });
    }
    if (r.nudge) place.nudge = { ...r.nudge };
    if (place.markId !== undefined || place.near || place.nudge) steps.push(place);
  }

  // 7. Pose.
  if (r.pose !== undefined) {
    if (r.pose === state.pose) already.push("pose");
    else steps.push({ kind: "pose", pose: r.pose });
  }

  // 8. Camera: a named camera, then the words solved from it, then the steps, then the lens.
  if (cameraKeys) {
    const onlyCamera = r.cameraId !== undefined && CAMERA_KEYS.every((k) => k === "cameraId" || r[k] === undefined);
    const onlyThird = r.frameX !== undefined && CAMERA_KEYS.every((k) => k === "frameX" || r[k] === undefined);
    if (onlyCamera && r.cameraId === state.cameraId) already.push("cameraId");
    else if (onlyThird && r.frameX === state.frameX) already.push("frameX");
    else {
      const cam: Extract<Step, { kind: "camera" }> = { kind: "camera" };
      if (r.cameraId !== undefined) cam.cameraId = r.cameraId;
      if (r.side !== undefined) cam.side = r.side;
      if (r.size !== undefined) cam.size = r.size;
      if (r.height !== undefined) cam.height = r.height;
      if (r.tiltDeg !== undefined) cam.tiltDeg = r.tiltDeg;
      if (r.lensMm !== undefined) cam.lensMm = r.lensMm;
      if (r.frameX !== undefined) cam.frameX = r.frameX;
      if (r.steps !== undefined) cam.steps = [...r.steps];
      steps.push(cam);
    }
  }

  // 9. Facing, against the final camera.
  if (r.facing !== undefined || r.turn !== undefined) {
    const facing: Extract<Step, { kind: "facing" }> = { kind: "facing" };
    if (typeof r.facing === "string") facing.facing = r.facing;
    else if (r.facing) {
      const pick = pickOf(r.facing);
      if ("key" in pick) facing.facing = { key: pick.key };
      else needs.push({ kind: "which", slot: "facing", candidates: pick.candidates });
    }
    if (r.turn !== undefined) facing.turn = r.turn;
    if (facing.facing !== undefined || facing.turn !== undefined) steps.push(facing);
  }

  // 10. Eye-line.
  if (r.gaze !== undefined) {
    const g = r.gaze;
    if (g === "camera" || g === "none") steps.push({ kind: "gaze", gaze: g });
    else if ("side" in g) steps.push({ kind: "gaze", gaze: { side: g.side } });
    else {
      const pick = pickOf(g);
      if ("key" in pick) steps.push({ kind: "gaze", gaze: { key: pick.key } });
      else needs.push({ kind: "which", slot: "gaze", candidates: pick.candidates });
    }
  }

  // 11. The look and the light, after the camera: the page aims a plot from
  // its final bearing (lookPatch); the clash is the same from any bearing.
  // When this turn moves the camera (its own words, or a place it follows),
  // where it ends is not known here, so a plot is never "already so": the
  // page aims it again from the camera's final bearing (review of Cut 2, U2).
  const laysEnd = r.move !== undefined && !cameraKeys && !state.filmOpen && take === null && pickTakeStart(state.shots, who, rig.format) !== null;
  const cameraMoves = steps.some((st) => st.kind === "camera" || (st.kind === "place" && st.cameraFollows)) || laysEnd;
  if (lookIds.length > 0 || r.hour !== undefined || r.evThirds !== undefined || r.look !== undefined) {
    const changed = lookIds.filter((id) => {
      const patch = rigPatchFor(id, { cameraBearingDeg: state.cameraBearingDeg }) ?? {};
      return (cameraMoves && "light" in patch && patch.light !== null) || !rigAlready(patch, rig);
    });
    for (const id of lookIds) if (!changed.includes(id)) already.push(id);
    const hour = r.hour !== undefined && r.hour !== rig.time ? r.hour : undefined;
    if (r.hour !== undefined && hour === undefined) already.push("hour");
    const evThirds = r.evThirds !== undefined && stepEv(rig.ev, r.evThirds) !== rig.ev ? r.evThirds : undefined;
    if (r.evThirds !== undefined && evThirds === undefined) already.push("ev");
    if (changed.length > 0 || hour !== undefined || evThirds !== undefined || r.look !== undefined) {
      const look: Extract<Step, { kind: "look" }> = { kind: "look", ids: changed };
      if (hour !== undefined) look.hour = hour;
      if (evThirds !== undefined) look.evThirds = evThirds;
      if (r.look !== undefined) look.look = r.look;
      steps.push(look);
      const { patch, clash } = lookPatch(look, rig, state.cameraBearingDeg);
      if (clash?.kind === "plotOff") notes.push({ kind: "hourPlotOff", scheme: clash.scheme, hour: clash.hour });
      else if (clash?.kind === "waits") {
        notes.push({ kind: "hourWaits", scheme: clash.scheme, hour: clash.hour });
        needs.push({ kind: "hour" });
      } else if (clash?.kind === "moonKept") notes.push({ kind: "moonKept", hour: clash.hour });
      rig = { ...rig, ...patch };
    }
  }

  // 12. What happens: only the person's own words (composeHappens), and
  // their clothes over a saved outfit photo only when there is one.
  if (r.happens !== undefined || r.wardrobe) {
    const words: Extract<Step, { kind: "words" }> = { kind: "words", outfitOff: false };
    if (r.happens !== undefined) {
      const composed = composeHappens(r.happens, state.direction);
      if (composed.text === state.direction && !composed.cut) already.push("happens");
      else words.happens = composed;
      plan.directionCut = composed.cut;
    }
    const cast = state.characters.find((c) => c.id === who);
    if (r.wardrobe && cast?.hasOutfit) {
      words.outfitOff = true;
      notes.push({ kind: "outfitOff", characterId: cast.id });
    }
    if (words.happens || words.outfitOff) steps.push(words);
  }

  // 13. A moving shot: the take the person or the chat set up keeps it;
  // else the chat sets one up, for free, from a still of the chip's person
  // in this frame's shape — which renders only from its priced press. A take
  // the chat sets up starts on the default engine unless the words name one,
  // as "Take it somewhere" does, so its price is never a leftover from an
  // earlier, pricier take (review of Cut 2, S3).
  let engine = state.takeEngine;
  const wantsMove = r.move !== undefined || r.textures !== undefined;
  const motion: Extract<Step, { kind: "motion" }> = { kind: "motion", layEnd: false };
  if (r.engine !== undefined) {
    motion.engine = r.engine;
    engine = r.engine;
  }
  let armed = false;
  /** `again`: the chat's own take, set up again after a new person or shape cancelled it — the same take, so it keeps its engine. */
  const arm = (move: FilmMove | undefined, textures: FilmTexture[] | undefined, layEnd: boolean, again = false) => {
    const start = pickTakeStart(state.shots, who, rig.format);
    if (!start) {
      notes.push({ kind: "needsStill", characterId: who, format: rig.format });
      return;
    }
    steps.push({ kind: "takeArm", still: start });
    notes.push({ kind: "takeArmed", still: start });
    take = { id: start.id, n: start.n, armedBy: "chat" };
    armed = true;
    const armEngine = r.engine ?? (again ? state.takeEngine : SET_TAKE_DEFAULT_ENGINE);
    if (armEngine !== state.takeEngine) motion.engine = armEngine;
    engine = armEngine;
    if (move !== undefined) motion.move = move;
    if (textures !== undefined) motion.textures = [...textures];
    motion.layEnd = layEnd;
  };
  if (wantsMove) {
    if (state.filmOpen) {
      // Film is open: a moving shot there is a beat, directed by hand for now (Cut 6).
      if (!plan.cant.some((c) => c.code === "film_beats")) plan.cant.push({ code: "film_beats", said: null });
    } else if (take) {
      if (r.move !== undefined) motion.move = r.move;
      if (r.textures !== undefined) motion.textures = [...r.textures];
    } else {
      arm(r.move, r.textures, r.move !== undefined && !cameraKeys);
    }
  } else if (cancelled?.armedBy === "chat" && state.takeMove && !state.filmOpen) {
    // The chat's own take, cancelled by a new person or a new shape, is set
    // up again from a still that fits — or says what it needs.
    arm(state.takeMove.move ?? undefined, state.takeMove.textures, false, true);
  }
  if (motion.move !== undefined || motion.textures !== undefined || motion.engine !== undefined) steps.push(motion);

  // 14. A change to the set itself: always a card with its press (decision 1).
  if (r.setChange) {
    if (state.origin === "build") notes.push({ kind: "builtFromWords" });
    else {
      const card = astraCardKind({ editsLeft: state.editsLeft, editsCap: state.editsCap, tooBig: state.tooBig, paused: state.paused === true });
      needs.push({ kind: "astra", said: r.setChange.said, gloss: r.setChange.gloss, seal: r.setChange.seal ?? null, cut: r.setChange.cut, card, canGo: astraCardCanGo(card) });
    }
  }
  // The set this message built already has its place: "a different place" is not asked of it.
  if (state.origin === "build") plan.cant = plan.cant.filter((c) => c.code !== "rebuild");

  plan.steps = steps;
  plan.needs = needs;
  plan.notes = notes;
  plan.already = already;
  plan.takeAfter = take;

  // The chat's own take waits for its priced press: said when it is set up,
  // and again whenever a message would otherwise have shot (critic item 1).
  if (take?.armedBy === "chat") {
    const wouldHaveShot = r.shoot === true || (state.mode === "auto" && changesFrame(plan));
    if (armed || wouldHaveShot) needs.push({ kind: "take", still: { id: take.id, n: take.n }, engine, credits: state.credits.take[engine] });
  }

  // 15. Answers and options, from the state the turn leaves.
  const after: PageState = { ...state, source: "button", characterId: who, takeStart: take, rig, takeEngine: engine, why: "ok", dropped: [], messageCut: false };
  plan.suggestions = (r.suggest ?? []).map((act) => ({ act, second: secondButton(planTurn(act, after), after) }));

  if (proposal) {
    // Just talking: nothing runs, nothing waits — Do it runs it all as a
    // button turn. What it would ask or couldn't do is still said: a "which
    // one?" (its taps are button turns, never a shot), a person who can't be
    // cast; and a take on a still of another shape stays on the plan, unsaid
    // (the frame has not changed yet), so no priced button stands beside a
    // row that can't be shot as it is (review of Cut 2, S1 and U4).
    return {
      ...plan,
      kind: "proposal",
      needs: needs.filter((n) => n.kind === "which" || n.kind === "takeFormat"),
      notes: notes.filter((n) => n.kind === "notCastable" || n.kind === "whoUnknown"),
      takeAfter: state.takeStart,
    };
  }
  return plan;
}

/** Whether a plan has anything to say: a step, a card, a note, a question, an idea, an option, a "not yet", or what was already so. */
export function planSays(plan: TurnPlan): boolean {
  return (
    plan.kind === "guard" ||
    plan.kind === "undo" ||
    plan.steps.length > 0 ||
    plan.needs.length > 0 ||
    plan.notes.length > 0 ||
    plan.already.length > 0 ||
    plan.cant.length > 0 ||
    plan.ask.length > 0 ||
    plan.idea !== null ||
    plan.suggestions.length > 0 ||
    plan.dropped.length > 0 ||
    plan.directionCut !== null
  );
}

// ---------------------------------------------------------------------------
// Buttons that run a stored reading, with no new reading and no shot.
// ---------------------------------------------------------------------------

/** The tap on a "which one?" button: the waiting part of the reading, with the thing chosen. */
export function resolveWhich(reading: ShotReading, need: Extract<Need, { kind: "which" }>, key: string): ShotReading {
  if (!need.candidates.includes(key)) return {};
  if (need.slot === "near") return { near: { thing: { key }, side: need.side ?? reading.near?.side ?? "beside" } };
  if (need.slot === "facing") return { facing: { key } };
  return { gaze: { key } };
}

/** [Use the hour instead]: the rig's own light, so the hour shows (⌘K's light:as-built). */
export const USE_HOUR_READING: ShotReading = { rig: ["light:as-built"] };

// ---------------------------------------------------------------------------
// When a picture is taken (spec §3.3).
// ---------------------------------------------------------------------------

/** What holds a message turn's shot. */
export function blockersOf(plan: TurnPlan): Blocker[] {
  const held: Blocker[] = [];
  const add = (b: Blocker) => {
    if (!held.includes(b)) held.push(b);
  };
  if (plan.why !== "ok") add("why");
  if (plan.cant.length > 0) add("cant");
  if (plan.dropped.length > 0) add("dropped");
  for (const n of plan.needs) add(NEED_BLOCKER[n.kind]);
  if (plan.takeAfter?.armedBy === "chat") add("take");
  if (plan.directionCut !== null) add("cut");
  if (plan.messageCut) add("messageCut");
  // A person asked for who can't be cast: shooting the one on the chip instead is not what was asked.
  if (plan.notes.some((n) => n.kind === "notCastable" || n.kind === "whoUnknown")) add("who");
  return held;
}

/**
 * Whether this turn takes a picture, and which (the §3.3 matrix): only a
 * message turn, never in Just talking; when it asked to shoot, or in
 * "Shoot without asking" when the frame changed; never a question or an
 * undo; and never past a blocker — then `offer` says what [Shoot as it is
 * · n] would do. A take only when the PERSON set it up: the chat's own take
 * is a blocker, on this turn and every later one (money rule 3). `after`
 * is what the executors found: whether anything really changed, and a
 * "not yet" a step met on the stage (a raise past what words do); `home`
 * says the message was carried from the Sets home, which in "Ask before
 * shooting" never shoots on arrival (Helios Cut 3, money fix).
 */
export function shootDecision(
  plan: TurnPlan,
  state: Pick<PageState, "mode" | "source">,
  after?: { changed?: boolean; cant?: boolean; home?: boolean },
): ShootDecision {
  const none = (held: Blocker[] = [], offer: ShootDecision["offer"] = null): ShootDecision => ({ kind: "none", held, offer });
  if (plan.kind === "guard") return none(["why"]);
  if (plan.kind !== "run" || !plan.reading) return none();
  if (state.source === "button" || state.mode === "talk") return none();
  const r = plan.reading;
  if (isQuestionOnly(r) || isUndoOnly(r)) return none();
  const changed = after?.changed ?? changesFrame(plan);
  const wouldShoot = r.shoot === true || (state.mode === "auto" && changed);
  if (!wouldShoot) return none();
  const held = blockersOf(plan);
  if (after?.cant && !held.includes("cant")) held.push("cant");
  if (state.source === "retry") held.push("retry");
  // A message sent from the Sets home arrives with the set's page and runs
  // there on its own: nobody pressed anything priced on this page, so in
  // "Ask before shooting" it frames and offers [Shoot as it is · n] rather
  // than spend (Helios Cut 3, money fix: the home now opens on the latest
  // set, so this is every returning person's path). "Shoot without asking",
  // chosen on the home, is the person's word to shoot.
  if (after?.home && state.mode === "ask") held.push("home");
  const kind = plan.takeAfter?.armedBy === "person" ? "take" : "still";
  if (held.length > 0) return none(held, kind);
  return { kind, held: [], offer: null };
}

/**
 * A priced "Do it and shoot · n" or "Do it and take · n" press, once its row
 * has run as a button turn (review of Cut 2, S1): the shot the press paid
 * for, unless something the row ran into holds it — a "which one?", a "not
 * yet", a part that didn't match, a person who can't be cast, a take on a
 * still of another shape. Then nothing is shot and `offer` puts [Shoot as
 * it is · n] (or [Take · n]) beside what holds it. A take the chat set up
 * holds neither: a still leaves it waiting, and "Do it and take" is the
 * priced Take press that may render it.
 */
export function paidDecision(plan: TurnPlan, kind: "still" | "take"): ShootDecision {
  const held = blockersOf(plan).filter((b) => b !== "take");
  return held.length > 0 ? { kind: "none", held, offer: kind } : { kind, held: [], offer: null };
}

/**
 * The priced second button beside a suggestion or a Just-talking preview
 * (spec §3.6), worked out from that row's own plan: a take when it sets one
 * up, when the person's take waits, or when its move rides a take already
 * waiting — "Do it and take · n" is a priced Take press, the one kind that
 * may render the chat's take (money rule 3); none when a move has no still
 * to start from, or it would change the set (its card has its own priced
 * button); else a still.
 */
export function secondButton(plan: TurnPlan, state: Pick<PageState, "credits" | "takeEngine">): SecondButton | null {
  if (plan.reading?.setChange || plan.needs.some((n) => n.kind === "astra")) return null;
  // An undo in Just talking's preview: Do it steps back, and an undo never shoots (money rule 6).
  if (plan.reading?.undo) return null;
  // A row that waits on a "which one?", a take on a still of another shape,
  // or a person who can't be cast is not a frame to shoot yet: Do it asks,
  // and nothing priced stands beside it (review of Cut 2, S1).
  if (plan.needs.some((n) => n.kind === "which" || n.kind === "takeFormat")) return null;
  if (plan.notes.some((n) => n.kind === "notCastable" || n.kind === "whoUnknown")) return null;
  const motion = plan.steps.find((s): s is Extract<Step, { kind: "motion" }> => s.kind === "motion");
  const engine = motion?.engine ?? state.takeEngine;
  const wantsMove = plan.reading?.move !== undefined || plan.reading?.textures !== undefined;
  const arms = plan.steps.some((s) => s.kind === "takeArm");
  if (arms || plan.takeAfter?.armedBy === "person" || (wantsMove && plan.takeAfter !== null)) return { kind: "take", credits: state.credits.take[engine] };
  // A move with nothing to start from: the reply says to shoot this frame first.
  if (wantsMove) return null;
  return { kind: "shoot", credits: state.credits.still };
}

/**
 * What a priced or generic Shoot button does, and the price its label
 * shows — the same answer, so a label never says a still's price for a
 * take (check of the spec, item 1):
 * - "shoot": every generic Shoot — ⌘K's row, the "/" row, an empty Enter,
 *   the composer's send — takes the PERSON's own take, and shoots a still
 *   otherwise: it never renders a take the chat set up;
 * - "shootAsIs": [Shoot as it is · n], the same;
 * - "doItShoot": a still; "take" and "doItTake": the take;
 * - "astraThenShoot": [Change it, then shoot · n], a still once the change saves.
 */
export type PressButton = "shoot" | "shootAsIs" | "doItShoot" | "take" | "doItTake" | "astraThenShoot";
export function pressFor(
  button: PressButton,
  state: Pick<PageState, "takeStart" | "takeEngine" | "credits">,
): { kind: "still" | "take"; credits: number; afterSave: boolean } {
  const still = { kind: "still" as const, credits: state.credits.still, afterSave: false };
  const take = { kind: "take" as const, credits: state.credits.take[state.takeEngine], afterSave: false };
  switch (button) {
    case "shoot":
    case "shootAsIs":
      return state.takeStart?.armedBy === "person" ? take : still;
    case "doItShoot":
      return still;
    case "take":
    case "doItTake":
      return take;
    case "astraThenShoot":
      return { ...still, afterSave: true };
  }
}

// ---------------------------------------------------------------------------
// Undo (spec §3.5).
// ---------------------------------------------------------------------------

/** Everything a turn can change on the page, to step back to. */
export type TurnState = {
  characterId: string | null;
  markId: string | null;
  mark: { x: number; z: number; facingDeg: number };
  pose: StandPose;
  gaze: Gaze | null;
  cameraId: string | null;
  camera: CameraPose;
  rig: SetRig;
  direction: string;
  frameX: FrameX;
  takeStart: TakeStart | null;
  takeMove: TakeMove | null;
  takeEngine: SetTakeEngine;
  outfitOff: boolean;
  /**
   * The look (the still the world is drawn from): picked, with the still or
   * none, or following the newest still on its own — then which still that
   * is changes as stills land, and is no one's move (review of Cut 2, U6:
   * Undo said "Undone" and left a picked look pinned).
   */
  look: TurnLook;
};

/** The look as a turn leaves it: picked (a still, or none), or following the newest still. */
export type TurnLook = { pinned: true; id: string | null } | { pinned: false };

/** One turn, to undo: the state before and after it, the Astra change it pressed (if any), and whether it shot a still. */
export type TurnSnapshot = {
  before: TurnState;
  after: TurnState;
  astra?: { before: SetSpec; undo: EditUndo | null; kind: "edit" | "rebuild"; landed: boolean };
  stillShot?: boolean;
};

const closeEnough = (a: unknown, b: unknown): boolean => {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-3;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => closeEnough(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
    const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => closeEnough((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
};

/** The fields that differ between two states (numbers to a thousandth: a reload's rounding is not a move). */
export function snapshotDiff(a: TurnState, b: TurnState): (keyof TurnState)[] {
  return (Object.keys(a) as (keyof TurnState)[]).filter((k) => !closeEnough(a[k], b[k]));
}

/** Whether two takes are the same take, set up the same way. */
const sameTake = (a: TakeStart | null, b: TakeStart | null): boolean => (a === null || b === null ? a === b : a.id === b.id && a.n === b.n && a.armedBy === b.armedBy);

/**
 * What Undo puts back of the take (review of Cut 2, S2): the take as that
 * turn found it, but only while it is still as the turn left it. Once
 * something since rendered it, cancelled it or set another one up, the take
 * stays as it is now: a take that already rendered never comes back set up
 * — least of all as the person's own, which "Shoot without asking" and every
 * generic Shoot would render again on their own.
 */
export function undoneTake(snapshot: Pick<TurnSnapshot, "before" | "after">, current: TurnState): Pick<TurnState, "takeStart" | "takeMove" | "takeEngine"> {
  const from = sameTake(current.takeStart, snapshot.after.takeStart) ? snapshot.before : current;
  return { takeStart: from.takeStart, takeMove: from.takeMove, takeEngine: from.takeEngine };
}

/** What Undo leaves as it is, so not a move by hand either: the take when it has moved on, and the outfit flag a shot uses up. */
const TAKE_KEYS: readonly (keyof TurnState)[] = ["takeStart", "takeMove", "takeEngine"];

export type UndoPlan =
  | { kind: "none" }
  | {
      kind: "restore";
      snapshot: TurnSnapshot;
      /** The page to put back: the turn's `before`, with the take as undoneTake leaves it. */
      restore: TurnState;
      /** The person moved things by hand since that turn: those moves are undone too, and the reply says so. */
      handMoves: boolean;
      /** undoAstraEdit with the change's seal — never Astra, never a refund (money rule 5); `sealed` says whether its words come back. */
      astra: { before: SetSpec; undo: EditUndo | null; kind: "edit" | "rebuild"; sealed: boolean } | null;
      /** A still that turn shot stays in the filmstrip; nothing is given back. */
      stillsStay: boolean;
    };

/**
 * Undo, from the turns kept this visit (newest last) and the page as it is
 * now. The Astra change comes back only when it landed and is still the
 * set's latest (`astraLatest`: set-view.tsx specBeforeEditRef is its
 * before); a rebuild never changes the text, so it is "sealed" either way.
 */
export function undoPlan(stack: readonly TurnSnapshot[], current: TurnState, astraLatest: boolean): UndoPlan {
  const snapshot = stack[stack.length - 1];
  if (!snapshot) return { kind: "none" };
  const a = snapshot.astra;
  const take = undoneTake(snapshot, current);
  const takeKept = !sameTake(current.takeStart, snapshot.after.takeStart);
  // The outfit flag is used up by the shot a turn takes (set-view.tsx
  // shoot/take): that is no move of theirs, so it never says "your own
  // moves since" (review of Cut 2, U N2); nor is a take that moved on.
  const moved = snapshotDiff(current, snapshot.after).filter((k) => k !== "outfitOff" && !(takeKept && TAKE_KEYS.includes(k)));
  return {
    kind: "restore",
    snapshot,
    restore: { ...snapshot.before, ...take },
    handMoves: moved.length > 0,
    astra: a && a.landed && astraLatest ? { before: a.before, undo: a.undo, kind: a.kind, sealed: a.kind === "rebuild" || a.undo !== null } : null,
    stillsStay: snapshot.stillShot === true,
  };
}

/** The turns kept to undo, the newest last, at most TURN_UNDO_MAX. */
export function keepSnapshot(stack: readonly TurnSnapshot[], snapshot: TurnSnapshot): TurnSnapshot[] {
  return [...stack, snapshot].slice(-TURN_UNDO_MAX);
}
