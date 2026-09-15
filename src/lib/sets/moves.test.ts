import { describe, expect, it } from "vitest";
import { FILM_MOVE_WORDS, FILM_MOVES, FILM_TEXTURE_WORDS, FILM_TEXTURES, groundDistance, isFilmMove, layMove } from "./moves";
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
