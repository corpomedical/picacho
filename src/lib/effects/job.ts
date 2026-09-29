// An effect as a job (operator, 2026-09-29): a `video_edits` row, like
// Director's Cut and the titles-and-credits finishing, so it shares the
// minute tick, the lock, the retries and the delivery to History. Its
// `director` column says it is an effect and holds where it stands:
// { door: "effects", kind: "shot" | "photo", fx }. Pure.

import type { QueuedJob } from "../generations/providers/fal";

export type FxKind = "shot" | "photo";

export type FxTry = {
  /** What the engine was given: Opus's instruction on a video, the provider's effect name on a photo. */
  instruction: string;
  job: QueuedJob;
  at: number;
  /** Opus's reading of this try's result, once it has one. */
  verdict: { ok: boolean; note: string } | null;
};

export type FxState = {
  kind: FxKind;
  /** A recipe id (catalog.SHOT_RECIPES) or a photo preset id (catalog.PHOTO_PRESETS); null = their own words only. */
  effectId: string | null;
  /** The name the page shows. */
  effectName: string;
  /** Their own words, on a video. */
  words: string;
  media: "video" | "image";
  width: number | null;
  height: number | null;
  /** Opus's title and one line, once it has read the shot. */
  plan: { title: string; summary: string } | null;
  tries: FxTry[];
  /** Where it came from: an upload, or one of their own History takes. */
  source: { kind: "upload" } | { kind: "take"; takeId: string };
};

export type FxMarker = { door: "effects"; kind: FxKind; fx: FxState };

/** Two tries at most: the first, and one Opus rewrote after reading a miss. */
export const MAX_TRIES = 2;

/** The `director` column → the effect it holds, or null for any other job. */
export function fxOf(director: unknown): FxState | null {
  if (!director || typeof director !== "object") return null;
  const d = director as { door?: unknown; kind?: unknown; fx?: unknown };
  if (d.door !== "effects" || (d.kind !== "shot" && d.kind !== "photo") || !d.fx || typeof d.fx !== "object") return null;
  return d.fx as FxState;
}

export function fxMarker(fx: FxState): FxMarker {
  return { door: "effects", kind: fx.kind, fx };
}

/** The shape a finished video is shown and stored as. */
export function aspectOf(width: number | null | undefined, height: number | null | undefined): "16:9" | "9:16" | "1:1" {
  if (!width || !height) return "16:9";
  const r = width / height;
  return r < 0.83 ? "9:16" : r > 1.2 ? "16:9" : "1:1";
}

/** What an engine's failure means to the customer, in plain words. */
export function refusalOf(error: string): boolean {
  return /content[_ ]policy|sensitive|safety|prohibited|not allowed|nsfw|moderat/i.test(error);
}

export const FX_REFUSED = "The effects engine refused this one. Try another effect, or another clip or photo.";
export const FX_FAILED = "The effects engine didn't finish this one. Try again in a moment.";
export const FX_TOO_LONG = "Effects in the shot work on clips up to 15 seconds. Pick a shorter clip, or trim it first.";
export const FX_TOO_BIG = "That clip is over 50 MB. Pick a shorter or smaller one.";
