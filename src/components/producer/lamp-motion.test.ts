import { describe, expect, it } from "vitest";
import {
  CONTACT_GAP,
  GLIDE,
  MORPH,
  cornersFor,
  flight,
  keyframes,
  landing,
  maxStartVelocity,
  project,
  pullOf,
  sampleSpring,
  velocityOf,
} from "./lamp-motion";
import { SNAP_GAP, settleThrown, type Stage } from "./lamp-place";

const STAGE: Stage = { left: 0, top: 0, right: 1200, bottom: 800 };
const round = (cx: number, cy: number) => ({ left: cx - 22, top: cy - 22, width: 44, height: 44 });
const TAB_RIGHT = { left: 1188, top: 268, width: 12, height: 64 };

describe("the lamp's springs", () => {
  it("settle at exactly 1 and never overshoot, from rest or thrown", () => {
    for (const spring of [GLIDE, MORPH]) {
      for (const v of [0, 2, maxStartVelocity(spring)]) {
        const p = sampleSpring(spring, v);
        expect(p[0]).toBe(0);
        expect(p[p.length - 1]).toBe(1);
        expect(Math.max(...p)).toBeLessThanOrEqual(1.0005);
        // Monotonic: a critically damped spring never turns back.
        for (let i = 1; i < p.length; i++) expect(p[i]).toBeGreaterThanOrEqual(p[i - 1] - 1e-9);
      }
    }
  });

  it("feel quick: the glide is 95% there within 350 ms and done within 700", () => {
    const p = sampleSpring(GLIDE);
    const at95 = p.findIndex((x) => x >= 0.95) * (1000 / 60);
    expect(at95).toBeLessThan(350);
    expect(p.length * (1000 / 60)).toBeLessThan(700);
  });

  it("start faster when thrown", () => {
    const still = sampleSpring(GLIDE, 0);
    const thrown = sampleSpring(GLIDE, 8);
    expect(thrown[3]).toBeGreaterThan(still[3]);
  });
});

describe("the corners", () => {
  it("add up to the short side's width at every moment of a morph, so the browser never rescales them", () => {
    const from = round(1100, 300);
    const frames = flight(from, cornersFor(from, null), TAB_RIGHT, cornersFor(TAB_RIGHT, "right"), sampleSpring(GLIDE));
    for (const f of frames) {
      const [tl, tr] = f.corners;
      expect(tl + tr).toBeLessThanOrEqual(f.width + 0.01);
      expect(Math.abs(tl + tr - f.width)).toBeLessThan(0.01);
    }
    const last = frames[frames.length - 1];
    expect(last.corners).toEqual([12, 0, 0, 12]);
    expect(frames[0].corners).toEqual([22, 22, 22, 22]);
  });

  it("round the tab on the page's side for every edge", () => {
    expect(cornersFor({ left: 0, top: 0, width: 12, height: 64 }, "left")).toEqual([0, 12, 12, 0]);
    expect(cornersFor({ left: 0, top: 0, width: 64, height: 12 }, "top")).toEqual([0, 0, 12, 12]);
    expect(cornersFor({ left: 0, top: 0, width: 64, height: 12 }, "bottom")).toEqual([12, 12, 0, 0]);
  });
});

describe("a landing on the edge", () => {
  it("glides round, flattens only near the wall, and never passes it", () => {
    const from = round(900, 300);
    const l = landing(from, TAB_RIGHT, "right", 1200, 0);
    let flattened = false;
    for (const f of l.frames) {
      expect(f.left + f.width).toBeLessThanOrEqual(1200 + 1e-6);
      const rimGap = 1200 - (f.left + f.width);
      if (f.width < 43.9) {
        flattened = true;
      } else {
        // Still round: it hasn't reached the wall's zone yet.
        expect(rimGap).toBeGreaterThan(CONTACT_GAP - 12);
      }
    }
    expect(flattened).toBe(true);
    const last = l.frames[l.frames.length - 1];
    expect([last.left, last.top, last.width, last.height].map((v) => Math.round(v * 100) / 100)).toEqual([1188, 268, 12, 64]);
    expect(l.contactMs).toBeGreaterThan(0);
    expect(l.shapedMs).toBeGreaterThan(l.contactMs);
  });

  it("flattens at once when let go against the wall, pinned there", () => {
    const from = round(1200 - 22 - 10, 300);
    const l = landing(from, TAB_RIGHT, "right", 1200, 0);
    expect(l.contactMs).toBe(0);
    for (const f of l.frames) expect(f.left + f.width).toBeLessThanOrEqual(1200 + 1e-6);
  });

  it("with a hard throw still stops at the wall", () => {
    const from = round(500, 300);
    const l = landing(from, TAB_RIGHT, "right", 1200, 40);
    for (const f of l.frames) expect(f.left + f.width).toBeLessThanOrEqual(1200 + 1e-6);
  });

  it("works on the other edges", () => {
    const top = { left: 568, top: 0, width: 64, height: 12 };
    const l = landing(round(600, 200), top, "top", 0, 3);
    for (const f of l.frames) expect(f.top).toBeGreaterThanOrEqual(-1e-6);
    const last = l.frames[l.frames.length - 1];
    expect(Math.round(last.height)).toBe(12);
  });

  it("becomes keyframes the Web Animations API takes", () => {
    const k = keyframes(landing(round(900, 300), TAB_RIGHT, "right", 1200, 0).frames);
    expect(k[0]).toMatchObject({ width: "44.00px", height: "44.00px", borderRadius: "22.00px 22.00px 22.00px 22.00px" });
    expect(k[k.length - 1]).toMatchObject({ left: "1188.00px", width: "12.00px", borderRadius: "12.00px 0.00px 0.00px 12.00px" });
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

  it("projects like a scroll view (WWDC18)", () => {
    expect(project(0, 1000)).toBeCloseTo(499, 0);
    expect(project(0, 1000, 0.99)).toBeCloseTo(99, 0);
  });

  it("docks a throw toward an edge, and leaves a slow drop where it was put", () => {
    // Mid-screen, thrown right at 1500 px/s: it would come to rest past the edge.
    expect(settleThrown(600, 300, 1500, 0, STAGE)).toMatchObject({ kind: "edge", edge: "right" });
    // The same place, a slow hand: free, where it was let go.
    expect(settleThrown(600, 300, 200, 0, STAGE)).toEqual({ kind: "free", x: 0.5, y: 0.375 });
    // Let go against an edge, whatever the speed: that edge.
    expect(settleThrown(1200 - 22 - SNAP_GAP + 2, 300, -900, 0, STAGE)).toMatchObject({ kind: "edge", edge: "right" });
    // A modest throw in open space glides a little way on and stops.
    const free = settleThrown(600, 300, 700, 0, STAGE);
    expect(free.kind).toBe("free");
    if (free.kind === "free") expect(free.x).toBeGreaterThan(0.5);
  });

  it("pulls continuously near an edge, only close in", () => {
    expect(pullOf(60, 54)).toBe(0);
    expect(pullOf(27, 54)).toBeCloseTo(0.25, 5);
    expect(pullOf(0, 54)).toBe(1);
    expect(pullOf(-5, 54)).toBe(1);
  });
});
