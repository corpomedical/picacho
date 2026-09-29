// Helios Studio · Blender (Cycles) renders on a cloud GPU (2026-09-29).
// The operator picked "Real Blender renders": the Studio's scene goes to
// Blender itself, which path-traces it with Cycles on one of Modal's GPUs
// (modal/helios_cycles.py) and hands back a PNG or an MP4.
//
// This module is the shape of one render, safe for the page and the server:
// the caps, the check of a job before anything is sent or spent, the time
// and cost estimate the window shows, and where the files live. Relative
// imports on purpose (vitest has no "@/" alias).

import { THING_MODEL_BUCKET } from "./thing-model";

// ---------------------------------------------------------------------------
// The machine and its price
// ---------------------------------------------------------------------------

/** The one GPU every render runs on. MUST match GPU in modal/helios_cycles.py. */
export const HELIOS_CYCLES_GPU = "L40S";
/** CPU cores and memory the render container asks for. MUST match CPU_CORES / MEMORY_MIB there. */
export const HELIOS_CYCLES_CPU_CORES = 4;
export const HELIOS_CYCLES_MEMORY_GIB = 16;

// Modal's prices, read from modal.com/pricing on 2026-09-29 (the Starter
// plan includes $30 of compute a month):
//   Nvidia L40S $0.000542 / s · CPU $0.0000131 / physical core / s · memory $0.00000222 / GiB / s
export const MODAL_L40S_USD_PER_S = 0.000542;
export const MODAL_CPU_CORE_USD_PER_S = 0.0000131;
export const MODAL_MEMORY_GIB_USD_PER_S = 0.00000222;

/** One second of the render container: 0.000542 + 4 × 0.0000131 + 16 × 0.00000222 = $0.00062992. */
export const CYCLES_USD_PER_S =
  MODAL_L40S_USD_PER_S + HELIOS_CYCLES_CPU_CORES * MODAL_CPU_CORE_USD_PER_S + HELIOS_CYCLES_MEMORY_GIB * MODAL_MEMORY_GIB_USD_PER_S;

// Time, NOT MEASURED YET: the quote of 2026-09-29 assumed about 30 s to
// start a GPU container with Blender and about 15 s for a 1080p frame at 128
// samples (so a 1080p still at 256 samples ≈ 30 + 30 s ≈ $0.04, and 240
// such frames ≈ 3,600 s ≈ $2.27). Replace both with the first proof
// render's own numbers (the window shows the measured GPU seconds).
export const CYCLES_START_SECONDS = 30;
/** Seconds per megapixel per sample: 15 s ÷ (1920 × 1080 / 1e6 MP × 128 samples) ≈ 0.0565. */
export const CYCLES_SECONDS_PER_MP_SAMPLE = 15 / (((1920 * 1080) / 1e6) * 128);

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

// Who may press it: set-config.ts HELIOS_CYCLES_FOR_ALL (admins only while false).

/**
 * The credit price of a Blender render. NONE while it is the team's: an
 * admin's render is charged nothing (Picacho pays the GPU time, shown in the
 * window). The operator sets the price here before HELIOS_CYCLES_FOR_ALL
 * opens it; the door refuses everyone else while this is null.
 */
export const HELIOS_CYCLES_CREDITS: { still: number; perAnimationSecond: number } | null = null;

// ---------------------------------------------------------------------------
// Caps: a job past any of these is refused before a byte is sent
// ---------------------------------------------------------------------------

export const CYCLES_MIN_EDGE = 64;
/** The longest side of a still (4K) and of an animation frame (1080p). */
export const CYCLES_MAX_EDGE_STILL = 3840;
export const CYCLES_MAX_EDGE_ANIMATION = 1920;
export const CYCLES_MAX_SAMPLES_STILL = 2048;
export const CYCLES_MAX_SAMPLES_ANIMATION = 512;
/** The Studio's whole timeline: 10 s at 24 fps. */
export const CYCLES_MAX_FRAMES = 240;
/**
 * The longest render the estimate may promise: 90 minutes. The Modal
 * function's own timeout (TIMEOUT_S = 6,000 s there) is the hard stop, so
 * the most one render can spend is 6,000 × $0.00062992 ≈ $3.78.
 */
export const CYCLES_MAX_SECONDS = 5400;
/** The scene file the Studio sends. */
export const CYCLES_GLB_MAX_BYTES = 50 * 1024 * 1024;
/** The job's JSON (camera and moving things, one matrix per frame): the longest the caps allow is ≈ 2.2 MB, under a request's 4.5 MB on Vercel. */
export const CYCLES_JOB_MAX_CHARS = 3_000_000;
/** Moving things carried frame by frame. */
export const CYCLES_MAX_TRACKS = 64;
/** A moving thing's node name in the scene file: the Studio names them, Blender finds them by it. */
export const CYCLES_NODE_RE = /^helios_item_\d{1,4}$/;

