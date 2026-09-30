// How the lamp moves (2026-09-25, operator: "the animation when sticking to
// the sides looks cheap. Try to make it look premium"; redrawn 2026-09-30,
// operator: "The light bulb and how it sticks in the corner, the animation
// feels cheap", and he picked "A · Tuck" from the draft). Pure, no DOM.
//
// What was still cheap, measured frame by frame in slow motion: landing on an
// edge, the light went out at contact, the round lamp squashed into a capsule,
// and an empty outlined pill sat on the edge for most of the landing before a
// faint tube lit. The flights animated left/top/width/height/border-radius,
// which the browser redraws on the main thread, so a busy page stuttered them.
//
// Now the lamp never changes shape. It only moves (the translate property, so
// the compositor plays a flight even while the page is busy), and at an edge
// it slides half behind it with its light still on. Every move is springs
// sampled at 60 Hz into keyframes, all on one clock: the position, started
// with the finger's own speed but capped by the distance left, so it sinks a
// few px past its place at most; the lift settling; the light inside lagging
// the glass a little and swinging back; the light keeping to the part of the
// lamp still on the screen. Apple's response/damping pair names each spring.

import { RADIUS, lensFor, overEdge, type Point, type Stage } from "./lamp-place";

export const FRAME_MS = 1000 / 60;

export type Spring = {
  /** Seconds for one undamped swing: how quick it feels. */
  response: number;
  /** 1 = no overshoot; lower settles with a small give. */
  damping: number;
};

/** To a corner, home, or a spot in open space. */
export const FLY: Spring = { response: 0.44, damping: 0.78 };
/** Into an edge: a touch slower, sinking a few px past its place before it rests. */
export const TUCK: Spring = { response: 0.5, damping: 0.88 };
/** Home, when the sheet opens. */
export const HOME: Spring = { response: 0.42, damping: 0.84 };
/** A tucked lamp coming out a little under a mouse, and going back. */
export const PEEK_SPRING: Spring = { response: 0.3, damping: 0.78 };
/** Lifted in the hand (1), pressed (below 0), set down (0). */
export const LIFT: Spring = { response: 0.26, damping: 0.72 };
/** The light inside lagging the glass, and swinging back. */
export const SLOSH: Spring = { response: 0.34, damping: 0.42 };

/** One step of a spring (semi-implicit Euler, 4 ms substeps). */
export function stepSpring(p: number, v: number, target: number, dt: number, spring: Spring): [number, number] {
  const k = ((2 * Math.PI) / spring.response) ** 2;
  const c = (4 * Math.PI * spring.damping) / spring.response;
  const n = Math.max(1, Math.ceil(dt / 0.004));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    v += (-k * (p - target) - c * v) * h;
    p += v * h;
  }
  return [p, v];
}

/**
 * The speed a flight may start with toward a target `d` px away: the throw's
 * own, but never more than the spring can take without running far past it.
 */
export function capToward(v: number, d: number, spring: Spring): number {
  if (d === 0 || Math.sign(v) !== Math.sign(d)) return v;
  const w = (2 * Math.PI) / spring.response;
  return Math.sign(v) * Math.min(Math.abs(v), 0.9 * w * Math.abs(d), 2000);
}

/** Everything that moves: the centre and its speed, the lift, the light's lag. */
export type Motion = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  lift: number;
  liftV: number;
  slx: number;
  sly: number;
  slvx: number;
  slvy: number;
};

export function still(p: Point, lift = 0): Motion {
  return { x: p.x, y: p.y, vx: 0, vy: 0, lift, liftV: 0, slx: 0, sly: 0, slvx: 0, slvy: 0 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Where the light lags to at this speed: a little behind the move. */
export function sloshTarget(vx: number, vy: number): Point {
  return { x: clamp(-vx * 0.0026, -4.5, 4.5), y: clamp(-vy * 0.0026, -4.5, 4.5) };
}

/** Moves the lift toward `lift` and the light toward its lag for the current speed. */
export function settleParts(m: Motion, dt: number, lift: number): void {
  [m.lift, m.liftV] = stepSpring(m.lift, m.liftV, lift, dt, LIFT);
  const s = sloshTarget(m.vx, m.vy);
  [m.slx, m.slvx] = stepSpring(m.slx, m.slvx, s.x, dt, SLOSH);
  [m.sly, m.slvy] = stepSpring(m.sly, m.slvy, s.y, dt, SLOSH);
}

function atRest(m: Motion, to: Point, lift: number): boolean {
  return (
    Math.abs(m.x - to.x) < 0.15 &&
    Math.abs(m.y - to.y) < 0.15 &&
    Math.abs(m.vx) < 4 &&
    Math.abs(m.vy) < 4 &&
    Math.abs(m.lift - lift) < 0.003 &&
    Math.abs(m.liftV) < 0.05 &&
    Math.abs(m.slx) < 0.05 &&
    Math.abs(m.sly) < 0.05 &&
    Math.abs(m.slvx) < 0.5 &&
    Math.abs(m.slvy) < 0.5
  );
}

/**
 * A flight from `from` to `to`, one sample per frame at 60 Hz, ending at rest
 * exactly there. The throw's speed carries over, capped by the distance left.
 */
export function flight(from: Motion, to: Point, spring: Spring, lift = 0, maxSeconds = 1.4): Motion[] {
  const m: Motion = { ...from };
  m.vx = capToward(m.vx, to.x - m.x, spring);
  m.vy = capToward(m.vy, to.y - m.y, spring);
  const out: Motion[] = [{ ...m }];
  const dt = FRAME_MS / 1000;
  for (let i = 1; i * dt <= maxSeconds; i++) {
    [m.x, m.vx] = stepSpring(m.x, m.vx, to.x, dt, spring);
    [m.y, m.vy] = stepSpring(m.y, m.vy, to.y, dt, spring);
    settleParts(m, dt, lift);
    out.push({ ...m });
    if (atRest(m, to, lift)) break;
  }
  out[out.length - 1] = { ...still(to, lift) };
  return out;
}

/**
 * Pointer samples → speed (px/s) over the last `window` ms before the
 * release; 0 when the finger had stopped before letting go (it threw nothing).
 */
export function velocityOf(
  samples: { t: number; x: number; y: number }[],
  releasedAt: number,
  window = 90,
): { vx: number; vy: number } {
  if (samples.length < 2) return { vx: 0, vy: 0 };
  const last = samples[samples.length - 1];
  if (releasedAt - last.t > 60) return { vx: 0, vy: 0 };
  let first = last;
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t > window) break;
    first = samples[i];
  }
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0.008) return { vx: 0, vy: 0 };
  // Capped: a stray sample must not fling the lamp across a screen.
  const cap = (v: number) => clamp(v, -4200, 4200);
  return { vx: cap((last.x - first.x) / dt), vy: cap((last.y - first.y) / dt) };
}

