import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildSkeleton, type BoneName } from "./studio-pose";
import { FOOT_SIDE_M, gaitFrame, naturalSeconds, pathRootAt, shortestYaw, turnFrame, turnSteps, type PathMove, type TurnMove } from "./studio-gait";

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

describe("a turn steps round instead of swivelling (2026-09-30)", () => {
  const ankleOf = (sk: ReturnType<typeof buildSkeleton>, n: "foot.L" | "foot.R") => sk.bones[n].getWorldPosition(new THREE.Vector3());
  const toeOf = (sk: ReturnType<typeof buildSkeleton>, n: "foot.L" | "foot.R") =>
    ankleOf(sk, n).add(new THREE.Vector3(0, -0.07, 0.13).applyQuaternion(sk.bones[n].getWorldQuaternion(new THREE.Quaternion())));
  const yawOf = (sk: ReturnType<typeof buildSkeleton>, n: "foot.L" | "foot.R") => new THREE.Euler().setFromQuaternion(sk.bones[n].getWorldQuaternion(new THREE.Quaternion()), "YXZ").y;

  for (const [label, yaw] of [["a quarter turn to the left", Math.PI / 2], ["a half turn to the right", -Math.PI + 0.01], ["a small one", 0.3]] as const) {
    it(`${label}: planted feet never slide or twist, the body and each foot turn a little each frame, both end side by side facing the new way`, () => {
      const m: TurnMove = { kind: "turn", f0: 1, f1: 25, yaw, yaw0: 0, at: [1, 0, 2] };
      const sk = buildSkeleton();
      let prev: { L: THREE.Vector3; R: THREE.Vector3; tL: THREE.Vector3; tR: THREE.Vector3; pL: boolean; pR: boolean; yaw: number; yL: number; yR: number } | null = null;
      let slide = 0, planted = 0, bodyStep = 0, footStep = 0, miss = 0, lifted = 0;
      for (let f = m.f0; f <= m.f1 + 2; f++) {
        const g = turnFrame(sk, { at: m.at, yaw0: m.yaw0 }, m, (f - m.f0) / FPS, FPS);
        const L = ankleOf(sk, "foot.L"), R = ankleOf(sk, "foot.R"), tL = toeOf(sk, "foot.L"), tR = toeOf(sk, "foot.R");
        miss = Math.max(miss, L.distanceTo(g.feet.L.at), R.distanceTo(g.feet.R.at));
        if (!g.feet.L.planted || !g.feet.R.planted) lifted++;
        const now = { L, R, tL, tR, pL: g.feet.L.planted, pR: g.feet.R.planted, yaw: g.yaw, yL: yawOf(sk, "foot.L"), yR: yawOf(sk, "foot.R") };
        if (prev) {
          if (now.pL && prev.pL) { slide = Math.max(slide, L.distanceTo(prev.L), tL.distanceTo(prev.tL)); planted++; }
          if (now.pR && prev.pR) { slide = Math.max(slide, R.distanceTo(prev.R), tR.distanceTo(prev.tR)); planted++; }
          bodyStep = Math.max(bodyStep, Math.abs(shortestYaw(0, now.yaw - prev.yaw)));
          footStep = Math.max(footStep, Math.abs(shortestYaw(0, now.yL - prev.yL)), Math.abs(shortestYaw(0, now.yR - prev.yR)));
        }
        prev = now;
      }
      expect(slide, "planted feet stay put").toBeLessThan(0.002);
      expect(planted).toBeGreaterThan(20);
      expect(lifted, "it steps").toBeGreaterThan(0);
      expect(miss, "the legs reach the feet").toBeLessThan(0.003);
      expect(bodyStep).toBeLessThan((20 * Math.PI) / 180);
      expect(footStep).toBeLessThan((30 * Math.PI) / 180);
      const end = turnFrame(sk, { at: m.at, yaw0: 0 }, m, 1, FPS);
      expect(Math.abs(shortestYaw(0, end.feet.L.yaw - yaw))).toBeLessThan(1e-6);
      expect(Math.abs(shortestYaw(0, end.feet.R.yaw - yaw))).toBeLessThan(1e-6);
      expect(end.feet.L.at.distanceTo(end.feet.R.at)).toBeCloseTo(2 * FOOT_SIDE_M, 3);
      expect(end.feet.L.planted && end.feet.R.planted).toBe(true);
    });
  }

  it("steps: at least one each foot, more for a bigger turn, the last two landing on the new heading", () => {
    expect(turnSteps(0.3)).toEqual([0.3, 0.3]);
    const half = turnSteps(Math.PI);
    expect(half.length).toBeGreaterThanOrEqual(6);
    expect(half.slice(-2)).toEqual([Math.PI, Math.PI]);
    for (let k = 1; k < half.length; k++) expect(half[k]).toBeGreaterThanOrEqual(half[k - 1]);
  });
});

