// Helios Studio · Render ▸ "Video with your character" (2026-09-30; the
// operator picked it: "Video with your character"). The Studio records its
// animated scene — the car moving, the people walking and posing, the shot
// camera moving — and Recast, the lane already live in Picacho, re-shoots
// that recording with a saved character in a figure's place. This is how
// the rivals work: animate in 3D, record, AI re-shoot.
//
// Pure, no path aliases (vitest has none): the range, the size, the price
// and the payload, worked out the way Recast works them out. The price is
// Recast's own (trim.ts recastWindowCredits, the call its door quotes with
// and its start charges with), never a number of the Studio's.

import { RECAST_ENGINES, RECAST_JOB_MAX_SECONDS, RECAST_MIN_SECONDS, type RecastEngine } from "../recast/recast";
import { RECAST_DIRECTION_MAX_CHARS } from "../recast/recast-brief";
import type { RecastRead } from "../recast/recast-read";
import { recastWindowCredits, type RecastWindow } from "../recast/trim";

/**
 * The lanes the Studio offers, in Recast's order. Into the clip (Kling O3
 * Edit) keeps the recording's moves, camera and look and swaps the figure;
 * Restage (MiniMax H3 Max, 768p) takes the recording as a reference and
 * films it again. Photo to life is left out: it builds the picture from the
 * character's photo and leaves the recording's world — the whole point here
 * — behind. Restyle casts nobody.
 */
export const STUDIO_RECAST_ENGINES = ["kling-edit", "h3-768"] as const satisfies readonly RecastEngine[];
export type StudioRecastEngine = (typeof STUDIO_RECAST_ENGINES)[number];

export function parseStudioRecastEngine(v: unknown): StudioRecastEngine | null {
  return typeof v === "string" && (STUDIO_RECAST_ENGINES as readonly string[]).includes(v) ? (v as StudioRecastEngine) : null;
}

/** The short side of the recording: Kling O3 Edit takes 720–3840 px a side, so nothing needs scaling up on the server. */
export const STUDIO_RECAST_SHORT_PX = 720;
export const STUDIO_RECAST_LONG_MAX_PX = 3840;
/** Bits a second for the recording: 10 s stays near 8 MB, far inside Recast's 50 MB. */
export const STUDIO_RECAST_BITRATE = 6_000_000;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** The recording's size for the shot camera's format: short side 720, even numbers, the format's own shape. */
export function studioRecastSize(aspect: number): { width: number; height: number } {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  if (a >= 1) return { width: Math.min(STUDIO_RECAST_LONG_MAX_PX, even(STUDIO_RECAST_SHORT_PX * a)), height: STUDIO_RECAST_SHORT_PX };
  return { width: STUDIO_RECAST_SHORT_PX, height: Math.min(STUDIO_RECAST_LONG_MAX_PX, even(STUDIO_RECAST_SHORT_PX / a)) };
}

/**
 * The timeline's playback range as Recast will take it (frames are 1-based
 * and inclusive; frame f shows at (f − 1) / fps): at least Recast's shortest
 * take, at most the job's ceiling and the timeline. The start is kept where
 * it was put and the end moved, as Recast's own window does (trim.ts
 * clampRecastWindow).
 */
export function studioRecastRange(a: { start: number; end: number; fps: number; lastFrame: number; engine: StudioRecastEngine }): {
  start: number;
  end: number;
  seconds: number;
  clamped: boolean;
} {
  const fps = a.fps;
  const lastFrame = Math.max(1, Math.floor(a.lastFrame));
  const maxFrames = Math.floor(Math.min(RECAST_JOB_MAX_SECONDS[RECAST_ENGINES[a.engine].job], lastFrame / fps) * fps + 1e-9);
  const minFrames = Math.min(lastFrame, Math.ceil(RECAST_MIN_SECONDS * fps - 1e-9));
  let start = Math.min(lastFrame, Math.max(1, Math.round(a.start)));
  let end = Math.min(lastFrame, Math.max(start, Math.round(a.end)));
  const was = [start, end].join();
  if (end - start + 1 > maxFrames) end = start + maxFrames - 1;
  if (end - start + 1 < minFrames) {
    end = Math.min(lastFrame, start + minFrames - 1);
    start = Math.max(1, end - minFrames + 1);
  }
  return { start, end, seconds: (end - start + 1) / fps, clamped: [start, end].join() !== was };
}

/** How many of a character's photos ride with a take on this engine — Recast's own rule (actions.ts photosOfRow). */
export function studioRecastPhotos(engine: StudioRecastEngine, photoCount: number): number {
  return Math.min(RECAST_ENGINES[engine].takesMorePhotos ? 4 : 1, Math.max(1, Math.floor(photoCount) || 0));
}

/** The whole recording is the window: from its first frame, for the range's length. */
export function studioRecastWindow(seconds: number): RecastWindow {
  return { start: 0, end: seconds };
}

/**
 * THE price, in credits: Recast's quote for a window this long on this
 * engine. Restage bills its reference pictures beside its seconds, and a
 * lone character's photos are all it carries (the Studio adds no images).
 */
export function studioRecastCredits(engine: StudioRecastEngine, seconds: number, photoCount: number): number {
  const references = RECAST_ENGINES[engine].restages ? studioRecastPhotos(engine, photoCount) : 0;
  return recastWindowCredits(engine, { seconds, frames: null }, studioRecastWindow(seconds), references);
}

export type FigureSpot = "left" | "middle" | "right";

/** Where a figure stands across the frame, from its screen x (−1 left edge … 1 right edge). */
export function studioFigureSpot(x: number): FigureSpot {
  return x < -0.25 ? "left" : x > 0.25 ? "right" : "middle";
}

