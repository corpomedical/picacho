// The look "Two fireflies" (2026-09-25, operator: "I like Two fireflies"),
// redrawn for the glass lamp he picked on 2026-09-30 ("A · Tuck"): two warm
// lights inside the glass, the small one dancing round the big one. They
// drift on a few slow waves that never quite repeat instead of running round
// a fixed path, and each mood is a set of numbers the lights ease toward, so
// a change of mood never makes them jump. Pure: positions and brightness for
// a moment; fireflies-light.tsx draws them.

import type { LampMood } from "./lamp-look";

export type FireflyParams = {
  /** How far the big light wanders from the middle (1 = about 5 px). */
  drift: number;
  /** How far the small one circles round the big one (px). */
  orbit: number;
  /** How fast it circles (radians a second). */
  spin: number;
  /** How bright both are (1 = at rest). */
  bright: number;
  /** 1: the two chase each other round a small circle (thinking). */
  chase: number;
};

export const FIREFLY_MOODS: Record<LampMood, FireflyParams> = {
  idle: { drift: 1, orbit: 7, spin: 1.5, bright: 1, chase: 0 },
  listening: { drift: 0.3, orbit: 4.4, spin: 1.1, bright: 1.24, chase: 0 },
  talking: { drift: 0.8, orbit: 6.2, spin: 3.8, bright: 1.12, chase: 0 },
  thinking: { drift: 0.15, orbit: 6.6, spin: 7.6, bright: 0.86, chase: 1 },
};

/** The circle the two chase round while thinking (px). */
export const CHASE_RADIUS = 6.4;
/** How many past positions each light leaves as its trail (at 60 a second). */
export const TRAIL = 7;

export type Fireflies = {
  p: FireflyParams;
  /** Seconds of motion so far. */
  t: number;
  /** Where the small light is on its circle (radians). */
  th: number;
  /** The voice's loudness as the lights show it (0..1). */
  level: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  trailA: [number, number][];
  trailB: [number, number][];
  acc: number;
  /** The loudness last handed in, and how long ago it last changed (s). */
  lastGlow: number;
  sinceChange: number;
};

export function newFireflies(mood: LampMood): Fireflies {
  const f: Fireflies = {
    p: { ...FIREFLY_MOODS[mood] },
    t: 0,
    th: 0.6,
    level: 0,
    ax: 0,
    ay: 0,
    bx: 0,
    by: 0,
    trailA: [],
    trailB: [],
    acc: 0,
    lastGlow: 0,
    sinceChange: 99,
  };
  stepFireflies(f, 0, mood, 0);
  return f;
}

/** A talking voice's rise and fall, for a lamp told only that it talks (no meter). */
export function syllables(t: number): number {
  const syll = 0.5 + 0.5 * Math.sin(t * 9.3);
  const phrase = 0.5 + 0.5 * Math.sin(t * 1.9 + 0.7);
  return Math.min(1, Math.max(0, 0.12 + 0.8 * syll * (0.35 + 0.65 * phrase) + 0.08 * Math.sin(t * 23.1)));
}

/**
 * Moves the lights on by `dt` seconds in a mood. `glow` is the lamp's voice
 * level: a metered voice changes it all the time and is shown as it is; a
 * steady value while talking (read aloud without a meter) gets a speaking
 * rhythm of its own at that strength.
 */
export function stepFireflies(f: Fireflies, dt: number, mood: LampMood, glow: number): void {
  const m = FIREFLY_MOODS[mood];
  const k = 1 - Math.exp(-dt / 0.32);
  for (const key of Object.keys(m) as (keyof FireflyParams)[]) f.p[key] += (m[key] - f.p[key]) * k;
  if (Math.abs(glow - f.lastGlow) > 0.002) f.sinceChange = 0;
  else f.sinceChange += dt;
  f.lastGlow = glow;
  const metered = f.sinceChange < 0.3;
  const want = metered ? glow : mood === "talking" ? Math.max(glow, 0.55) * syllables(f.t) : 0;
  f.level += (want - f.level) * (1 - Math.exp(-dt / 0.05));
  f.t += dt;
  const t = f.t;
  const p = f.p;
  // The big light wanders on two slow waves a side.
  const ax = p.drift * (3.3 * Math.sin(t * 0.83 + 0.4) + 1.8 * Math.sin(t * 1.37 + 2.1));
  const ay = p.drift * (2.9 * Math.sin(t * 0.71 + 1.3) + 1.5 * Math.sin(t * 1.53 + 0.2));
  // The small one circles it, a little faster and slower by turns.
  f.th += p.spin * (1 + 0.28 * Math.sin(t * 0.61)) * dt;
  const orb = p.orbit * (1 + 0.16 * Math.sin(t * 0.93)) * (1 + 0.22 * f.level);
  const bx = ax + orb * Math.cos(f.th);
  const by = ay + orb * 0.72 * Math.sin(f.th);
  const c = p.chase;
  f.ax = ax + (CHASE_RADIUS * Math.cos(f.th) - ax) * c;
  f.ay = ay + (CHASE_RADIUS * Math.sin(f.th) - ay) * c;
  f.bx = bx + (CHASE_RADIUS * Math.cos(f.th + Math.PI) - bx) * c;
  f.by = by + (CHASE_RADIUS * Math.sin(f.th + Math.PI) - by) * c;
  // Their trails: where they were, 60 times a second of motion.
  if (f.trailA.length === 0) {
    f.trailA.push([f.ax, f.ay]);
    f.trailB.push([f.bx, f.by]);
  }
  f.acc += dt;
  while (f.acc >= 1 / 60) {
    f.acc -= 1 / 60;
    f.trailA.unshift([f.ax, f.ay]);
    f.trailB.unshift([f.bx, f.by]);
    if (f.trailA.length > TRAIL) {
      f.trailA.pop();
      f.trailB.pop();
    }
  }
}

/** How bright the lights are now (their mood, the voice, a faint flicker). */
export function brightness(f: Fireflies, hover = 0): number {
  const flicker = 0.93 + 0.07 * Math.sin(f.t * 2.3) * Math.sin(f.t * 3.7 + 1);
  return f.p.bright * (1 + 0.38 * f.level) * (1 + 0.16 * hover) * flicker;
}
