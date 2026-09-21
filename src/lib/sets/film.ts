// The move (Helios Film, 2026-09-15, drawn as canvas page H): a film is a
// START STILL and up to three BEATS. Each beat is one continuous camera
// move — its end framed as a pose on the stage, its life written as words —
// and each beat renders as a take (take.ts): the end frame is shot in the
// set with the previous frame as its look, then the engine's
// start-and-end-frame lane animates the seconds between. Beat n starts on
// the exact frame beat n-1 ended on, so the whole film is one continuous
// shot by construction. Pure and relative-import only, like take.ts: the
// page, the save action and the test all read the same shape.

import type { StandPose, Vec3 } from "./set-spec";
import { cleanText, SET_LIMITS, STAND_POSES } from "./set-spec";
import { RIG_TIME_MAX, RIG_TIME_MIN, RIG_TIME_STEP } from "./rig";
import { SET_DIRECTION_MAX_CHARS } from "./set-config";
import { isSetTakeEngine, SET_TAKE_DEFAULT_ENGINE, SET_TAKE_ENGINES, type SetTakeEngine } from "./take";
import { isFilmMove, isFilmTexture, type FilmMove, type FilmTexture } from "./moves";
import type { SetRig } from "./rig";
import { normaliseRack, type FilmRack } from "./furniture";
import { normaliseGaze, normalisePath, type Gaze, type Path } from "./people";

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
  /** The people track (cut 5): where, and how, the figure stands at the beat's end — its end frame is shot with it there; null keeps the figure where it is. */
  figure: FilmFigure | null;
  /** The sun track (cut 5): the hour at the beat's end (rig.ts RIG_TIME_*); null keeps the rig's. */
  time: number | null;
  /** The rack of focus (cut C, furniture.ts): where the focus travels during the move; null keeps it on the person. */
  rack: FilmRack | null;
  /** The eye-line at the beat's end (cut D, people.ts): where the figure looks in the end frame and by the end of the clip; null says nothing. */
  gaze: Gaze | null;
  /** The path (cut D): the points the figure walks through from where the beat opens to its figure; empty walks straight. */
  path: Path;
};

export type FilmFigure = { x: number; z: number; facingDeg: number; pose: StandPose };

/** Where the figure stands and how the stage is lit at a beat's end. */
export type BeatStage = {
  figure: { x: number; z: number; facingDeg: number };
  pose: StandPose;
  /** The hour the stage draws for this beat; null is the set as built. */
  time: number | null;
  /** The eye-line for the beat's end frame and its clip. */
  gaze: Gaze | null;
};

/**
 * The stage each beat's end frame is shot on, in beat order: one rule for
 * the previz, the render and the path, so what a person watches for free is
 * what a credit buys (found reviewing Helios, 2026-09-17 — the render
 * compared a beat's hour with the RIG's, so a beat whose hour matched it
 * kept whatever the beat before it had drawn, and the end frames were
 * described with the arrangement's figure while the sketch showed the
 * beat's).
 *
 * The tracks fall back as the beats say they do: a beat with no figure
 * keeps the figure where the film left it (the beat before it, else the
 * arrangement), and a beat with no hour takes the rig's, which is what the
 * sun track draws. The eye-line is the beat's own: the arrangement's
 * belongs to Shoot and is not in the film's context, so it would change a
 * beat's frame without the film knowing.
 */
export function filmStages(
  beats: readonly Pick<FilmBeat, "figure" | "time" | "gaze">[],
  arrangement: { mark: { x: number; z: number; facingDeg: number }; pose: StandPose; time: number | null },
): BeatStage[] {
  let figure = { x: arrangement.mark.x, z: arrangement.mark.z, facingDeg: arrangement.mark.facingDeg };
  let pose = arrangement.pose;
  return beats.map((beat) => {
    if (beat.figure) {
      figure = { x: beat.figure.x, z: beat.figure.z, facingDeg: beat.figure.facingDeg };
      pose = beat.figure.pose;
    }
    return { figure, pose, time: beat.time ?? arrangement.time, gaze: beat.gaze };
  });
}

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
  // The floor is the one a saved camera keeps (SET_LIMITS), not a 10 written
  // out here: a beat laid on a 135 mm Super 35 rig is 7.92° and was stored
  // at 10°, which is another lens (2026-09-18).
  return { position, target, fovDeg: Math.min(120, Math.max(SET_LIMITS.minLayoutFovDeg, Math.round(fov * 100) / 100)) };
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
      beats.push({
        words,
        end,
        move,
        textures,
        figure: figureOf(raw.figure),
        time: hourOf(raw.time),
        rack: normaliseRack(raw.rack, Number.MAX_SAFE_INTEGER),
        gaze: normaliseGaze(raw.gaze, Number.MAX_SAFE_INTEGER),
        path: normalisePath(raw.path),
      });
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

const REACH_M = 200;
const figureOf = (v: unknown): FilmFigure | null => {
  if (!v || typeof v !== "object") return null;
  const f = v as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.round(Math.min(REACH_M, Math.max(-REACH_M, x)) * 1000) / 1000 : null);
  const x = n(f.x);
  const z = n(f.z);
  if (x === null || z === null) return null;
  const facing = typeof f.facingDeg === "number" && Number.isFinite(f.facingDeg) ? Math.round((((f.facingDeg % 360) + 360) % 360) * 10) / 10 : 0;
  const pose = typeof f.pose === "string" && (STAND_POSES as readonly string[]).includes(f.pose) ? (f.pose as StandPose) : "stand";
  return { x, z, facingDeg: facing, pose };
};
const hourOf = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(RIG_TIME_MAX, Math.max(RIG_TIME_MIN, v)) / RIG_TIME_STEP) * RIG_TIME_STEP : null;