const SPOT_WORDS: Record<FigureSpot, string> = { left: "on the left of the frame", middle: "in the middle of the frame", right: "on the right of the frame" };

/**
 * The person in Recast's read who is this figure, or null when that can't be
 * said for sure. One figure in the shot: the read's lead. Several: only when
 * the read found as many people as there are figures and says plainly where
 * each stands (left, middle, right), in the same order as the figures stand.
 * Otherwise the words say which figure, and the brief names nobody.
 */
export function studioRecastTag(read: Pick<RecastRead, "people"> | null, figuresX: readonly number[], chosen: number): string | null {
  const people = read?.people ?? [];
  if (people.length === 0 || chosen < 0 || chosen >= figuresX.length) return null;
  if (figuresX.length === 1) return (people.find((p) => p.lead) ?? people[0]).tag;
  if (people.length !== figuresX.length) return null;
  const across = (where: string): number | null => {
    const w = where.toLowerCase();
    const l = /\bleft\b/.test(w), r = /\bright\b/.test(w), m = /\b(middle|centre|center)\b/.test(w);
    return l && !r ? -1 : r && !l ? 1 : m && !l && !r ? 0 : null;
  };
  const read2 = people.map((p) => ({ tag: p.tag, x: across(p.where) }));
  if (read2.some((p) => p.x === null) || new Set(read2.map((p) => p.x)).size !== read2.length) return null;
  const figs = figuresX.map((x, i) => ({ i, x }));
  if (new Set(figs.map((f) => studioFigureSpot(f.x))).size !== figs.length) return null;
  const byX = [...figs].sort((p, q) => p.x - q.x).map((f) => f.i);
  const tags = [...read2].sort((p, q) => (p.x as number) - (q.x as number)).map((p) => p.tag);
  return tags[byX.indexOf(chosen)] ?? null;
}

/** The line that says which figure the character replaces, always sent (the grey mannequin is a stand-in, not a person). */
export function studioFigureLine(several: boolean, spot: FigureSpot): string {
  return several
    ? `The character takes the place of the grey mannequin figure ${SPOT_WORDS[spot]} and does exactly what it does; the other figures stay as they are.`
    : "The character takes the place of the grey mannequin figure and does exactly what it does.";
}

/** Restage's own line: the recording is a grey 3D mock-up, and this lane films it for real. */
export const STUDIO_RESTAGE_LINE = "Film it as live action: real materials, real light and a real place in place of the grey 3D mock-up, with the same camera move.";

/**
 * The direction sent to Recast: what happens (the person's words, prefilled
 * from the poses and moves), which figure, and Restage's line — bounded at
 * Recast's own limit, with the person's words shortened first.
 */
export function studioRecastDirection(a: { words: string; several: boolean; spot: FigureSpot; engine: StudioRecastEngine }): string {
  const fixed = [studioFigureLine(a.several, a.spot), ...(RECAST_ENGINES[a.engine].restages ? [STUDIO_RESTAGE_LINE] : [])].join(" ");
  const room = RECAST_DIRECTION_MAX_CHARS - fixed.length - 1;
  const words = a.words.replace(/\s+/g, " ").trim();
  const kept = Array.from(words).slice(0, Math.max(0, room)).join("").trim();
  return (kept ? `${kept} ${fixed}` : fixed).slice(0, RECAST_DIRECTION_MAX_CHARS);
}

/** One step the chosen figure takes inside the range, in seconds from the range's start. */
export type StudioRecastStep = { kind: "walk" | "run" | "turn"; from: number; to: number; toward: string | null };

const secs = (n: number) => `${Math.round(n * 10) / 10} s`;

/**
 * "What happens", prefilled: how the figure starts (the pose builder's own
 * sentence, studio-pose.ts poseSentence) and what it does over the range.
 * In English, for the video engine; the person may change it freely.
 */
export function studioRecastHappens(start: string, steps: readonly StudioRecastStep[]): string {
  const said = steps.map((s) => {
    const when = `From ${secs(s.from)} to ${secs(s.to)}`;
    if (s.kind === "turn") return `${when} they turn${s.toward ? ` to face ${s.toward}` : " on the spot"}.`;
    const verb = s.kind === "run" ? "run" : "walk";
    return `${when} they ${verb}${s.toward ? ` to ${s.toward}` : ""}.`;
  });
  return [start.trim(), ...said].filter(Boolean).join(" ");
}

/** What startRecastTakes is sent from the Studio: one character, the whole recording, this press's id. */
export type StudioRecastStart = {
  sendId: string;
  path: string;
  characterIds: string[];
  engine: StudioRecastEngine;
  keeps: string[];
  direction: string;
  castTag?: string;
  read: RecastRead | null;
  window: RecastWindow;
  rights: true;
};

export function studioRecastStart(a: {
  sendId: string;
  path: string;
  characterId: string;
  engine: StudioRecastEngine;
  seconds: number;
  direction: string;
  read: RecastRead | null;
  castTag: string | null;
}): StudioRecastStart {
  return {
    sendId: a.sendId,
    path: a.path,
    characterIds: [a.characterId],
    engine: a.engine,
    // Recast's door sends the read's keeps that are still ticked; nothing is untick-able here, so all of them.
    keeps: (a.read?.keeps ?? []).map((k) => k.what),
    direction: a.direction,
    ...(a.castTag ? { castTag: a.castTag } : {}),
    read: a.read,
    window: studioRecastWindow(a.seconds),
    // The recording is made here, from the person's own scene.
    rights: true,
  };
}
