import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildSkeleton, type Vec3 } from "./studio-pose";
import {
  GAITS,
  addMove,
  distanceAt,
  gaitFrame,
  moveAt,
  moveWords,
  naturalEnd,
  naturalSeconds,
  normaliseMoves,
  pathEnd,
  pathLength,
  shortestYaw,
  strideFor,
  turnStart,
  turnYawAt,
  type Move,
  type PathMove,
} from "./studio-gait";

const FPS = 24;
const ankle = (sk: ReturnType<typeof buildSkeleton>, n: "foot.L" | "foot.R") => sk.bones[n].getWorldPosition(new THREE.Vector3());

/** Runs a move frame by frame and measures how far each planted ankle slides, and how far the root travels. */
function run(m: PathMove) {
  const sk = buildSkeleton();
  let slide = 0, miss = 0, travelled = 0, planted = 0;
  let prev: { L: THREE.Vector3; R: THREE.Vector3; pL: boolean; pR: boolean; root: THREE.Vector3 } | null = null;
  const frames: ReturnType<typeof gaitFrame>[] = [];
  for (let f = m.f0; f <= m.f1; f++) {
    const g = gaitFrame(sk, m, (f - m.f0) / FPS, FPS);
    frames.push(g);
    const L = ankle(sk, "foot.L"), R = ankle(sk, "foot.R"), root = sk.root.position.clone();
    for (const [a, foot] of [[L, g.feet.L], [R, g.feet.R]] as const) if (foot.planted) miss = Math.max(miss, a.distanceTo(foot.at));
    if (prev) {
      if (g.feet.L.planted && prev.pL) { slide = Math.max(slide, L.distanceTo(prev.L)); planted++; }
      if (g.feet.R.planted && prev.pR) { slide = Math.max(slide, R.distanceTo(prev.R)); planted++; }
      travelled += root.distanceTo(prev.root);
    }
    prev = { L, R, pL: g.feet.L.planted, pR: g.feet.R.planted, root };
  }
  return { slide, miss, travelled, planted, frames, sk };
}

describe("the pace along a path", () => {
  it("speeds up, keeps a steady pace, slows into a stand, and ends exactly at the path's end", () => {
    const T = 3, D = 3.6, r = 0.5;
    expect(distanceAt(0, T, D, r).d).toBe(0);
    expect(distanceAt(T, T, D, r).d).toBeCloseTo(D, 9);
    expect(distanceAt(T, T, D, r).v).toBeCloseTo(0, 9);
    expect(distanceAt(1.5, T, D, r).v).toBeCloseTo(D / (T - r), 9);
    // Continuous: no jump at the ramps' edges.
    for (const t of [r, T - r]) expect(distanceAt(t - 1e-6, T, D, r).d).toBeCloseTo(distanceAt(t + 1e-6, T, D, r).d, 4);
    // A short time never ramps more than half of it.
    expect(distanceAt(0.4, 0.4, 1, 0.8).d).toBeCloseTo(1, 9);
  });

  it("walks about 1.4 m/s and runs about 4 m/s at their own pace", () => {
    for (const gait of ["walk", "run"] as const) {
      const D = 12, T = naturalSeconds(gait, D);
      expect(distanceAt(T / 2, T, D, GAITS[gait].ramp).v).toBeCloseTo(GAITS[gait].speed, 6);
    }
    expect(naturalEnd("walk", [[0, 0, 0], [4.2, 0, 0]], 1, FPS, 241)).toBe(1 + Math.round((4.2 / 1.4 + 0.5) * FPS));
  });

  it("fits a whole number of steps, longer strides the faster it goes", () => {
    const a = strideFor("walk", 1.4, 4.2), b = strideFor("walk", 2, 4.2);
    expect(Number.isInteger(a.halfSteps)).toBe(true);
    expect((a.stride * a.halfSteps) / 2).toBeCloseTo(4.2, 9);
    expect(a.stride).toBeGreaterThan(1.2);
    expect(a.stride).toBeLessThan(1.6);
    expect(b.stride).toBeGreaterThanOrEqual(a.stride);
  });
});

