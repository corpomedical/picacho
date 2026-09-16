import { describe, expect, it } from "vitest";
import { FILM_MOVE_WORDS, FILM_MOVES, FILM_TEXTURE_WORDS, FILM_TEXTURES, groundDistance, isFilmMove, layMove, poseAlong } from "./moves";
import { SET_LIMITS } from "./set-spec";
import type { FilmPose } from "./film";

// Moves are paths in the set: each lays the beat's end round the figure,
// inside the set's reach, with a lens the stage can hold.

const bounds = { x: 40, z: 40, height: 10 };
const mark = { x: 0, z: 0 };
// The camera 4 m in front of the figure (+Z), at eye height, a 35.
const from: FilmPose = { position: [0, 1.6, 4], target: [0, 1.25, 0], fovDeg: 37.85 };
const bearing = (p: FilmPose) => Math.atan2(p.position[0] - mark.x, p.position[2] - mark.z) * (180 / Math.PI);

describe("layMove", () => {
  it("a dolly zoom holds the figure's size: distance × tan(fov / 2) is kept", () => {
    const end = layMove("dolly-zoom", from, mark, bounds);
    const size = (p: FilmPose) => groundDistance(p, mark) * Math.tan((p.fovDeg * Math.PI) / 360);
    expect(groundDistance(end, mark)).toBeGreaterThan(groundDistance(from, mark) * 3);
    expect(size(end)).toBeCloseTo(size(from), 1);
    expect(end.fovDeg).toBeLessThan(from.fovDeg);
  });

  it("a dolly zoom meets the stage's longest lens by giving up distance, never size", () => {
    const tele: FilmPose = { ...from, fovDeg: 18 };
    const end = layMove("dolly-zoom", tele, mark, bounds);
    expect(end.fovDeg).toBe(SET_LIMITS.minLayoutFovDeg);
    const size = (p: FilmPose) => groundDistance(p, mark) * Math.tan((p.fovDeg * Math.PI) / 360);
    expect(size(end)).toBeCloseTo(size(tele), 1);
  });

  it("pushes in and pulls out along the same line", () => {
    const inn = layMove("push-in", from, mark, bounds);
    const out = layMove("pull-out", from, mark, bounds);
    expect(groundDistance(inn, mark)).toBeLessThan(4);
    expect(groundDistance(out, mark)).toBeGreaterThan(4);
    expect(bearing(inn)).toBeCloseTo(0, 6);
    expect(bearing(out)).toBeCloseTo(0, 6);
  });

  it("arcs left as the camera sees it: from +Z, left is toward −X", () => {
    const left = layMove("arc-left", from, mark, bounds);
    const right = layMove("arc-right", from, mark, bounds);
    expect(bearing(left)).toBeCloseTo(-35, 1);
    expect(bearing(right)).toBeCloseTo(35, 1);
    expect(left.position[0]).toBeLessThan(0);
    expect(groundDistance(left, mark)).toBeCloseTo(4, 3);
  });

  it("trucks the camera and its aim together, parallel to the view", () => {
    const tr = layMove("truck-right", from, mark, bounds);
    // Looking along −Z, screen right is +X.
    expect(tr.position[0]).toBeCloseTo(1.6, 6);
    expect(tr.target[0]).toBeCloseTo(1.6, 6);
    expect(tr.position[2]).toBeCloseTo(4, 6);
  });

  it("holds exactly where it is", () => {
    expect(layMove("hold", from, mark, bounds)).toEqual(from);
  });

  it("keeps every end inside the set's reach, with a lens the stage can hold", () => {
    const far: FilmPose = { position: [0, 1.6, 28], target: [0, 1, 0], fovDeg: 40 };
    for (const m of FILM_MOVES) {
      for (const start of [from, far]) {
        const end = layMove(m, start, mark, bounds);
        expect(Math.abs(end.position[0]), m).toBeLessThanOrEqual(bounds.x / 2 + 10);
        expect(Math.abs(end.position[2]), m).toBeLessThanOrEqual(bounds.z / 2 + 10);
        expect(end.position[1], m).toBeGreaterThanOrEqual(0.2);
        expect(end.fovDeg, m).toBeGreaterThanOrEqual(SET_LIMITS.minLayoutFovDeg);
        expect(end.fovDeg, m).toBeLessThanOrEqual(SET_LIMITS.maxFovDeg);
      }
    }
  });

  it("gives every move and texture its one sentence", () => {
    for (const m of FILM_MOVES) expect(FILM_MOVE_WORDS[m]).toMatch(/\.$/);
    for (const t of FILM_TEXTURES) expect(FILM_TEXTURE_WORDS[t]).toMatch(/\.$/);
    expect(isFilmMove("rack-focus")).toBe(false);
  });
});