/**
 * How the lamp is drawn in a moment of motion, as CSS values: where it is
 * (translate), its lift and its stretch along a fast move (the inner part's
 * transform), where its light sits (in the part still on the screen, lagging
 * a little), and how much of its glass, shadow and reflection shows.
 * `angle` is the stretch's direction (radians); pass the previous one to keep
 * a run of frames from spinning when the direction wraps round.
 */
export type Pose = {
  translate: string;
  inner: string;
  angle: number;
  lightTranslate: string;
  lightScale: string;
  gloss: number;
  shadowRest: number;
  shadowLifted: number;
  poolTranslate: string;
};

export function poseOf(m: Motion, s: Stage, prevAngle?: number): Pose {
  const { edge, over } = overEdge(m.x, m.y, s);
  const lens = lensFor(edge, over);
  const speed = Math.hypot(m.vx, m.vy);
  const q = Math.min(0.065, speed / 16000);
  // A stretch along a direction is the same as along its opposite, so the
  // angle lives in a half turn, kept next to the previous frame's.
  let angle = speed > 1 ? Math.atan2(m.vy, m.vx) : (prevAngle ?? 0);
  if (prevAngle !== undefined) {
    while (angle - prevAngle > Math.PI / 2) angle -= Math.PI;
    while (angle - prevAngle < -Math.PI / 2) angle += Math.PI;
  }
  const k = 1 + 0.07 * m.lift;
  const lifted = clamp(m.lift, 0, 1);
  const f = (n: number) => n.toFixed(2);
  return {
    // The lamp is fixed at the screen's top-left corner and moved from there.
    translate: `${f(m.x - RADIUS)}px ${f(m.y - RADIUS)}px`,
    inner: `rotate(${angle.toFixed(4)}rad) scale(${(k * (1 + q)).toFixed(4)}, ${(k * (1 - q)).toFixed(4)}) rotate(${(-angle).toFixed(4)}rad)`,
    angle,
    lightTranslate: `${f(lens.x + m.slx)}px ${f(lens.y + m.sly)}px`,
    lightScale: lens.scale.toFixed(4),
    gloss: Number(smoothstep(lens.vis * 1.6 - 0.5).toFixed(3)),
    shadowRest: Number(((1 - lifted) * lens.vis).toFixed(3)),
    shadowLifted: Number((lifted * lens.vis).toFixed(3)),
    poolTranslate: `${f(lens.x * 1.4)}px ${f(lens.y * 1.4)}px`,
  };
}

function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/** A flight's frames as keyframes for each part, and the frame its rim first crosses a side. */
export type FlightFrames = {
  lamp: Keyframe[];
  inner: Keyframe[];
  light: Keyframe[];
  gloss: Keyframe[];
  shadowRest: Keyframe[];
  shadowLifted: Keyframe[];
  pool: Keyframe[];
  /** When its rim first crosses a side of the stage (ms), or -1. */
  contactMs: number;
  durationMs: number;
};

export function flightFrames(samples: Motion[], s: Stage): FlightFrames {
  const out: FlightFrames = {
    lamp: [],
    inner: [],
    light: [],
    gloss: [],
    shadowRest: [],
    shadowLifted: [],
    pool: [],
    contactMs: -1,
    durationMs: Math.max(FRAME_MS, (samples.length - 1) * FRAME_MS),
  };
  let angle: number | undefined;
  samples.forEach((m, i) => {
    const p = poseOf(m, s, angle);
    angle = p.angle;
    out.lamp.push({ translate: p.translate });
    out.inner.push({ transform: p.inner });
    out.light.push({ translate: p.lightTranslate, scale: p.lightScale });
    out.gloss.push({ opacity: p.gloss });
    out.shadowRest.push({ opacity: p.shadowRest });
    out.shadowLifted.push({ opacity: p.shadowLifted });
    out.pool.push({ translate: p.poolTranslate });
    if (out.contactMs < 0 && i > 0 && overEdge(m.x, m.y, s).over > 0.5 && overEdge(samples[0].x, samples[0].y, s).over <= 0.5) {
      out.contactMs = i * FRAME_MS;
    }
  });
  if (samples.length === 1) {
    for (const k of [out.lamp, out.inner, out.light, out.gloss, out.shadowRest, out.shadowLifted, out.pool]) k.push({ ...k[0] });
  }
  return out;
}

/** The motion a flight has reached `ms` into it (for picking a lamp up mid-flight). */
export function sampleAt(samples: Motion[], ms: number): Motion {
  const i = clamp(Math.round(ms / FRAME_MS), 0, samples.length - 1);
  return { ...samples[i] };
}
