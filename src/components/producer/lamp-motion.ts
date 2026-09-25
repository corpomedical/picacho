// How the lamp moves (2026-09-25, operator: "the animation when sticking to
// the sides looks cheap. Try to make it look premium"). Pure, no DOM.
//
// What was cheap, measured (see the commit): about seven easings on eleven
// timers; a fixed cubic-bezier "spring" that overshot 6.6% of any trip (90 px
// off-screen on a long one) and ignored the finger's speed; the size a beat
// behind the position, so the round lamp ran 13-17 px into the wall before it
// thinned; corners that stayed round until the last 40 ms (9999px → 14px);
// the light blacked out for 320 ms and popped back from 55%; and a flash that
// lit before the lamp arrived.
//
// Now there is ONE clock, sampled into keyframes. Real springs (Apple's
// response/damping pair; the stiffnesses are Material 3's Standard tokens,
// damped 100% as Apple's fluid-interface talk says to start): GLIDE carries
// the lamp with the finger's own speed, never past its target; MORPH changes
// its shape. A landing glides round toward the wall, and only when its rim
// is close does it flatten into the tab, its wall side pinned to the wall —
// the flattening is the "squash", there is no bounce. The corners are
// interpolated so the short side's two radii always add up to its width,
// so the browser never rescales them (that rescaling was the 40 ms snap).
// The landing's moments (contact, when the old light should be out and the
// new one in) come from the same samples, so every effect keeps that clock.

export type Box = { left: number; top: number; width: number; height: number };
export type Edge = "left" | "right" | "top" | "bottom";
/** Corner radii, top-left, top-right, bottom-right, bottom-left (px). */
export type Corners = [number, number, number, number];

/** A frame of the flight: where the lamp is and how round its corners are. */
export type Frame = Box & { corners: Corners; offset: number };

export type Spring = {
  /** Seconds for one undamped swing: how quick it feels. */
  response: number;
  /** 1 = no overshoot; lower bounces. */
  damping: number;
};

const responseOf = (stiffness: number) => (2 * Math.PI) / Math.sqrt(stiffness);
/** Position: toward the wall, home, or a free landing (k 300, no overshoot). */
export const GLIDE: Spring = { response: responseOf(300), damping: 1 };
/** Shape and size: round ⇄ tab (k 700, no overshoot). */
export const MORPH: Spring = { response: responseOf(700), damping: 1 };
/** A calm move with nothing thrown at it (a flight home, a drop in open space). */
export const SETTLE: Spring = GLIDE;
/** Swelling from a tab into the round lamp under the finger. */
export const SWELL: Spring = MORPH;
/** The round lamp starts to flatten when its rim is this close to the wall (px). */
export const CONTACT_GAP = 16;

/**
 * The fastest a spring may start (in trips per second) and still not pass
 * its target: a critically damped spring started faster than its own
 * frequency crosses the target — here, the wall.
 */
export function maxStartVelocity(spring: Spring): number {
  return ((2 * Math.PI) / spring.response) * 0.95;
}

/**
 * Samples a spring from 0 to 1, starting at `velocity` (in distances per
 * second: 2 means it starts moving twice the trip each second), every `step`
 * seconds, until it is at rest. Semi-implicit Euler at 1 ms is exact enough
 * for a few hundred milliseconds of motion.
 */
export function sampleSpring(spring: Spring, velocity = 0, step = 1 / 60, maxSeconds = 1.2): number[] {
  const stiffness = (2 * Math.PI / spring.response) ** 2;
  const friction = (4 * Math.PI * spring.damping) / spring.response;
  const out = [0];
  let x = 0;
  let v = velocity;
  const dt = 0.001;
  const perStep = Math.max(1, Math.round(step / dt));
  for (let i = 1; i * step <= maxSeconds; i++) {
    for (let j = 0; j < perStep; j++) {
      const a = -stiffness * (x - 1) - friction * v;
      v += a * dt;
      x += v * dt;
    }
    out.push(x);
    if (Math.abs(1 - x) < 0.0015 && Math.abs(v) < 0.02) break;
  }
  out[out.length - 1] = 1;
  return out;
}

/**
 * Where a throw would come to rest (Apple, "Designing Fluid Interfaces",
 * WWDC 2018: project the momentum with the scroll view's normal
 * deceleration). Velocity in px/s.
 */
export function project(position: number, velocity: number, deceleration = 0.998): number {
  return position + ((velocity / 1000) * deceleration) / (1 - deceleration);
}

/**
 * Pointer samples → velocity (px/s) over the last `window` ms before the
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
  const cap = (v: number) => Math.max(-4000, Math.min(4000, v));
  return { vx: cap((last.x - first.x) / dt), vy: cap((last.y - first.y) / dt) };
}

/** The round lamp's corners, and a tab's (rounded on the page's side only). */
export function cornersFor(box: Box, edge: Edge | null): Corners {
  if (!edge) {
    const r = Math.min(box.width, box.height) / 2;
    return [r, r, r, r];
  }
  const r = edge === "left" || edge === "right" ? box.width : box.height;
  if (edge === "right") return [r, 0, 0, r];
  if (edge === "left") return [0, r, r, 0];
  if (edge === "top") return [0, 0, r, r];
  return [r, r, 0, 0];
}

