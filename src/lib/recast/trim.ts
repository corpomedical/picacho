// The window (2026-09-18, after the operator's first real take came back
// wrong). Pure and alias-free: the door draws with it, the action cuts and
// charges with it, the tests pin it.
//
// WHY IT EXISTS. His clip was 28 seconds. "Into the clip" — the job that
// keeps the clip's own room and its own people — stops at 10 (Wan's measured
// speed against the runner's 45-minute write-off, recast.ts). So the door
// quietly moved the clip to the one job that takes 28 s, "Photo to life",
// which builds the whole video out of the character's PHOTO. The photo was a
// tight selfie; the clip's camera pulled back into a wide room full of
// people; there was nothing in a selfie to pull back into, and the engine
// invented a room and a crowd of cloned children to fill it.
//
// The fix is not a longer ceiling — that number is the engine's, not ours —
// it is letting a person pick WHICH ten seconds. Every job then takes every
// clip, nobody is moved to a job they did not choose, and the job that suits
// the footage stays on the table.
//
// MONEY. A window is priced from the SOURCE file's own numbers, scaled to
// the window: its length for the engines that bill seconds, its frames for
// the one that bills frames (frames × window ÷ length). The cut the server
// makes is frame-accurate, so its real frame count lands within a frame of
// that — about half a cent on Wan — and the take is charged the quoted
// number, not a recount: the number on the button is the number charged.

import { recastCreditCost, RECAST_ENGINES, RECAST_JOB_MAX_SECONDS, RECAST_MIN_SECONDS, type RecastClip, type RecastEngine } from "./recast";

export type RecastWindow = { start: number; end: number };

/** Tenths of a second: the door's slider step and what the cut is asked for. */
const tenth = (v: number) => Math.round(v * 10) / 10;

/**
 * The window the door opens with for a job: the whole clip when it fits,
 * otherwise the first stretch the job takes.
 */
export function defaultRecastWindow(seconds: number, job: keyof typeof RECAST_JOB_MAX_SECONDS): RecastWindow {
  return { start: 0, end: tenth(Math.min(seconds, RECAST_JOB_MAX_SECONDS[job])) };
}

/**
 * A window brought inside the rules: inside the clip, at least the shortest
 * take, at most the job's ceiling — keeping the START where it was put and
 * moving the end, because the start is the moment a person chose.
 */
export function clampRecastWindow(window: RecastWindow, seconds: number, job: keyof typeof RECAST_JOB_MAX_SECONDS): RecastWindow {
  const max = Math.min(RECAST_JOB_MAX_SECONDS[job], seconds);
  const min = Math.min(RECAST_MIN_SECONDS, seconds);
  let start = Number.isFinite(window.start) ? Math.max(0, window.start) : 0;
  let end = Number.isFinite(window.end) ? Math.min(seconds, window.end) : seconds;
  if (start > seconds - min) start = seconds - min;
  if (end - start > max) end = start + max;
  if (end - start < min) end = Math.min(seconds, start + min);
  if (end - start < min) start = Math.max(0, end - min);
  return { start: tenth(start), end: tenth(end) };
}

/** Why a window from the wire cannot be used, or null. Never trusted, only checked. */
export function recastWindowProblem(
  window: unknown,
  seconds: number,
  job: keyof typeof RECAST_JOB_MAX_SECONDS,
): "shape" | "outside" | "too-short" | "too-long" | null {
  if (typeof window !== "object" || window === null) return "shape";
  const w = window as Record<string, unknown>;
  if (typeof w.start !== "number" || typeof w.end !== "number" || !Number.isFinite(w.start) || !Number.isFinite(w.end)) return "shape";
  // A hair of slack either side: the door rounds to tenths.
  if (w.start < -0.05 || w.end > seconds + 0.05 || w.end <= w.start) return "outside";
  const length = w.end - w.start;
  if (length < RECAST_MIN_SECONDS - 0.05) return "too-short";
  if (length > RECAST_JOB_MAX_SECONDS[job] + 0.05) return "too-long";
  return null;
}

/** True when the window is the whole clip — nothing to cut. */
export function isWholeClip(window: RecastWindow, seconds: number): boolean {
  return window.start <= 0.05 && window.end >= seconds - 0.05;
}

/** The clip a window describes, for pricing: its length, and its share of the frames. */
export function windowedClip(clip: Pick<RecastClip, "seconds" | "frames">, window: RecastWindow): Pick<RecastClip, "seconds" | "frames"> {
  const length = Math.max(0, window.end - window.start);
  const share = clip.seconds > 0 ? length / clip.seconds : 1;
  return { seconds: length, frames: clip.frames === null ? null : Math.round(clip.frames * share) };
}

/** What a take on this window costs, in credits. The door and the action both call this. */
export function recastWindowCredits(engine: RecastEngine, clip: Pick<RecastClip, "seconds" | "frames">, window: RecastWindow): number {
  return recastCreditCost(engine, windowedClip(clip, window));
}

/** Cut times from the whole clip, moved into the window's own clock; cuts outside it are gone. */
export function cutsInWindow(cuts: number[], window: RecastWindow): number[] {
  return cuts.filter((c) => c > window.start + 0.2 && c < window.end - 0.2).map((c) => tenth(c - window.start));
}

/**
 * The ffmpeg arguments that cut a window out of a clip.
 *
 * Re-encoded rather than stream-copied: a copy can only start on a keyframe,
 * which on phone footage can be seconds before the chosen moment, and the
 * whole point is the moment chosen. `-ss` before `-i` seeks fast to the
 * keyframe and then decodes accurately to the exact time. The quality is
 * kept high because the engine is about to re-render every frame anyway —
 * losing detail here is losing it twice. Sound is kept (the engines that
 * keep sound keep this sound). faststart so the provider can begin reading
 * before the download ends.
 */
export function recastTrimArgs(inputPath: string, outputPath: string, window: RecastWindow): string[] {
  return [
    "-y",
    "-v",
    "error",
    "-ss",
    window.start.toFixed(2),
    "-i",
    inputPath,
    "-t",
    (window.end - window.start).toFixed(2),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

/** Which engines' jobs a window of this length suits — for the door's labels. */
export function jobCeiling(engine: RecastEngine): number {
  return RECAST_JOB_MAX_SECONDS[RECAST_ENGINES[engine].job];
}
