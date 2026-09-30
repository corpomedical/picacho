import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildSkeleton } from "./studio-pose";
import { gaitFrame, naturalSeconds, pathRootAt, shortestYaw, type PathMove } from "./studio-gait";

// "Why is she walking weird and jumpy?" (2026-09-30). Measured frame by frame before the fix (24 fps): the pelvis
// fell 13–18 cm in ONE frame at each step (a leg counted only while its foot was under 2 cm up), twice a stride, the
// knees snapping 40°+ — a natural 4.2 m walk bobbed 10 cm with 7 cm jumps between frames, a fast one 24 cm with
// 17.6 cm jumps, a run 11 cm with 11.8 cm jumps. Now: the feet roll heel to toe, the pelvis eases through each
// double support, the pace eases in and out, and the figure turns onto its path instead of snapping round.

const FPS = 24;
type Probe = { pelvis: number[]; knee: number[]; root: THREE.Vector3[]; yaw: number[] };
function walk(m: PathMove, pad = 3): Probe {
  const sk = buildSkeleton();
  const out: Probe = { pelvis: [], knee: [], root: [], yaw: [] };
  for (let f = m.f0 - pad; f <= m.f1 + pad; f++) {
    const g = gaitFrame(sk, m, (f - m.f0) / FPS, FPS);
    out.pelvis.push(sk.bones.pelvis.getWorldPosition(new THREE.Vector3()).y);
    out.knee.push(Math.max(g.pose.rot["shin.L"]![0], g.pose.rot["shin.R"]![0]));
    out.root.push(new THREE.Vector3(...g.pos));
    out.yaw.push(g.yaw);
  }
  return out;
}
const steps = (a: number[]) => a.slice(1).map((v, i) => Math.abs(v - a[i]));
const along = (d: number, secs = 0, gait: "walk" | "run" = "walk"): PathMove => ({
  kind: "path",
  gait,
  f0: 1,
  f1: 1 + Math.round((secs || naturalSeconds(gait, d)) * FPS),
  path: [[0, 0, 0], [0, 0, d]],
});

describe("a walk with no jumps", () => {
  it("the pelvis rises and falls a few centimetres, never more than a few in one frame", () => {
    for (const [m, bob, step] of [
      [along(4.2), 0.05, 0.04],
      [along(6), 0.05, 0.04],
      [along(7.2, 3), 0.08, 0.065],
      [along(10, 0, "run"), 0.06, 0.05],
    ] as const) {
      const p = walk(m, 0);
      const mid = p.pelvis.slice(Math.round(p.pelvis.length * 0.3), Math.round(p.pelvis.length * 0.7));
      expect(Math.max(...mid) - Math.min(...mid), `${m.gait} ${m.path[1][2]} m bob`).toBeLessThan(bob);
      expect(Math.max(...steps(p.pelvis)), `${m.gait} ${m.path[1][2]} m step`).toBeLessThan(step);
      expect(Math.max(...steps(p.knee)), `${m.gait} knee`).toBeLessThan(45);
    }
  });

  it("sets off and settles gently: the root's speed changes smoothly, from and to a standstill, and it stays put after", () => {
    const m = along(4.2);
    const p = walk(m);
    const v = p.root.slice(1).map((r, i) => r.distanceTo(p.root[i]));
    // Standing before, the first step tiny, no kick in the pace anywhere, and still after the end.
    expect(v.slice(0, 3).every((x) => x < 1e-9)).toBe(true);
    expect(v[3]).toBeLessThan(0.005);
    expect(Math.max(...steps(v))).toBeLessThan(0.01);
    expect(v[v.length - 4]).toBeLessThan(0.005);
    expect(v.slice(-3).every((x) => x < 1e-9)).toBe(true);
  });

  it("setting off facing another way, it turns onto its path over its first steps — never in one frame", () => {
    const m: PathMove = { ...along(4.2), yaw0: Math.PI };
    const p = walk(m, 0);
    expect(p.yaw[0]).toBeCloseTo(Math.PI, 6);
    const turned = p.yaw.map((y) => shortestYaw(0, y));
    expect(Math.max(...steps(turned))).toBeLessThan((20 * Math.PI) / 180);
    expect(Math.abs(shortestYaw(0, p.yaw[20]))).toBeLessThan(0.01);
  });

  it("what follows a walker (the damped Track To) reads where it stands from its move alone, the same as the gait puts it", () => {
    const m: PathMove = { kind: "path", gait: "walk", f0: 10, f1: 100, path: [[0, 0, 0], [2, 0, 2], [4, 0, 1]] };
    const sk = buildSkeleton();
    for (const f of [10, 30, 55, 80, 100]) {
      const g = gaitFrame(sk, m, (f - m.f0) / FPS, FPS);
      const r = pathRootAt(m, (f - m.f0) / FPS, FPS);
      expect(new THREE.Vector3(...r).distanceTo(new THREE.Vector3(...g.pos))).toBeLessThan(1e-9);
    }
  });
});
