import { describe, expect, it } from "vitest";
import {
  FLY,
  FRAME_MS,
  TUCK,
  capToward,
  flight,
  flightFrames,
  poseOf,
  sampleAt,
  still,
  stepSpring,
  velocityOf,
  type Motion,
} from "./lamp-motion";
import { PEEK, RADIUS, dockCentre, tuckableSides, type Stage } from "./lamp-place";

const STAGE: Stage = { left: 0, top: 0, right: 1440, bottom: 900 };
const SIDES = tuckableSides(STAGE, 1440, 900);
const thrown = (x: number, y: number, vx: number, vy: number): Motion => ({ ...still({ x, y }), vx, vy, lift: 1 });

describe("the springs", () => {
  it("come to rest where they are sent", () => {
    let p = 0;
    let v = 0;
    for (let i = 0; i < 120; i++) [p, v] = stepSpring(p, v, 100, 1 / 60, FLY);
    expect(p).toBeCloseTo(100, 1);
    expect(Math.abs(v)).toBeLessThan(0.5);
  });

  it("cap a throw's speed toward the place by the distance left, and leave a speed away from it alone", () => {
    expect(capToward(3000, 20, TUCK)).toBeLessThan(3000);
    expect(capToward(3000, 20, TUCK)).toBeCloseTo(0.9 * ((2 * Math.PI) / TUCK.response) * 20, 5);
    expect(capToward(500, 800, FLY)).toBe(500);
    expect(capToward(-900, 40, FLY)).toBe(-900);
    expect(capToward(9000, 5000, FLY)).toBe(2000);
  });
});

describe("a flight", () => {
  it("ends exactly at its place, at rest, lift let go", () => {
    const f = flight(thrown(700, 400, 1500, -300), { x: 1200, y: 300 }, FLY);
    const last = f[f.length - 1];
    expect(last).toEqual(still({ x: 1200, y: 300 }));
    expect(f.length * FRAME_MS).toBeLessThan(1500);
  });

  it("carries on with the throw", () => {
    // Thrown up while its place is to the right: it rises before it turns.
    const f = flight(thrown(700, 400, 0, -900), { x: 1000, y: 400 }, FLY);
    expect(f[3].y).toBeLessThan(400);
  });

  it("into a tuck sinks a few px past its place at most, however it was thrown", () => {
    const at = dockCentre("right", 0.5, STAGE, SIDES);
    for (const [x, vx] of [
      [1260, 1500],
      [1300, 4200],
      [1395, 4200],
      [700, 4200],
      [1150, 300],
      [200, 2000],
    ]) {
      const f = flight(thrown(x, at.y, vx, 0), at, TUCK);
      const deepest = Math.max(...f.map((m) => m.x));
      expect(deepest - at.x, `from ${x} at ${vx} px/s`).toBeLessThan(6);
      // Never out of sight: some of the glass is always on the screen.
      expect(deepest - RADIUS).toBeLessThan(1440 - 8);
    }
  });

  it("leaves its light lagging a little while it moves, and settled when it stops", () => {
    const f = flight(thrown(300, 400, 2000, 0), { x: 900, y: 400 }, FLY);
    const moving = f[4];
    expect(moving.slx).toBeLessThan(0);
    expect(Math.abs(moving.slx)).toBeLessThanOrEqual(4.5);
    expect(f[f.length - 1].slx).toBe(0);
  });
});

describe("drawing a moment of it", () => {
  it("moves the lamp only by translate, from the screen's corner", () => {
    const p = poseOf(still({ x: 100, y: 200 }), STAGE);
    expect(p.translate).toBe(`${(100 - RADIUS).toFixed(2)}px ${(200 - RADIUS).toFixed(2)}px`);
    expect(p.gloss).toBe(1);
    expect(p.shadowRest).toBe(1);
    expect(p.shadowLifted).toBe(0);
  });

  it("slides a tucked lamp's light into the part on the screen, and fades its reflection", () => {
    const at = dockCentre("right", 0.5, STAGE, SIDES);
    const p = poseOf(still(at), STAGE);
    const [lx] = p.lightTranslate.split(" ").map(parseFloat);
    expect(lx).toBeCloseTo(-(RADIUS * 2 - PEEK) / 2, 1);
    expect(parseFloat(p.lightScale)).toBeCloseTo(0.84, 2);
    expect(p.gloss).toBeLessThan(0.3);
    expect(p.shadowRest).toBeCloseTo(PEEK / (RADIUS * 2), 2);
  });

  it("stretches along a fast move without spinning when its direction turns round", () => {
    const a = poseOf({ ...still({ x: 500, y: 400 }), vx: -3000, vy: 10 }, STAGE);
    const b = poseOf({ ...still({ x: 500, y: 400 }), vx: -3000, vy: -10 }, STAGE, a.angle);
    expect(Math.abs(b.angle - a.angle)).toBeLessThan(0.1);
    expect(a.inner).toMatch(/scale\(1\.0[0-9]+, 0\.9[0-9]+\)/);
  });

  it("becomes keyframes for every part, one per frame, with the moment it touches the edge", () => {
    const at = dockCentre("right", 0.5, STAGE, SIDES);
    const f = flight(thrown(1100, at.y, 1400, 0), at, TUCK);
    const fr = flightFrames(f, STAGE);
    for (const k of [fr.lamp, fr.inner, fr.light, fr.gloss, fr.shadowRest, fr.shadowLifted, fr.pool]) expect(k.length).toBe(f.length);
    expect(fr.durationMs).toBeCloseTo((f.length - 1) * FRAME_MS, 5);
    expect(fr.contactMs).toBeGreaterThan(0);
    expect(fr.contactMs).toBeLessThan(fr.durationMs);
    expect(fr.lamp[fr.lamp.length - 1]).toEqual({ translate: `${(at.x - RADIUS).toFixed(2)}px ${(at.y - RADIUS).toFixed(2)}px` });
  });

  it("is picked up mid-flight from the frame it had reached", () => {
    const f = flight(thrown(300, 300, 0, 0), { x: 900, y: 300 }, FLY);
    expect(sampleAt(f, 5 * FRAME_MS)).toEqual(f[5]);
    expect(sampleAt(f, 99999)).toEqual(f[f.length - 1]);
    expect(sampleAt(f, -5)).toEqual(f[0]);
  });
});

describe("the throw", () => {
  it("reads the finger's speed over its last moments, and nothing if it had stopped", () => {
    const s = [
      { t: 0, x: 100, y: 100 },
      { t: 16, x: 120, y: 100 },
      { t: 32, x: 140, y: 100 },
      { t: 48, x: 160, y: 100 },
    ];
    expect(velocityOf(s, 50).vx).toBeCloseTo(1250, 0);
    expect(velocityOf(s, 200)).toEqual({ vx: 0, vy: 0 });
    expect(velocityOf(s.slice(0, 1), 10)).toEqual({ vx: 0, vy: 0 });
  });
});