/** The picks the window offers: the longest side, per kind. */
export const CYCLES_EDGES = { still: [1280, 1920, 3840], animation: [1280, 1920] } as const;
export const CYCLES_DEFAULT_SAMPLES = { still: 256, animation: 64 } as const;

// ---------------------------------------------------------------------------
// Where the files live
// ---------------------------------------------------------------------------

/** The bucket the Studio's 3D files already live in (thing-model.ts), with no type limit on it. */
export const CYCLES_BUCKET = THING_MODEL_BUCKET;
export type CyclesFile = "glb" | "json" | "png" | "mp4";

/** One render's files, in the owner's own sets folder, named by the set and the press. */
export function cyclesPath(userId: string, setId: string, pressId: string, file: CyclesFile): string {
  return `${userId}/sets/${setId}.cycles.${pressId}.${file}`;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export const CYCLES_NOT_SWITCHED_ON = "Blender renders aren't switched on yet.";
export const CYCLES_TEAM_ONLY = "Blender renders are for the team for now.";
export const CYCLES_BAD_JOB = "Those render settings couldn't be read, so nothing was sent.";
export const CYCLES_TOO_BIG = "This scene is too big to send for a Blender render (the limit is 50 MB).";
export const CYCLES_NOT_A_SCENE = "The scene file didn't arrive, so nothing was rendered. Try again.";
export const CYCLES_TOO_LONG = "That would take more than 90 minutes on the GPU. Lower the samples, the size or the frames.";
export const CYCLES_TOO_FAST = "You're sending Blender renders quickly — give it a moment.";
export const CYCLES_UNREACHABLE = "The render computer didn't answer, so nothing was rendered. Try again in a minute.";
export const CYCLES_SAVE_FAILED = "Couldn't keep the render's files. Try again.";
export const CYCLES_GONE = "That render isn't there any more.";
export const CYCLES_FAILED = "Blender couldn't render this scene.";
export const CYCLES_TIMED_OUT = "The render ran past its time limit and was stopped.";

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

export type CyclesKind = "still" | "animation";
type Rgb = [number, number, number];
/** A three.js world matrix, column-major, 16 numbers. */
type Mat = number[];

export type CyclesJob = {
  kind: CyclesKind;
  width: number;
  height: number;
  samples: number;
  /** A still renders frameStart only (frameEnd is the same). */
  frameStart: number;
  frameEnd: number;
  fps: number;
  lensMm: number;
  /** The Studio's lens is on a 24 mm-high sensor, fitted vertically (studio-engine.ts lensToFov). */
  sensorMm: number;
  /** The shot camera's world matrix, one per frame. */
  camera: Mat[];
  /** Things that move over the range: their world matrix, one per frame. None for a still. */
  tracks: { node: string; m: Mat[] }[];
  world: { mode: "simple" | "physical" | "studio"; background: Rgb; sky: Rgb; ground: Rgb; strength: number };
  sun: { on: boolean; dir: [number, number, number]; color: Rgb; strength: number };
  hour: number;
};

const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const isInt = (v: unknown, lo: number, hi: number): v is number => isNum(v, lo, hi) && Number.isInteger(v);
const isRgb = (v: unknown): v is Rgb => Array.isArray(v) && v.length === 3 && v.every((c) => isNum(c, 0, 64));
const isMat = (v: unknown): v is Mat => Array.isArray(v) && v.length === 16 && v.every((c) => isNum(c, -1e6, 1e6));

/** The frames a job covers. */
export function cyclesFrames(job: Pick<CyclesJob, "frameStart" | "frameEnd">): number {
  return job.frameEnd - job.frameStart + 1;
}

/** Seconds and dollars a render should take — an ESTIMATE from the unmeasured constants above. */
export function estimateCycles(job: { width: number; height: number; samples: number; frames: number }): { seconds: number; usd: number } {
  const perFrame = ((job.width * job.height) / 1e6) * job.samples * CYCLES_SECONDS_PER_MP_SAMPLE;
  const seconds = CYCLES_START_SECONDS + perFrame * Math.max(1, job.frames);
  return { seconds, usd: seconds * CYCLES_USD_PER_S };
}

/** What a measured run cost: its container seconds × the rate above. */
export function cyclesUsd(seconds: number): number {
  return Math.max(0, seconds) * CYCLES_USD_PER_S;
}

/** The long side a width and height make, for the caps. */
const longEdge = (w: number, h: number) => Math.max(w, h);

/**
 * The job exactly as it will be sent, or why not. Checked on the server
 * before the scene is read or the GPU asked; nothing the page says is
 * taken on trust. Unknown fields are dropped.
 */
export function validateCyclesJob(raw: unknown): { ok: true; job: CyclesJob } | { ok: false; error: string } {
  const bad = { ok: false as const, error: CYCLES_BAD_JOB };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad;
  const j = raw as Record<string, unknown>;
  const kind = j.kind;
  if (kind !== "still" && kind !== "animation") return bad;
  const still = kind === "still";
  const maxEdge = still ? CYCLES_MAX_EDGE_STILL : CYCLES_MAX_EDGE_ANIMATION;
  if (!isInt(j.width, CYCLES_MIN_EDGE, maxEdge) || !isInt(j.height, CYCLES_MIN_EDGE, maxEdge)) return bad;
  if (!isInt(j.samples, 1, still ? CYCLES_MAX_SAMPLES_STILL : CYCLES_MAX_SAMPLES_ANIMATION)) return bad;
  if (!isInt(j.frameStart, 1, 100_000) || !isInt(j.frameEnd, 1, 100_000)) return bad;
  const frames = j.frameEnd - j.frameStart + 1;
  if (still ? frames !== 1 : frames < 2 || frames > CYCLES_MAX_FRAMES) return bad;
  if (!isInt(j.fps, 1, 60) || !isNum(j.lensMm, 1, 2000) || !isNum(j.sensorMm, 1, 100) || !isNum(j.hour, 0, 24)) return bad;
  if (!Array.isArray(j.camera) || j.camera.length !== frames || !j.camera.every(isMat)) return bad;
  const tracks = j.tracks;
  if (!Array.isArray(tracks) || (still && tracks.length > 0) || tracks.length > CYCLES_MAX_TRACKS) return bad;
  const names = new Set<string>();
  for (const t of tracks) {
    if (!t || typeof t !== "object") return bad;
    const { node, m } = t as { node?: unknown; m?: unknown };
    if (typeof node !== "string" || !CYCLES_NODE_RE.test(node) || names.has(node)) return bad;
    if (!Array.isArray(m) || m.length !== frames || !m.every(isMat)) return bad;
    names.add(node);
  }
  const w = j.world as Record<string, unknown> | null;
  if (!w || typeof w !== "object" || !["simple", "physical", "studio"].includes(w.mode as string)) return bad;
  if (!isRgb(w.background) || !isRgb(w.sky) || !isRgb(w.ground) || !isNum(w.strength, 0, 100)) return bad;
  const s = j.sun as Record<string, unknown> | null;
  if (!s || typeof s !== "object" || typeof s.on !== "boolean" || !isRgb(s.color) || !isNum(s.strength, 0, 1000)) return bad;
  if (!Array.isArray(s.dir) || s.dir.length !== 3 || !s.dir.every((c) => isNum(c, -1e6, 1e6)) || Math.hypot(...(s.dir as number[])) < 1e-6) return bad;
  const job: CyclesJob = {
    kind,
    width: j.width,
    height: j.height,
    samples: j.samples,
    frameStart: j.frameStart,
    frameEnd: j.frameEnd,
    fps: j.fps,
    lensMm: j.lensMm,
    sensorMm: j.sensorMm,
    camera: j.camera as Mat[],
    tracks: (tracks as { node: string; m: Mat[] }[]).map((t) => ({ node: t.node, m: t.m })),
    world: { mode: w.mode as CyclesJob["world"]["mode"], background: w.background, sky: w.sky, ground: w.ground, strength: w.strength },
    sun: { on: s.on, dir: s.dir as [number, number, number], color: s.color, strength: s.strength },
    hour: j.hour,
  };
  if (JSON.stringify(job).length > CYCLES_JOB_MAX_CHARS) return bad;
  if (longEdge(job.width, job.height) > maxEdge) return bad;
  if (estimateCycles({ width: job.width, height: job.height, samples: job.samples, frames }).seconds > CYCLES_MAX_SECONDS)
    return { ok: false, error: CYCLES_TOO_LONG };
  return { ok: true, job };
}

/** The render's size for a Studio frame shape (width ÷ height) and a longest side. Even numbers, for the video encoder. */
export function cyclesSize(aspect: number, edge: number): [number, number] {
  const even = (n: number) => Math.max(CYCLES_MIN_EDGE, Math.round(n / 2) * 2);
  return aspect >= 1 ? [even(edge), even(edge / aspect)] : [even(edge * aspect), even(edge)];
}

/** "40 s", "1 min", "1 h 5 min": the window's time words, before translation. */
export function cyclesDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Dollars to show: cents, or a tenth of a cent below one cent. */
export function cyclesDollars(usd: number): string {
  return usd < 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`;
}