// "She is still walking weird" (2026-10-01, take 701f3155 on the yellow-coupe set). Measured on his walk (6.9 m in
// 4.8 s, a bend round the car's nose) before the fix: the standing knee never straighter than 25–38° (the pelvis
// carried 4.5 cm low: a crouch), arms and pelvis a quarter step late (a 0.09 correlation between the left arm and
// which foot is ahead), no drop of the hip, feet landing 15–26 cm apart, and the swinging knee bending twice.
describe("a walk that reads as a person walking", () => {
  const his: PathMove = { kind: "path", gait: "walk", f0: 1, f1: 115, path: [[1.2, 0, 2.6], [4.6, 0, 4.4], [7.6, 0, 4.55]], yaw0: 1.0213616496485884 };
  const P = (sk: ReturnType<typeof buildSkeleton>, n: BoneName) => sk.bones[n].getWorldPosition(new THREE.Vector3());
  function trace(m: PathMove) {
    const sk = buildSkeleton();
    const rows: { kneeL: number; plantedL: boolean; aheadL: number; armL: number; elbowL: number; pelvisYaw: number; list: number; width: number }[] = [];
    for (let f = 30; f <= 90; f++) {
      const g = gaitFrame(sk, m, (f - m.f0) / FPS, FPS);
      const hip = P(sk, "thigh.L"), knee = P(sk, "shin.L"), ank = P(sk, "foot.L");
      const a = hip.clone().sub(knee).normalize(), b = ank.clone().sub(knee).normalize();
      const fwd = new THREE.Vector3(Math.sin(g.yaw), 0, Math.cos(g.yaw)), side = new THREE.Vector3(Math.cos(g.yaw), 0, -Math.sin(g.yaw));
      rows.push({
        kneeL: 180 - (Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180) / Math.PI,
        plantedL: g.feet.L.planted && Math.abs(g.feet.L.pitch) < 0.05,
        aheadL: P(sk, "foot.L").sub(P(sk, "foot.R")).dot(fwd),
        armL: g.pose.rot["upperArm.L"]![0],
        elbowL: g.pose.rot["forearm.L"]![0],
        pelvisYaw: g.pose.rot.pelvis![1],
        list: g.pose.rot.pelvis![2],
        width: Math.abs(P(sk, "foot.L").sub(P(sk, "foot.R")).dot(side)),
      });
    }
    return rows;
  }
  const corr = (a: number[], b: number[]) => {
    const ma = a.reduce((x, y) => x + y) / a.length, mb = b.reduce((x, y) => x + y) / b.length;
    let n = 0, da = 0, db = 0;
    a.forEach((v, i) => { n += (v - ma) * (b[i] - mb); da += (v - ma) ** 2; db += (b[i] - mb) ** 2; });
    return n / Math.sqrt(da * db);
  };

  it("each arm swings back as its own foot comes forward, and the pelvis turns with the leg in front", () => {
    const r = trace(his);
    // Positive upperArm x is back: the left arm furthest back when the left foot is furthest ahead.
    expect(corr(r.map((x) => x.aheadL), r.map((x) => x.armL))).toBeGreaterThan(0.9);
    expect(corr(r.map((x) => x.aheadL), r.map((x) => x.pelvisYaw))).toBeLessThan(-0.9);
    // The elbow bends more in front than behind.
    const front = r.filter((x) => x.armL < -10).map((x) => x.elbowL), back = r.filter((x) => x.armL > 10).map((x) => x.elbowL);
    expect(Math.max(...front)).toBeLessThan(Math.min(...back));
  });

  it("stands over a flat foot with the knee only softly bent (was 25–38°), drops the swinging hip a few degrees, steps about a foot's width apart", () => {
    const r = trace(his);
    const flat = r.filter((x) => x.plantedL).map((x) => x.kneeL);
    expect(flat.length).toBeGreaterThan(10);
    // The pelvis's wave (bobDepth) tops out 2.2 cm below the legs' full reach over the standing foot: a straighter
    // knee there would deepen the bob past ~7 cm, which reads as bouncing ("too jumpy", 2026-10-01).
    expect(Math.min(...flat)).toBeLessThan(23);
    expect(flat.sort((a, b) => a - b)[Math.floor(flat.length / 2)]).toBeLessThan(28);
    expect(Math.max(...r.map((x) => Math.abs(x.list)))).toBeGreaterThan(2.5);
    expect(Math.max(...r.map((x) => x.width))).toBeLessThan(0.2);
  });

  it("the pelvis rides one smooth wave a step: no flat top and sudden fall (it fell 3.7 cm in one frame), under 7 cm deep", () => {
    const sk = buildSkeleton();
    const y: number[] = [];
    for (let f = 1; f <= 120; f++) { gaitFrame(sk, his, (f - his.f0) / FPS, FPS); y.push(sk.bones.pelvis.getWorldPosition(new THREE.Vector3()).y); }
    const acc = y.slice(2).map((v, i) => Math.abs(v - 2 * y[i + 1] + y[i]));
    expect(Math.max(...acc)).toBeLessThan(0.016);
    expect(Math.max(...steps(y))).toBeLessThan(0.022);
    const mid = y.slice(30, 90);
    expect(Math.max(...mid) - Math.min(...mid)).toBeLessThan(0.07);
  });

  it("the swinging knee straightens steadily and lands bent: never straight just before landing, no snap after", () => {
    const sk = buildSkeleton();
    const k: number[] = [], planted: boolean[] = [];
    for (let f = 1; f <= 120; f++) {
      const g = gaitFrame(sk, his, (f - his.f0) / FPS, FPS);
      const hip = P(sk, "thigh.L"), knee = P(sk, "shin.L"), ank = P(sk, "foot.L");
      const a = hip.sub(knee).normalize(), b = ank.sub(knee).normalize();
      k.push(180 - (Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180) / Math.PI);
      planted.push(g.feet.L.planted);
    }
    for (let i = 1; i < k.length; i++) {
      if (planted[i] && !planted[i - 1]) {
        // Landing: bent at least 8° the frame before, and no more than 18° further the frame after (it went 2° → 26°).
        expect(k[i - 1]).toBeGreaterThan(8);
        expect(k[i] - k[i - 1]).toBeLessThan(18);
      }
    }
    expect(Math.max(...steps(k))).toBeLessThan(26);
  });

  it("the swinging knee folds once: from the toes leaving to its deepest bend it never opens by more than 8°", () => {
    const r = trace(his);
    let worst = 0;
    for (let i = 1; i < r.length; i++) {
      // While the left foot is off the ground and still on its way up to its deepest bend.
      if (r[i].plantedL) continue;
      const rest = r.slice(i).findIndex((x) => x.plantedL);
      const swing = r.slice(i, rest < 0 ? r.length : i + rest).map((x) => x.kneeL);
      const peak = swing.indexOf(Math.max(...swing));
      let hi = swing[0];
      for (let k = 1; k <= peak; k++) { worst = Math.max(worst, hi - swing[k]); hi = Math.max(hi, swing[k]); }
      i += swing.length;
    }
    expect(worst).toBeLessThan(8);
  });
});
