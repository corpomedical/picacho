import { describe, expect, it } from "vitest";
import { FILM_MOVE_WORDS, FILM_MOVES, FILM_TEXTURE_WORDS, FILM_TEXTURES, groundDistance, isFilmMove, beatJumps, BEAT_JUMP_SIZE, BEAT_JUMP_TURN_DEG, layBeatMove, layMove, poseAlong, relayMoves, samePose } from "./moves";
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
    expect(end.fovDeg).toBe(SET_LIMITS.minMatchFovDeg);
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
        expect(end.fovDeg, m).toBeGreaterThanOrEqual(SET_LIMITS.minMatchFovDeg);
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

describe("layBeatMove", () => {
  it("keeps the camera where the stage says it has room, and a dolly zoom stopped short keeps her size", () => {
    // Something built 6 m out: the stage stops the camera there.
    const room = (p: FilmPose): FilmPose => {
      const d = groundDistance(p, mark);
      return d <= 6 ? p : { ...p, position: [(p.position[0] * 6) / d, p.position[1], (p.position[2] * 6) / d] };
    };
    const end = layBeatMove("dolly-zoom", from, mark, bounds, room);
    expect(groundDistance(end, mark)).toBeCloseTo(6, 2);
    const size = (p: FilmPose) => groundDistance(p, mark) * Math.tan((p.fovDeg * Math.PI) / 360);
    expect(size(end)).toBeCloseTo(size(from), 2);
    // With room to spare it is layMove's own end.
    expect(layBeatMove("arc-left", from, mark, bounds)).toEqual(layMove("arc-left", from, mark, bounds));
  });
});

describe("samePose", () => {
  it("is the same view to within 2 cm and a twentieth of a degree", () => {
    expect(samePose(from, { ...from, position: [0.015, 1.6, 4.01] })).toBe(true);
    expect(samePose(from, { ...from, fovDeg: from.fovDeg + 0.04 })).toBe(true);
    expect(samePose(from, { ...from, position: [0.05, 1.6, 4] })).toBe(false);
    expect(samePose(from, { ...from, target: [0, 1.3, 0] })).toBe(false);
    expect(samePose(from, { ...from, fovDeg: from.fovDeg + 0.2 })).toBe(false);
  });
});

// The first real film (2026-09-21): beat 1's "Arc left" had been laid from
// still 1 (50 mm, 5.5 m) and the film was then opened on still 6 (135 mm,
// 8.3 m). The arc was never laid again, so the clip had to join two cameras
// no arc joins, and it cross-faded. These are that film's own numbers.
describe("relayMoves: a move laid again from where its beat now starts", () => {
  const setBounds = { x: 64, z: 70, height: 18 };
  const figure = { x: 1.54, z: 0.85 };
  const still6: FilmPose = { position: [9.734, 1.756, -0.308], target: [1.54, 1.25, 0.85], fovDeg: 10 };
  const still1: FilmPose = { position: [6.971, 1.756, 0.083], target: [-1.073, 0.328, 0.119], fovDeg: 26.99 };
  const byHand: FilmPose = { position: [4.527, 1.756, 0.428], target: [1.54, 1.25, 0.85], fovDeg: 26.99 };

  it("lays beat 1's arc from the opening still, at that still's lens and distance", () => {
    const stale = [{ move: "arc-left" as const, end: layBeatMove("arc-left", still1, figure, setBounds) }];
    // As saved, the arc ended 5.4 m out on a 50 mm: not an arc from still 6.
    expect(stale[0].end.fovDeg).toBe(26.99);
    const beats = relayMoves(stale, still6, figure, setBounds);
    expect(beats).not.toBe(stale);
    expect(beats[0].end).toEqual(layBeatMove("arc-left", still6, figure, setBounds));
    expect(beats[0].end.fovDeg).toBe(10);
    expect(groundDistance(beats[0].end, figure)).toBeCloseTo(groundDistance(still6, figure), 2);
    expect(beats[0].move).toBe("arc-left");
  });

  it("keeps a beat framed by hand, and lays the moved beat after it from that end", () => {
    const beats = relayMoves(
      [
        { move: null, end: byHand },
        { move: "dolly-zoom" as const, end: still6 },
      ],
      still1,
      figure,
      setBounds,
    );
    expect(beats[0].end).toBe(byHand);
    expect(beats[1].end).toEqual(layBeatMove("dolly-zoom", byHand, figure, setBounds));
  });

  it("gives the same beats back when every move already starts where its beat does", () => {
    const beats = [{ move: "arc-left" as const, end: layBeatMove("arc-left", still6, figure, setBounds) }];
    expect(relayMoves(beats, still6, figure, setBounds)).toBe(beats);
  });

  it("leaves the first beat alone when the opening still's camera was never recorded", () => {
    const beats = [{ move: "arc-left" as const, end: byHand }];
    expect(relayMoves(beats, null, figure, setBounds)).toBe(beats);
  });
});

// The first real film's own cameras (2026-09-21): beat 2, framed by hand
// with no move, turned 35° round her and came 1.8× closer, and its clip
// cross-faded; beat 3's two ends stood at one bearing with her size held,
// and came out smooth.
describe("beatJumps", () => {
  const figure = { x: 1.54, z: 0.85 };
  const aim: [number, number, number] = [1.54, 1.25, 0.85];
  const beat1End: FilmPose = { position: [6.38, 1.756, 3.312], target: aim, fovDeg: 26.99 };
  const beat2End: FilmPose = { position: [4.527, 1.756, 0.428], target: aim, fovDeg: 26.99 };
  const beat3End: FilmPose = { position: [7.394, 1.756, 0.023], target: aim, fovDeg: 13.96 };

  it("says the beat that dissolved jumps, and the one that came out smooth does not", () => {
    expect(beatJumps(beat1End, beat2End, figure)).toBe(true);
    expect(beatJumps(beat2End, beat3End, figure)).toBe(false);
  });

  it("turns past its limit, or grows or shrinks her past its factor", () => {
    expect(BEAT_JUMP_TURN_DEG).toBe(20);
    expect(BEAT_JUMP_SIZE).toBe(2);
    const at = (deg: number, d: number, fovDeg = from.fovDeg): FilmPose => ({
      position: [Math.sin((deg * Math.PI) / 180) * d, 1.6, Math.cos((deg * Math.PI) / 180) * d],
      target: [0, 1.25, 0],
      fovDeg,
    });
    expect(beatJumps(at(0, 4), at(15, 4), mark)).toBe(false);
    expect(beatJumps(at(0, 4), at(25, 4), mark)).toBe(true);
    // The short way round: 350° to 10° is a turn of 20°.
    expect(beatJumps(at(350, 4), at(9, 4), mark)).toBe(false);
    expect(beatJumps(at(0, 4), at(0, 2.2), mark)).toBe(false);
    expect(beatJumps(at(0, 4), at(0, 1.8), mark)).toBe(true);
    expect(beatJumps(at(0, 4), at(0, 9), mark)).toBe(true);
    // A dolly zoom's two ends keep her size: no jump, however far back.
    const dz = layMove("dolly-zoom", at(0, 4), mark, bounds);
    expect(beatJumps(at(0, 4), dz, mark)).toBe(false);
  });
});
