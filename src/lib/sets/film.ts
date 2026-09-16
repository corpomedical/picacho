// The move (Helios Film, 2026-09-15, drawn as canvas page H): a film is a
// START STILL and up to three BEATS. Each beat is one continuous camera
// move — its end framed as a pose on the stage, its life written as words —
// and each beat renders as a take (take.ts): the end frame is shot in the
// set with the previous frame as its look, then the engine's
// start-and-end-frame lane animates the seconds between. Beat n starts on
// the exact frame beat n-1 ended on, so the whole film is one continuous
// shot by construction. Pure and relative-import only, like take.ts: the
// page, the save action and the test all read the same shape.

import type { Vec3 } from "./set-spec";
import { cleanText } from "./set-spec";
import { SET_DIRECTION_MAX_CHARS } from "./set-config";
import { isSetTakeEngine, SET_TAKE_DEFAULT_ENGINE, SET_TAKE_ENGINES, type SetTakeEngine } from "./take";
import { isFilmMove, isFilmTexture, type FilmMove, type FilmTexture } from "./moves";
import type { SetRig } from "./rig";

/** The stage's own camera pose shape (set-view's Pose, held as data). */
export type FilmPose = { position: Vec3; target: Vec3; fovDeg: number };

export type FilmBeat = {
  /** What happens in this beat — the person's words, cleaned like a direction. */
  words: string;
  /** Where the beat's move ends: a pose captured from the stage, or laid by a move. */
  end: FilmPose;
  /** The move that laid the end (moves.ts, Helios Cinema), said to the video model as the path; null for a keyframe framed by hand. */
  move: FilmMove | null;
  /** What rides on top of the path as words alone: handheld, slow motion, a whip. */
  textures: FilmTexture[];
};

export type SetFilm = {
  engine: SetTakeEngine;
  /** The finished still the film opens on — frame one, and the first beat's look. */
  startId: string | null;
  beats: FilmBeat[];
  /**
   * The clip each beat rendered as, in beat order — what the reel plays.
   * Kept with the move so a film the person paid for can be watched again
   * after they close the page, not only in the session that rendered it.
   * Shorter than the beats when the film is part-rendered or part-stale.
   */
  clips: (string | null)[];
  /**
   * The end still each rendered beat closed on, beside its clip — where the
   * next beat opens when only it renders again (filmRenderFrom).
   */
  ends: (string | null)[];
  /**
   * What the clips were rendered with besides the move itself: who is in
   * it, the rig as it reaches the picture, where the figure stands and the
   * set (filmContextKey). Under another, the film renders from its start.
   */
  context: string | null;
};

/**
 * Three, not more: the takes limiter allows four in ten minutes
 * (SET_TAKES_PER_10_MIN), and a film renders one take per beat back to
 * back — three keeps a whole film inside the limit with one take to spare.
 */
export const FILM_MAX_BEATS = 3;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const vec3 = (v: unknown): Vec3 | null => {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map((n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null));
  return out.every((n): n is number => n !== null) ? (out as unknown as Vec3) : null;
};

const pose = (v: unknown): FilmPose | null => {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const position = vec3(p.position);
  const target = vec3(p.target);
  const fov = typeof p.fovDeg === "number" && Number.isFinite(p.fovDeg) ? p.fovDeg : null;
  if (!position || !target || fov === null) return null;
  return { position, target, fovDeg: Math.min(120, Math.max(10, Math.round(fov * 100) / 100)) };
};

/**
 * Any stored or sent film through one door, the way normaliseSetSpec is the
 * door for specs: unknown engines fall back to the default, a start id that
 * is not a UUID is dropped, a beat whose pose does not parse is dropped
 * whole, words are cleaned to the direction limit, and the beat list is cut
 * at the ceiling. Nothing here throws; an unusable value is an empty film.
 */
export function normaliseSetFilm(v: unknown): SetFilm {
  const empty: SetFilm = { engine: SET_TAKE_DEFAULT_ENGINE, startId: null, beats: [], clips: [], ends: [], context: null };
  if (!v || typeof v !== "object") return empty;
  const f = v as Record<string, unknown>;
  const engine = isSetTakeEngine(f.engine) ? f.engine : SET_TAKE_DEFAULT_ENGINE;
  const startId = typeof f.startId === "string" && UUID_RE.test(f.startId) ? f.startId.toLowerCase() : null;
  const beats: FilmBeat[] = [];
  if (Array.isArray(f.beats)) {
    for (const b of f.beats) {
      if (beats.length >= FILM_MAX_BEATS) break;
      if (!b || typeof b !== "object") continue;
      const end = pose((b as Record<string, unknown>).end);
      if (!end) continue;
      const words = cleanText(
        typeof (b as Record<string, unknown>).words === "string" ? ((b as Record<string, unknown>).words as string) : "",
        SET_DIRECTION_MAX_CHARS,
      );
      const raw = b as Record<string, unknown>;
      const move = isFilmMove(raw.move) ? raw.move : null;
      const textures = Array.isArray(raw.textures)
        ? [...new Set(raw.textures.filter((t): t is FilmTexture => isFilmTexture(t)))]
        : [];
      beats.push({ words, end, move, textures });
    }
  }
  const ids = (list: unknown): (string | null)[] =>
    (Array.isArray(list) ? list : [])
      .slice(0, beats.length)
      .map((c) => (typeof c === "string" && UUID_RE.test(c) ? c.toLowerCase() : null));
  const context = typeof f.context === "string" && CONTEXT_RE.test(f.context) ? f.context : null;
  return { engine, startId, beats, clips: ids(f.clips), ends: ids(f.ends), context };
}

const CONTEXT_RE = /^[0-9a-f]{1,16}$/;

