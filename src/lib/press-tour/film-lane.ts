// Filming's switch and lane, as a leaf (Cut 4 integration, 2026-09-26): the
// names press-tour-03b-film.sql inserts, the lanes filming may use, and the
// check Admin > Settings runs before saving press_film_lane. film.ts
// re-exports all of it; this file exists so Admin can validate the setting
// without loading the filming machine. Pure and alias-free.

import { FILM_LANE } from "./quote";

/** Filming's own switch, inserted OFF by press-tour-03b-film.sql. */
export const FILM_FLAG = "press_tour_film";
/** The film lane's setting, seeded 'kling-o3' by press-tour-03b-film.sql. */
export const FILM_LANE_SETTING = "press_film_lane";
export const DEFAULT_FILM_LANE = "kling-o3";

export type FilmLane = {
  modelId: string;
  /** The lane takes the still as its first frame (fal.ts openingFrame). */
  openingFrame: true;
  /** Audio is requested OFF (fal.ts generateNativeAudio false). */
  audio: false;
};

/**
 * The lanes filming may use. Only a lane the quote prices (quote.ts
 * FILM_LANE) may film: the Film press charges the quote's film line, so a
 * lane the quote does not price would charge one price and film another.
 */
export const FILM_LANES: Readonly<Record<string, FilmLane>> = {
  "kling-o3": { modelId: "kling-o3", openingFrame: true, audio: false },
};

/** The lane a stored setting names. A missing row is the default; an unknown or unpriced lane closes filming (null). */
export function resolveFilmLane(raw: unknown): FilmLane | null {
  if (raw === undefined || raw === null) return FILM_LANES[DEFAULT_FILM_LANE] ?? null;
  if (typeof raw !== "string") return null;
  const lane = FILM_LANES[raw.trim().toLowerCase()];
  return lane && lane.modelId === FILM_LANE.modelId ? lane : null;
}

/**
 * For Admin > Settings (admin/actions.ts validateAppSetting): the error for
 * a press_film_lane value filming would read as closed, or null. Any other
 * key gets null. The reader already fails closed on a bad value; this stops
 * a typo from being saved as if it had worked.
 */
export function validateFilmLaneSetting(key: string, value: string): string | null {
  if (key !== FILM_LANE_SETTING) return null;
  if (resolveFilmLane(value)) return null;
  const priced = Object.keys(FILM_LANES).filter((id) => resolveFilmLane(id) !== null);
  return `${FILM_LANE_SETTING} must be a lane the Press Tour quote prices: ${priced.join(", ")}. Anything else keeps filming closed.`;
}