// The previz's path (2026-09-16): what Play the move flies between a beat's
// ends. Straight for most moves; round the person for arcs and orbits; the
// person's size held for a dolly zoom.
describe("poseAlong", () => {
  const close = (p: FilmPose, q: FilmPose) => {
    for (let i = 0; i < 3; i++) {
      expect(p.position[i]).toBeCloseTo(q.position[i], 9);
      expect(p.target[i]).toBeCloseTo(q.target[i], 9);
    }
    expect(p.fovDeg).toBeCloseTo(q.fovDeg, 9);
  };

  it("starts and ends exactly on the beat's two poses, for every move and for none", () => {
    for (const move of [...FILM_MOVES, null]) {
      const end = layMove(move ?? "push-in", from, mark, bounds);
      close(poseAlong(move, from, end, 0), from);
      close(poseAlong(move, from, end, 1), end);
    }
  });

  it("circles the person on a quarter orbit instead of cutting the chord toward her", () => {
    const end = layMove("orbit-90", from, mark, bounds);
    for (const e of [0.25, 0.5, 0.75]) {
      expect(groundDistance(poseAlong("orbit-90", from, end, e), mark)).toBeCloseTo(4, 6);
    }
    // What a straight line would have done halfway: 29% closer.
    expect(groundDistance(poseAlong(null, from, end, 0.5), mark)).toBeCloseTo(4 * Math.SQRT1_2, 6);
    expect(bearing(poseAlong("orbit-90", from, end, 0.5))).toBeCloseTo(45, 6);
  });

  it("arcs the short way, to the side the move names", () => {
    const left = layMove("arc-left", from, mark, bounds);
    const right = layMove("arc-right", from, mark, bounds);
    // Halfway round, to the laid end's own bearing (layMove rounds it to the millimetre).
    expect(bearing(left)).toBeCloseTo(-35, 1);
    expect(bearing(poseAlong("arc-left", from, left, 0.5))).toBeCloseTo(bearing(left) / 2, 6);
    expect(bearing(poseAlong("arc-right", from, right, 0.5))).toBeCloseTo(bearing(right) / 2, 6);
    // Across the ±180° seam the turn is still the short one.
    const behind: FilmPose = { ...from, position: [-0.7, 1.6, -3.9] };
    const across = layMove("arc-left", behind, mark, bounds);
    const mid = poseAlong("arc-left", behind, across, 0.5);
    expect(groundDistance(mid, mark)).toBeCloseTo((groundDistance(behind, mark) + groundDistance(across, mark)) / 2, 9);
    expect(groundDistance(mid, mark)).toBeCloseTo(groundDistance(behind, mark), 4);
    expect(Math.abs(bearing(mid))).toBeGreaterThan(150);
  });

  it("holds the person's size through a dolly zoom, where easing the lens and the distance apart does not", () => {
    const end = layMove("dolly-zoom", from, mark, bounds);
    const size = (p: FilmPose) => groundDistance(p, mark) * Math.tan((p.fovDeg * Math.PI) / 360);
    // Held to the laid ends' own sizes, which layMove's rounding leaves 4 µm apart.
    for (const e of [0.2, 0.5, 0.8]) {
      expect(size(poseAlong("dolly-zoom", from, end, e))).toBeCloseTo(size(from) + (size(end) - size(from)) * e, 9);
      expect(size(poseAlong("dolly-zoom", from, end, e))).toBeCloseTo(size(from), 4);
    }
    expect(Math.abs(size(poseAlong(null, from, end, 0.5)) - size(from))).toBeGreaterThan(0.3);
  });

  it("keeps a push-in on its straight line", () => {
    const end = layMove("push-in", from, mark, bounds);
    const mid = poseAlong("push-in", from, end, 0.5);
    for (let i = 0; i < 3; i++) expect(mid.position[i]).toBeCloseTo((from.position[i] + end.position[i]) / 2, 9);
  });

  it("falls back to the straight line for a camera on the point it would turn about", () => {
    const onTop: FilmPose = { ...from, position: [0, 1.6, 0.01] };
    const end: FilmPose = { position: [3, 1.6, 0], target: [0, 1.25, 0], fovDeg: 40 };
    const mid = poseAlong("orbit-90", onTop, end, 0.5);
    expect(mid.position[0]).toBeCloseTo(1.5, 9);
  });
});