/** Two beats as the same beat: every field the take is rendered from. */
function sameBeat(a: FilmBeat, b: FilmBeat): boolean {
  return (
    a.words === b.words &&
    a.move === b.move &&
    a.textures.length === b.textures.length &&
    a.textures.every((t, i) => t === b.textures[i]) &&
    a.end.fovDeg === b.end.fovDeg &&
    a.end.position.every((n, i) => n === b.end.position[i]) &&
    a.end.target.every((n, i) => n === b.end.target[i]) &&
    a.time === b.time &&
    JSON.stringify(a.rack) === JSON.stringify(b.rack) &&
    JSON.stringify(a.gaze) === JSON.stringify(b.gaze) &&
    (a.figure === null) === (b.figure === null) &&
    (a.figure === null || (a.figure.x === b.figure!.x && a.figure.z === b.figure!.z && a.figure.facingDeg === b.figure!.facingDeg && a.figure.pose === b.figure!.pose))
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
  /** The figure's pose (cut 5); standing leaves the key as it was, so films made before the poses keep their clips. */
  pose?: StandPose;
  /**
   * The film's one look when it is not its opening still (2026-09-21): a
   * reference photo ("ref:<id>") or another still ("still:<id>") picked in
   * the Look menu. The opening still, the default, leaves the key as it was.
   */
  look?: string;
}): string {
  const { rig, mark } = input;
  const light = rig.light ? [rig.light.scheme, rig.light.azimuthDeg, rig.light.elevationDeg] : null;
  return textKey(
    JSON.stringify([
      input.characterId,
      [rig.format, rig.era, rig.stock, rig.lens, rig.stop, rig.palette, light],
      // The camera department (cut 2): the body, the squeeze and the exposure
      // are in the sketch; the viewfinder's aids never are.
      [rig.sensor, rig.squeeze, rig.shutterDeg, rig.iso, rig.ev],
      // The iris's blades (cut C): words in the still's focus sentence.
      rig.blades,
      // The light department (cut 3): the hour moves the sun in the sketch.
      rig.time,
      [mark.x, mark.z, mark.facingDeg],
      input.setKey,
      ...(input.pose && input.pose !== "stand" ? [input.pose] : []),
      ...(input.look ? [`look ${input.look}`] : []),
    ]),
  );
}

/**
 * One beat of a render. `end` null: the beat renders whole — a new end still,
 * then its clip. `end` a still: the beat's end still is finished, so only its
 * clip renders again, ending on that still, and nothing is shot.
 */
export type FilmJob = { beat: number; end: string | null };

/** What a render's jobs are, to price: a clip each, and a new end still for each beat rendered whole (take.ts takesCredits). */
export function filmJobCount(jobs: readonly FilmJob[]): { clips: number; stills: number } {
  return { clips: jobs.length, stills: jobs.filter((job) => job.end === null).length };
}

/**
 * What a render of this film must do. Each beat opens on the still the one
 * before it closed on, so a beat whose clip is gone but whose end still is
 * finished renders its clip alone — the beats after it open on that same
 * still and keep theirs. A beat that needs a new end still renders whole,
 * and so does every beat after it: a new end still is a new opening for the
 * next. A beat that cannot open — the still before it is gone — starts the
 * whole run one beat earlier. A clip still rendering counts as good (it is
 * on its way); a film rendered under another context renders whole from the
 * top. No jobs means every beat is rendered.
 */
export function filmJobs(
  film: SetFilm,
  context: string,
  ok: { clip: (id: string) => boolean; end: (id: string) => boolean },
): FilmJob[] {
  const n = film.beats.length;
  const whole = (from: number): FilmJob[] => Array.from({ length: n - from }, (_, k) => ({ beat: from + k, end: null }));
  if (film.context !== context) return whole(0);
  // Beat -1's end is the film's opening still, which the page checks itself.
  const endOk = (i: number) => {
    if (i < 0) return true;
    const id = film.ends[i];
    return Boolean(id) && ok.end(id!);
  };
  const jobs: FilmJob[] = [];
  for (let i = 0; i < n; i++) {
    const clip = film.clips[i];
    if (clip && ok.clip(clip)) continue;
    if (endOk(i - 1) && endOk(i)) {
      jobs.push({ beat: i, end: film.ends[i]! });
      continue;
    }
    let from = i;
    while (!endOk(from - 1)) from--;
    return [...jobs.filter((j) => j.beat < from), ...whole(from)];
  }
  return jobs;
}

/**
 * What Render does now, from the state of each shot on the page (`stateOf`:
 * a generation's status, or null when the page does not hold it). A clip is
 * good unless it failed or is gone, an end still only once it is finished.
 * With nothing to render, the button renders the whole film again as a new
 * take of it — except while its clips are still rendering (`rendering`),
 * when there is nothing to do but wait: offering it then would pay for the
 * film twice.
 */
export function filmRenderPlan(
  film: SetFilm,
  context: string,
  stateOf: (id: string) => string | null,
): { jobs: FilmJob[]; again: boolean; rendering: boolean } {
  const jobs = filmJobs(film, context, {
    clip: (id) => {
      const state = stateOf(id);
      return state !== null && state !== "failed";
    },
    end: (id) => stateOf(id) === "succeeded",
  });
  const rendering = film.clips.some((id) => id !== null && stateOf(id) === "generating");
  return jobs.length > 0
    ? { jobs, again: false, rendering }
    : { jobs: film.beats.map((_, beat) => ({ beat, end: null })), again: true, rendering };
}