/** Two beats as the same beat: every field the take is rendered from. */
function sameBeat(a: FilmBeat, b: FilmBeat): boolean {
  return (
    a.words === b.words &&
    a.move === b.move &&
    a.textures.length === b.textures.length &&
    a.textures.every((t, i) => t === b.textures[i]) &&
    a.end.fovDeg === b.end.fovDeg &&
    a.end.position.every((n, i) => n === b.end.position[i]) &&
    a.end.target.every((n, i) => n === b.end.target[i])
  );
}

/**
 * The film after an edit, keeping only the clips the edit leaves true. A
 * rendered clip belongs to a beat AND to every beat before it — beat n opens
 * on the exact frame beat n-1 closed on — so the first beat that changes ends
 * the run of clips that still show this film, and a different engine or a
 * different opening still ends it at once. Every change to a film goes
 * through here, the way normaliseSetFilm is the door for a stored one.
 */
export function filmAfterEdit(prev: SetFilm, next: SetFilm): SetFilm {
  if (next.engine !== prev.engine || next.startId !== prev.startId) return { ...next, clips: [], ends: [] };
  let kept = 0;
  while (kept < next.beats.length && prev.beats[kept] && sameBeat(prev.beats[kept], next.beats[kept])) kept++;
  return { ...next, clips: prev.clips.slice(0, kept), ends: prev.ends.slice(0, kept) };
}

/**
 * The shots a film stands on, once each: its opening still, the clip each
 * beat rendered as and the still each closed on. The set page loads these
 * whatever their age (set-shots.ts) — the reel plays the clips, the dock
 * shows the opening still, Play the move starts from its camera, and a
 * render that picks up part-way opens on an end still.
 */
export function filmShotIds(film: SetFilm | null): string[] {
  if (!film) return [];
  return [...new Set([film.startId, ...film.clips, ...film.ends].filter((id): id is string => id !== null))];
}

/** Whether every beat of this film has a clip: what the reel needs to play. */
export function filmRendered(film: SetFilm): boolean {
  return film.beats.length > 0 && film.clips.length === film.beats.length && film.clips.every((c) => c !== null);
}

/** How long the film runs: every beat is its engine's one fixed length. */
export function filmSeconds(film: SetFilm): number {
  return film.beats.length * SET_TAKE_ENGINES[film.engine].seconds;
}

// ---------------------------------------------------------------------------
// Rendering only what changed (2026-09-16).
// ---------------------------------------------------------------------------

/** A short, stable key for a long text (cyrb53: 53 bits, not cryptographic — it tells films apart and guards nothing). */
export function textKey(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * What a film is rendered with besides its own move, as one key: who is in
 * it, the rig as it reaches the picture, where the figure stands, and the
 * set (`setKey`, textKey of the drawn spec). Every rig field is named, in a
 * fixed order, so the key never turns on how an object happened to be
 * built; the genre (a suggestion, no words) and the stage's grade (the
 * preview only) never reach the picture and are left out.
 */
export function filmContextKey(input: {
  characterId: string;
  rig: SetRig;
  mark: { x: number; z: number; facingDeg: number };
  setKey: string;
}): string {
  const { rig, mark } = input;
  const light = rig.light ? [rig.light.scheme, rig.light.azimuthDeg, rig.light.elevationDeg] : null;
  return textKey(
    JSON.stringify([
      input.characterId,
      [rig.format, rig.era, rig.stock, rig.lens, rig.stop, rig.palette, light],
      [mark.x, mark.z, mark.facingDeg],
      input.setKey,
    ]),
  );
}

/**
 * Where a render of this film picks up, and the still that beat opens on.
 * Each beat opens on the frame the one before it closed on, so the clips
 * worth keeping are a run from the start: every beat whose clip is still
 * good (a clip rendering counts — it is on its way), stepped back while the
 * beat before has no finished end still to open on. A film rendered under
 * another context starts again from the top. `from` equal to the number of
 * beats means every beat is rendered already.
 */
export function filmRenderFrom(
  film: SetFilm,
  context: string,
  ok: { clip: (id: string) => boolean; end: (id: string) => boolean },
): { from: number; startId: string | null } {
  if (film.context !== context) return { from: 0, startId: film.startId };
  let from = 0;
  while (from < film.beats.length && film.clips[from] && ok.clip(film.clips[from]!)) from++;
  if (from === film.beats.length) return { from, startId: null };
  while (from > 0 && !(film.ends[from - 1] && ok.end(film.ends[from - 1]!))) from--;
  return { from, startId: from === 0 ? film.startId : film.ends[from - 1] };
}

/**
 * What Render does now, from the state of each shot on the page (`stateOf`:
 * a generation's status, or null when the page does not hold it). A clip is
 * good unless it failed or is gone — one still rendering is on its way — and
 * an end still is good only when finished. With every beat rendered the
 * button renders the whole film again, as a new take of it — except while
 * its clips are still rendering (`rendering`), when there is nothing to do
 * but wait: offering it then would pay for the film twice.
 */
export function filmRenderPlan(
  film: SetFilm,
  context: string,
  stateOf: (id: string) => string | null,
): { from: number; startId: string | null; again: boolean; rendering: boolean } {
  const plan = filmRenderFrom(film, context, {
    clip: (id) => {
      const state = stateOf(id);
      return state !== null && state !== "failed";
    },
    end: (id) => stateOf(id) === "succeeded",
  });
  const rendering = film.clips.some((id) => id !== null && stateOf(id) === "generating");
  return plan.from < film.beats.length
    ? { ...plan, again: false, rendering }
    : { from: 0, startId: film.startId, again: true, rendering };
}