const mix = (a: number, b: number, p: number) => a + (b - a) * p;
const at = (a: number[], i: number) => (i < a.length ? a[i] : 1);

function pin(b: Box, wall: { edge: Edge; at: number } | null): Box {
  if (!wall) return b;
  const r = { ...b };
  if (wall.edge === "right" && r.left + r.width > wall.at) r.left = wall.at - r.width;
  if (wall.edge === "left" && r.left < wall.at) r.left = wall.at;
  if (wall.edge === "bottom" && r.top + r.height > wall.at) r.top = wall.at - r.height;
  if (wall.edge === "top" && r.top < wall.at) r.top = wall.at;
  return r;
}

/**
 * The flight from one shape and place to another, one frame per sample.
 * `move` drives the centre, `shape` the size and corners (they may be the
 * same progress, or the shape may start later: see landing). When `wall` is
 * set, the lamp never passes it — its wall side stays pinned there.
 */
export function flight(
  from: Box,
  fromCorners: Corners,
  to: Box,
  toCorners: Corners,
  move: number[],
  shape: number[] = move,
  wall: { edge: Edge; at: number } | null = null,
): Frame[] {
  const fcx = from.left + from.width / 2;
  const fcy = from.top + from.height / 2;
  const tcx = to.left + to.width / 2;
  const tcy = to.top + to.height / 2;
  const n = Math.max(move.length, shape.length);
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) {
    const p = at(move, i);
    const m = Math.min(1, Math.max(0, at(shape, i)));
    const width = mix(from.width, to.width, m);
    const height = mix(from.height, to.height, m);
    const cx = mix(fcx, tcx, p);
    const cy = mix(fcy, tcy, p);
    const b = pin({ left: cx - width / 2, top: cy - height / 2, width, height }, wall);
    frames.push({ ...b, corners: fromCorners.map((c, k) => mix(c, toCorners[k], m)) as Corners, offset: 0 });
  }
  return frames;
}

/**
 * A landing on an edge: it glides with the throw (never faster than lands
 * without crossing the wall), stays round until its rim is CONTACT_GAP from
 * the wall, then flattens into the tab with its wall side pinned. Returns
 * the frames and the moments the light and glow are timed by (ms).
 */
export function landing(
  from: Box,
  to: Box,
  edge: Edge,
  wallAt: number,
  velocity: number,
): { frames: Frame[]; contactMs: number; shapedMs: number } {
  const move = sampleSpring(GLIDE, Math.min(velocity, maxStartVelocity(GLIDE)));
  const fcx = from.left + from.width / 2;
  const fcy = from.top + from.height / 2;
  const tcx = to.left + to.width / 2;
  const tcy = to.top + to.height / 2;
  const rimGap = (p: number) => {
    const cx = mix(fcx, tcx, p);
    const cy = mix(fcy, tcy, p);
    if (edge === "right") return wallAt - (cx + from.width / 2);
    if (edge === "left") return cx - from.width / 2 - wallAt;
    if (edge === "bottom") return wallAt - (cy + from.height / 2);
    return cy - from.height / 2 - wallAt;
  };
  let ic = move.findIndex((p) => rimGap(p) <= CONTACT_GAP);
  if (ic < 0) ic = move.length - 1;
  const morph = sampleSpring(MORPH);
  const shape = [...new Array(ic).fill(0), ...morph];
  const frames = flight(from, cornersFor(from, null), to, cornersFor(to, edge), move, shape, { edge, at: wallAt });
  const shapedIdx = ic + Math.max(0, morph.findIndex((m) => m >= 0.6));
  return { frames, contactMs: ic * (1000 / 60), shapedMs: shapedIdx * (1000 / 60) };
}

/** The first sample at or after progress `p` (for timing the light and the glow). */
export function timeAt(progress: number[], p: number, step = 1 / 60): number {
  const i = progress.findIndex((x) => x >= p);
  return (i < 0 ? progress.length - 1 : i) * step * 1000;
}

/** Keyframes the Web Animations API takes, from frames. */
export function keyframes(frames: Frame[]): Keyframe[] {
  return frames.map((f) => ({
    left: `${f.left.toFixed(2)}px`,
    top: `${f.top.toFixed(2)}px`,
    width: `${f.width.toFixed(2)}px`,
    height: `${f.height.toFixed(2)}px`,
    borderRadius: f.corners.map((c) => `${c.toFixed(2)}px`).join(" "),
  }));
}

/**
 * The pull of a nearby edge while dragging, continuous with distance (it was
 * a switch): 0 far away, 1 touching. Squared, so it is felt only close in.
 */
export function pullOf(gap: number, zone: number): number {
  if (gap >= zone) return 0;
  const k = 1 - Math.max(0, gap) / zone;
  return k * k;
}
