import { describe, expect, it } from "vitest";
import { CHASE_RADIUS, TRAIL, brightness, newFireflies, stepFireflies, syllables } from "./fireflies";
import type { LampMood } from "./lamp-look";

const MOODS: LampMood[] = ["idle", "listening", "talking", "thinking"];

function run(mood: LampMood, seconds: number, glow = 0, f = newFireflies(mood)) {
  for (let i = 0; i < seconds * 60; i++) stepFireflies(f, 1 / 60, mood, glow);
  return f;
}

describe("two fireflies", () => {
  it("stay well inside the glass in every mood", () => {
    for (const mood of MOODS) {
      const f = newFireflies(mood);
      for (let i = 0; i < 60 * 30; i++) {
        stepFireflies(f, 1 / 60, mood, mood === "talking" ? 0.7 : 0);
        // The glass is 22 px round; the big light's glow reaches ~6 px, the small one's ~2.
        expect(Math.hypot(f.ax, f.ay), mood).toBeLessThan(13);
        expect(Math.hypot(f.bx, f.by), mood).toBeLessThan(18);
      }
    }
  });

  it("never jump when the mood changes", () => {
    const f = run("idle", 3);
    for (const next of ["listening", "talking", "thinking", "idle"] as LampMood[]) {
      let ax = f.ax;
      let bx = f.bx;
      for (let i = 0; i < 60; i++) {
        stepFireflies(f, 1 / 60, next, 0.7);
        // At most ~2 px a frame, even for the small one spinning fast while thinking.
        expect(Math.abs(f.ax - ax), next).toBeLessThan(2.5);
        expect(Math.abs(f.bx - bx), next).toBeLessThan(2.5);
        ax = f.ax;
        bx = f.bx;
      }
    }
  });

  it("chase each other round a small circle while thinking", () => {
    const f = run("thinking", 4);
    expect(Math.hypot(f.ax, f.ay)).toBeCloseTo(CHASE_RADIUS, 0);
    expect(Math.hypot(f.bx, f.by)).toBeCloseTo(CHASE_RADIUS, 0);
    // Half a turn apart.
    expect(Math.hypot(f.ax + f.bx, f.ay + f.by)).toBeLessThan(1);
  });

  it("gather close while listening", () => {
    const idle = run("idle", 6);
    const listening = run("listening", 6);
    expect(Math.hypot(listening.ax, listening.ay)).toBeLessThan(Math.max(3, Math.hypot(idle.ax, idle.ay) + 0.01) + 0.5);
    expect(listening.p.orbit).toBeLessThan(idle.p.orbit);
  });

  it("leave short trails", () => {
    const f = run("talking", 2, 0.7);
    expect(f.trailA.length).toBe(TRAIL);
    expect(f.trailB.length).toBe(TRAIL);
  });
});

describe("the voice in them", () => {
  it("shows a metered voice as it is", () => {
    const f = newFireflies("talking");
    for (let i = 0; i < 60; i++) stepFireflies(f, 1 / 60, "talking", 0.2 + 0.6 * (i % 2));
    expect(f.level).toBeGreaterThan(0.2);
    expect(f.level).toBeLessThan(0.8);
  });

  it("gives a steady talking voice a rhythm of its own", () => {
    const f = run("talking", 1, 0.7);
    const seen: number[] = [];
    for (let i = 0; i < 90; i++) {
      stepFireflies(f, 1 / 60, "talking", 0.7);
      seen.push(f.level);
    }
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.2);
    expect(syllables(0)).toBeGreaterThanOrEqual(0);
    expect(syllables(1.3)).toBeLessThanOrEqual(1);
  });

  it("are quiet at rest, brighter when talking", () => {
    const idle = run("idle", 3);
    const talking = run("talking", 3, 0.7);
    expect(idle.level).toBeLessThan(0.01);
    expect(brightness(talking)).toBeGreaterThan(brightness(idle) * 0.9);
  });
});
