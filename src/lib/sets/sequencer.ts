// The sequencer (canvas page J, board J1; cut B of closing the gap,
// 2026-09-17): one timeline under the viewport with a track for the
// camera, the figure, the sun, the key light and the takes — the film's
// beats laid along the seconds they run, a playhead, and the words the
// transport says. Pure: the panel (sequencer.tsx) draws what these return,
// and the test holds them. The film's data stays film.ts's: a beat is its
// engine's fixed seconds, its end a keyframe, its figure and hour the
// tracks cut 5 gave it.

import { nearestLens } from "./build-scene";
import type { FilmPose, SetFilm } from "./film";
import { SET_TAKE_ENGINES } from "./take";

export const SEQUENCER_TRACKS = ["camera", "figure", "sun", "light", "takes"] as const;
export type SequencerTrack = (typeof SEQUENCER_TRACKS)[number];

/** A beat along the seconds: it starts where the one before ended. */
export type BeatSpan = { index: number; start: number; end: number };

export function beatSpans(film: Pick<SetFilm, "engine" | "beats">): BeatSpan[] {
  const seconds = SET_TAKE_ENGINES[film.engine].seconds;
  return film.beats.map((_, index) => ({ index, start: index * seconds, end: (index + 1) * seconds }));
}

/** How long the film runs, seconds: the last beat's end, or 0 with no beat. */
export function filmDuration(film: Pick<SetFilm, "engine" | "beats">): number {
  const spans = beatSpans(film);
  return spans.length ? spans[spans.length - 1].end : 0;
}

/** The transport's clock: minutes, seconds, hundredths — 00:03.12. */
export function filmClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const whole = Math.floor(rest);
  const hundredths = Math.min(99, Math.round((rest - whole) * 100));
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(m)}:${two(whole)}.${two(hundredths)}`;
}

/** The ruler's marks, one a second, from 0 to the film's end (at least one second of ruler with no film). */
export function rulerSeconds(duration: number): number[] {
  const end = Math.max(1, Math.ceil(duration));
  return Array.from({ length: end + 1 }, (_, i) => i);
}

/** What a keyframe says of itself: the lens it was framed with (full frame) and how high the camera stands. */
export function keyframeAt(pose: FilmPose): { lensMm: number; heightM: number } {
  return { lensMm: nearestLens(pose.fovDeg), heightM: Math.round(pose.position[1] * 10) / 10 };
}

/** The beat under a time, and how far into it (0–1). Before the film: its first beat's start; after: its last beat's end. Null with no beats. */
export function beatAtTime(spans: readonly BeatSpan[], t: number): { index: number; u: number } | null {
  if (spans.length === 0) return null;
  if (t <= spans[0].start) return { index: spans[0].index, u: 0 };
  const last = spans[spans.length - 1];
  if (t >= last.end) return { index: last.index, u: 1 };
  const span = spans.find((sp) => t >= sp.start && t < sp.end) ?? last;
  return { index: span.index, u: (t - span.start) / (span.end - span.start) };
}

/** The time a share of a beat stands at. */
export function timeOf(spans: readonly BeatSpan[], index: number, u: number): number {
  const span = spans.find((sp) => sp.index === index);
  if (!span) return 0;
  return span.start + Math.min(1, Math.max(0, u)) * (span.end - span.start);
}

/** The takes track's states: done (a clip to play), rendering, failed, or not shot yet. */
export type TakeState = "done" | "rendering" | "failed" | "not-shot";

export function takeState(status: string | null | undefined, busy: boolean): TakeState {
  if (busy) return "rendering";
  if (!status) return "not-shot";
  if (status === "succeeded") return "done";
  if (status === "failed") return "failed";
  return "rendering";
}

/** The sun track: each beat that sets an hour, with the hour it comes from — the beat before's, else the rig's. */
export function sunHours(film: Pick<SetFilm, "beats">, rigTime: number | null): { index: number; from: number | null; to: number }[] {
  const out: { index: number; from: number | null; to: number }[] = [];
  let hour: number | null = rigTime;
  film.beats.forEach((b, index) => {
    if (b.time === null) return;
    out.push({ index, from: hour, to: b.time });
    hour = b.time;
  });
  return out;
}
