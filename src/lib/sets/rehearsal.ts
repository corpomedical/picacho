// The rehearsal (2026-09-23, "I want Helios to work the same way"): the
// film's own flight, recorded off the stage as a clip — the camera on each
// beat's move, the figure walking its path, the things that move driving
// theirs. It is the grey mock in motion, and it is what a re-shoot engine
// is given as the shot's motion (a competitor's Blender pass, made here).
//
// Nothing here draws or encodes: it only says WHICH frames to render and
// how far through its beat each one is, so the recording is the same on any
// machine — a clock-driven previz is not (set-view.tsx tweenPose flies by
// performance.now()).

/**
 * What the browser may record a rehearsal into, best first. An engine takes
 * MP4 (recast.ts recastContainerOf takes video/mp4 and video/quicktime
 * only), so a WebM recording can be watched and downloaded but has to be
 * remade before it can be sent.
 */
export const REHEARSAL_MIMES = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"] as const;
/** What the recording is encoded at: a blockout is flat colour, and 8 Mbit/s keeps its edges clean. */
export const REHEARSAL_BITRATE = 8_000_000;

/**
 * The longest edge a rehearsal is recorded at. The clip is the shot's
 * movement, not its picture — the engine re-shoots every pixel from the
 * set's own sheets — and a frame drawn at the stage's full width costs so
 * much to draw and encode that half of them never reach the file.
 */
export const REHEARSAL_MAX_EDGE = 1024;

/** Frames a second. 24 is the film rate every engine we send to reads. */
export const REHEARSAL_FPS = 24;
/** The most a rehearsal may run: the engines that hold a clip's motion take 15 s (recast.ts). */
export const REHEARSAL_MAX_SECONDS = 15;

/**
 * The previz's own easing (set-view.tsx tweenPose), kept here so a recorded
 * frame lands exactly where the played one does: slow out of the first
 * frame, slow into the last.
 */
export function easeFlight(k: number): number {
  const t = Math.min(1, Math.max(0, k));
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/** One frame of the recording: which beat it belongs to, and how far through that beat's move it is. */
export type FlightStep = {
  /** The beat's index. */
  beat: number;
  /** The eased share of the beat's move, 0 at its first frame and 1 at its last. */
  e: number;
  /** Its time from the first frame, in seconds. */
  t: number;
  /** The first frame of a beat: the stage redraws the hour and the figure's pose here, as the previz does. */
  opens: boolean;
  /** The last frame of a beat: the figure lands on the beat's mark. */
  closes: boolean;
};

/**
 * Every frame of a rehearsal, in order. Each beat gets `secondsPerBeat` of
 * picture — the length its clip will be — so the recording runs as long as
 * the film says it does (film.ts filmSeconds), and the engine is handed
 * motion at the pace it will deliver.
 */
export function flightSteps(beats: number, secondsPerBeat: number, fps: number = REHEARSAL_FPS): FlightStep[] {
  const perBeat = Math.max(1, Math.round(secondsPerBeat * fps));
  const steps: FlightStep[] = [];
  const whole = Math.max(0, Math.floor(beats));
  for (let b = 0; b < whole; b++) {
    for (let i = 0; i < perBeat; i++) {
      steps.push({
        beat: b,
        e: easeFlight(perBeat === 1 ? 1 : i / (perBeat - 1)),
        t: (b * perBeat + i) / fps,
        opens: i === 0,
        closes: i === perBeat - 1,
      });
    }
  }
  return steps;
}

/**
 * The size a frame this shape is recorded at: the film's own shape, its
 * longest edge no longer than REHEARSAL_MAX_EDGE, both edges even (H.264
 * refuses an odd one, and every engine we send a clip to reads H.264).
 */
export function recordSize(width: number, height: number): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const long = Math.max(width, height);
  const k = long > REHEARSAL_MAX_EDGE ? REHEARSAL_MAX_EDGE / long : 1;
  return { width: even(width * k), height: even(height * k) };
}

/**
 * The clip's weight, for the line that says it is ready. Its frame count
 * would not be true: a browser hands the recorder every frame but encodes
 * only those it can keep up with, and the file is what will be sent.
 */
export function clipSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** How long a rehearsal of this many beats runs, in seconds. */
export function rehearsalSeconds(beats: number, secondsPerBeat: number): number {
  return Math.max(0, Math.floor(beats)) * secondsPerBeat;
}

/**
 * Whether a rehearsal of this length can be re-shot in one piece, and what
 * to say when it cannot: the engines that keep a clip's motion take 15 s.
 */
export function rehearsalFits(seconds: number): boolean {
  return seconds > 0 && seconds <= REHEARSAL_MAX_SECONDS;
}