describe("feet that don't skate", () => {
  it("a 3 s walk to the car: every planted ankle stays put in the world, and the legs reach it", () => {
    const r = run({ kind: "path", gait: "walk", f0: 1, f1: 73, path: [[0, 0, 0], [0, 0, 3.6]] });
    expect(r.planted).toBeGreaterThan(60);
    expect(r.slide).toBeLessThan(0.002);
    expect(r.miss).toBeLessThan(0.003);
  });

  it("a run, and a walk round a curve, too", () => {
    for (const m of [
      { kind: "path", gait: "run", f0: 1, f1: 97, path: [[0, 0, 0], [14, 0, 0]] },
      { kind: "path", gait: "walk", f0: 10, f1: 130, path: [[0, 0, 0], [2, 0, 2], [4, 0, 1], [6, 0, 4]] },
    ] as PathMove[]) {
      const r = run(m);
      expect(r.slide, m.gait).toBeLessThan(0.002);
      expect(r.miss, m.gait).toBeLessThan(0.003);
    }
  });

  it("starts and ends with both feet side by side, standing on the path's ends, facing the way it goes", () => {
    const m: PathMove = { kind: "path", gait: "walk", f0: 1, f1: 73, path: [[1, 0, 1], [4, 0, 5]] };
    const r = run(m), first = r.frames[0], last = r.frames[r.frames.length - 1];
    for (const g of [first, last]) {
      expect(g.feet.L.planted && g.feet.R.planted).toBe(true);
      expect(g.feet.L.at.distanceTo(g.feet.R.at)).toBeCloseTo(0.2, 3);
    }
    expect(last.pos).toEqual([4, 0, 5]);
    expect(last.yaw).toBeCloseTo(Math.atan2(3, 4), 6);
    // The pace fades out: the arms hang as in Stand at the end.
    expect(last.pose.rot["upperArm.L"]).toEqual([0, 0, 6]);
  });

  it("the root travels the path's arc length", () => {
    const path: Vec3[] = [[0, 0, 0], [3, 0, 0], [3, 0, 4]];
    const r = run({ kind: "path", gait: "walk", f0: 1, f1: 150, path });
    expect(r.travelled).toBeCloseTo(pathLength(path), 1);
    expect(pathLength([[0, 0, 0], [3, 0, 4]])).toBeCloseTo(5, 9);
  });
});

describe("turning", () => {
  it("turns the short way round and ends facing the target", () => {
    expect(shortestYaw(3, -3)).toBeCloseTo(3 + (2 * Math.PI - 6), 9);
    expect(shortestYaw(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 9);
    expect(shortestYaw(0.1, 0.1 + 4 * Math.PI)).toBeCloseTo(0.1, 9);
    expect(turnYawAt(3, -3, 1)).toBeCloseTo(3 + (2 * Math.PI - 6), 9);
    expect(turnYawAt(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4, 9);
    expect(turnYawAt(0, 1, -2)).toBe(0);
  });

  it("a turn after a walk stands where the walk ended, facing its way", () => {
    const walk: PathMove = { kind: "path", gait: "walk", f0: 1, f1: 40, path: [[0, 0, 0], [0, 0, 2]] };
    const turn: Move = { kind: "turn", f0: 40, f1: 52, yaw: Math.PI / 2, yaw0: 9, at: [9, 9, 9] };
    const s = turnStart([walk, turn], turn as never);
    expect(s.at).toEqual([0, 0, 2]);
    expect(s.yaw0).toBeCloseTo(0, 9);
    expect(pathEnd(walk).yaw).toBeCloseTo(0, 9);
  });
});

describe("moves on the timeline", () => {
  it("the move running at a frame drives it; after the last, the last holds; before the first, none", () => {
    const a: Move = { kind: "path", gait: "walk", f0: 10, f1: 40, path: [[0, 0, 0], [1, 0, 0]] };
    const b: Move = { kind: "turn", f0: 50, f1: 60, yaw: 1, yaw0: 0, at: [0, 0, 0] };
    expect(moveAt([a, b], 5)).toBeNull();
    expect(moveAt([a, b], 20)).toBe(a);
    expect(moveAt([a, b], 45)).toBe(a);
    expect(moveAt([a, b], 100)).toBe(b);
    // A new move replaces what it overlaps.
    expect(addMove([a, b], { ...a, f0: 30, f1: 55 })).toHaveLength(1);
  });

  it("round-trips through JSON; bad moves, overlaps and stray numbers are dropped or held", () => {
    const ms: Move[] = [
      { kind: "path", gait: "run", f0: 1, f1: 49, path: [[0, 0, 0], [8, 0, 1]] },
      { kind: "turn", f0: 49, f1: 61, yaw: 1.2, yaw0: 0.1, at: [8, 0, 1] },
    ];
    expect(normaliseMoves(JSON.parse(JSON.stringify(ms)), 241)).toEqual(ms);
    expect(normaliseMoves([{ kind: "path", gait: "fly", f0: 1, f1: 999, path: [[0, 0, 0], [1, 0, 0], ["x"]] }, { kind: "path", f0: 5, f1: 9, path: [[0, 0, 0], [1, 0, 0]] }, { kind: "turn", f0: 9, f1: 3 }], 241)).toEqual([
      { kind: "path", gait: "walk", f0: 1, f1: 241, path: [[0, 0, 0], [1, 0, 0]] },
    ]);
    expect(normaliseMoves("walk", 241)).toEqual([]);
    expect(moveWords(ms[0])).toBe("runs to (8, -1) frames 1–49");
  });
});
