// Helios Studio people that move (2026-09-30 — operator: "Pushed, keep
// going.", his other option: "Walk, run or turn along a path on the
// timeline"). Pure and relative-import only, like studio-pose.ts:
//
//   - a move: a path on the ground (two points = a straight line, more =
//     a smooth Catmull-Rom curve, walked by arc length) between a start and
//     an end frame, walked or run; or a turn to a heading over some frames;
//   - the distance walked at a time: speeding up from standing, a steady
//     pace, slowing into a stand (a trapezoid of speed);
//   - the gait at that distance: feet planted on the ground at fixed spots
//     along the path (no skating: a planted ankle does not move in the
//     world), the swing foot lifted between them, legs by two-bone IK, the
//     pelvis only as high as the planted legs reach, arms swinging against
//     the legs, a little hip sway, all fading to Stand as the pace does.
//
// The step count is rounded so the last step lands both feet side by side
// at the end, and the first starts from both feet together.

import * as THREE from "three";
import { BONE, applyPose, clampLoc, clampRot, clonePose, presetPose, solveLimb, type BoneName, type Pose, type Skeleton, type Vec3 } from "./studio-pose";

export const GAITS = {
  walk: { speed: 1.4, stride: 1.4, stance: 0.58, lift: 0.1, arm: 18, forearm: -20, lean: -3, sway: 0.022, hipYaw: 5, ramp: 0.5 },
  run: { speed: 4, stride: 2.8, stance: 0.3, lift: 0.26, arm: 42, forearm: -88, lean: -11, sway: 0.01, hipYaw: 8, ramp: 0.8 },
} as const;
export type Gait = keyof typeof GAITS;
export const GAIT_NAMES = Object.keys(GAITS) as Gait[];

/** Along a path, from f0 to f1 (timeline frames, 1-based). Points are world [x, y, z] on the ground. */
export type PathMove = { kind: "path"; gait: Gait; f0: number; f1: number; path: Vec3[] };
/** Turn in place to `yaw` (radians, three.js heading: 0 faces +Z) from f0 to f1, standing at `at` facing `yaw0` unless a path before it says otherwise. */
export type TurnMove = { kind: "turn"; f0: number; f1: number; yaw: number; yaw0: number; at: Vec3 };
export type Move = PathMove | TurnMove;

export const MOVES_MAX = 24;
export const PATH_POINTS_MAX = 32;
/** The ankle joint's height above the sole. */
export const ANKLE_M = 0.07;
/** Half the gap between the feet, from the path. */
export const FOOT_SIDE_M = 0.1;
const LEG_REACH_M = BONE["shin.L"].at[1] * -1 + BONE["foot.L"].at[1] * -1 - 0.004;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const TAU = Math.PI * 2;

// ---------------- the path ----------------

/** The path as a curve walked by arc length: a line for two points, a smooth curve through more. */
export function pathCurve(points: readonly Vec3[]): THREE.Curve<THREE.Vector3> {
  const v = points.map((p) => new THREE.Vector3(...p));
  if (v.length < 2) return new THREE.LineCurve3(v[0] ?? new THREE.Vector3(), (v[0] ?? new THREE.Vector3()).clone());
  if (v.length === 2) return new THREE.LineCurve3(v[0], v[1]);
  return new THREE.CatmullRomCurve3(v, false, "centripetal");
}
export const pathLength = (points: readonly Vec3[]) => (points.length < 2 ? 0 : pathCurve(points).getLength());

/** Seconds a gait takes over `metres` at its own pace, with its speed-up and slow-down. */
export function naturalSeconds(gait: Gait, metres: number): number {
  const g = GAITS[gait];
  return metres <= 0 ? 0 : metres / g.speed + g.ramp;
}

/**
 * How far along (metres) at `t` seconds of `T`, over `D` metres: speeding up
 * for `ramp` seconds, a steady pace, slowing for `ramp` seconds (never more
 * than half of T each). Returns the distance and the speed then.
 */
export function distanceAt(t: number, T: number, D: number, ramp: number): { d: number; v: number; cruise: number } {
  if (T <= 0 || D <= 0) return { d: t >= T ? D : 0, v: 0, cruise: 0 };
  const r = Math.min(ramp, T / 2);
  const cruise = D / (T - r);
  const tt = clamp(t, 0, T);
  if (tt < r) return { d: (cruise * tt * tt) / (2 * r), v: (cruise * tt) / r, cruise };
  if (tt > T - r) return { d: D - (cruise * (T - tt) ** 2) / (2 * r), v: (cruise * (T - tt)) / r, cruise };
  return { d: cruise * (tt - r / 2), v: cruise, cruise };
}

/** The stride (one step of each foot) at a pace, fitted so a whole number of steps ends both feet together. */
export function strideFor(gait: Gait, cruise: number, D: number): { stride: number; halfSteps: number } {
  const g = GAITS[gait];
  const want = clamp(g.stride * Math.sqrt(Math.max(cruise, 0.05) / g.speed), g.stride * 0.45, g.stride * 1.5);
  const halfSteps = Math.max(1, Math.round((2 * D) / want));
  return { stride: (2 * D) / halfSteps, halfSteps };
}

/** A heading (three.js: 0 faces +Z, π/2 faces +X) from a ground direction. */
export const headingOf = (dx: number, dz: number) => Math.atan2(dx, dz);
/** The heading `to` reached from `from` the short way round (unwrapped, so easing between them never spins). */
export function shortestYaw(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return from + d;
}
/** The yaw a turn stands at, `u` of the way (eased), from yaw0 to its target the short way round. */
export function turnYawAt(yaw0: number, yaw: number, u: number): number {
  const e = clamp(u, 0, 1);
  const s = e * e * (3 - 2 * e);
  return yaw0 + (shortestYaw(yaw0, yaw) - yaw0) * s;
}

// ---------------- feet ----------------

type FootAt = { at: THREE.Vector3; planted: boolean; lift: number; u: number };

/**
 * Where one foot's ankle is when the body has come `d` of `D` metres:
 * planted on its spot, or swinging between two spots. The left foot's
 * spots are at k·stride, the right's at (k + ½)·stride, all clamped to
 * the path's ends, so both start and end side by side.
 */
function footAt(curve: THREE.Curve<THREE.Vector3>, D: number, d: number, stride: number, stance: number, side: 1 | -1, lift: number): FootAt {
  const off = side > 0 ? 0 : 0.5;
  const spot = (c: number) => clamp(c * stride, 0, D);
  const where = (s: number) => {
    const u = D > 0 ? s / D : 0;
    const p = curve.getPointAt(u), t = curve.getTangentAt(u);
    const left = new THREE.Vector3(t.z, 0, -t.x).normalize();
    return p.add(left.multiplyScalar(FOOT_SIDE_M * side)).add(new THREE.Vector3(0, ANKLE_M, 0));
  };
  const half = (stance * stride) / 2;
  const j = Math.floor((d + half) / stride - off + 1e-9);
  const from = spot(j + off), to = spot(j + 1 + off);
  const w0 = Math.max(0, (j + off) * stride + half), w1 = Math.min(D, (j + 1 + off) * stride - half);
  if (to > from + 1e-9 && d > w0 && d < w1) {
    const u = clamp((d - w0) / (w1 - w0), 0, 1);
    const a = where(from), b = where(to);
    const up = Math.sin(Math.PI * u) * lift * Math.min(1, (to - from) / stride * 1.2);
    return { at: a.lerp(b, u).add(new THREE.Vector3(0, up, 0)), planted: false, lift: up, u };
  }
  return { at: where(to > from && d >= w1 ? to : from), planted: true, lift: 0, u: 0 };
}

// ---------------- the gait ----------------

export type GaitFrame = {
  /** Where the figure's root stands and the way it faces. */
  pos: Vec3;
  yaw: number;
  /** The pose, legs solved by IK on `sk`. */
  pose: Pose;
  /** Metres along, the speed then, and whether each foot is planted. */
  d: number;
  v: number;
  feet: { L: FootAt; R: FootAt };
};

const ARM_KEEP: readonly BoneName[] = ["neck", "head", "chest"];

/**
 * The figure at `t` seconds into a path move (clamped: before, standing at
 * the start; after, standing at the end). `sk` is the figure's own
 * skeleton, whose root is placed here (world), so IK solves in the world.
 * `upper` holds bones the person keyed that ride on top of the gait (a wave
 * while walking); neck, head and chest always come from it.
 */
export function gaitFrame(sk: Skeleton, m: PathMove, t: number, fps: number, upper: Pose = presetPose("stand"), keyed: ReadonlySet<BoneName> = new Set()): GaitFrame {
  const g = GAITS[m.gait];
  const curve = pathCurve(m.path);
  const D = m.path.length < 2 ? 0 : curve.getLength();
  const T = Math.max(1 / fps, (m.f1 - m.f0) / fps);
  const { d, v, cruise } = distanceAt(t, T, D, g.ramp);
  const { stride } = strideFor(m.gait, cruise, D);
  const s = cruise > 0 ? clamp(v / cruise, 0, 1) : 0;
  const u = D > 0 ? d / D : 0;
  const p = D > 0 ? curve.getPointAt(u) : new THREE.Vector3(...(m.path[0] ?? [0, 0, 0]));
  const tan = D > 0 ? curve.getTangentAt(u) : new THREE.Vector3(0, 0, 1);
  const yaw = headingOf(tan.x, tan.z);
  sk.root.position.copy(p);
  sk.root.rotation.set(0, yaw, 0);
  sk.root.updateMatrixWorld(true);
  const phase = stride > 0 ? d / stride : 0;
  const c = Math.cos(TAU * phase);
  // The upper body: the stand, arms swinging against the legs, the spine leaning into the pace.
  const stand = presetPose("stand");
  const pose: Pose = { rot: { ...stand.rot }, loc: [0, 0, 0] };
  const put = (n: BoneName, v3: Vec3) => (pose.rot[n] = clampRot(n, v3));
  put("upperArm.L", [-g.arm * s * c, 0, 6]);
  put("upperArm.R", [g.arm * s * c, 0, 6]);
  put("forearm.L", [-8 + (g.forearm + 8) * s - 6 * s * Math.max(0, -c), 0, 0]);
  put("forearm.R", [-8 + (g.forearm + 8) * s - 6 * s * Math.max(0, c), 0, 0]);
  put("pelvis", [0, g.hipYaw * s * c, 0]);
  put("spine", [g.lean * s, -g.hipYaw * 0.8 * s * c, 0]);
  for (const n of ARM_KEEP) if (upper.rot[n]) pose.rot[n] = [...upper.rot[n]!] as Vec3;
  for (const n of keyed) if (upper.rot[n] && !/^(thigh|shin|foot)|^pelvis$|^spine$/.test(n)) pose.rot[n] = [...upper.rot[n]!] as Vec3;
  pose.loc = [g.sway * s * c, 0, 0];
  // The feet: planted spots and the swing between them.
  const L = footAt(curve, D, d, stride, g.stance, 1, g.lift);
  const R = footAt(curve, D, d, stride, g.stance, -1, g.lift);
  // The pelvis only as high as a planted leg reaches (hips measured with the pelvis at rest height).
  applyPose(sk, pose);
  let drop = 0;
  for (const [f, hip] of [[L, "thigh.L"], [R, "thigh.R"]] as const) {
    const h = sk.bones[hip].getWorldPosition(new THREE.Vector3());
    const hd = Math.hypot(h.x - f.at.x, h.z - f.at.z);
    const top = f.at.y + Math.sqrt(Math.max(0, LEG_REACH_M * LEG_REACH_M - hd * hd));
    if (f.planted || f.lift < 0.02) drop = Math.min(drop, top - h.y);
  }
  // A little bounce at a run's flight, none at a stand.
  pose.loc = clampLoc([pose.loc[0], drop - (m.gait === "run" ? 0.03 * s : 0.008 * s), 0]);
  solveLimb(sk, pose, "leg.L", L.at);
  solveLimb(sk, pose, "leg.R", R.at);
  // Feet level with the ground and facing the way of travel (toes down a little as a swing foot leaves).
  for (const [f, n] of [[L, "foot.L"], [R, "foot.R"]] as const) {
    const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(f.planted ? 0 : 0.35 * Math.sin(Math.PI * f.u) * s, yaw, 0, "YXZ"));
    const parent = sk.bones[n].parent!.getWorldQuaternion(new THREE.Quaternion());
    const e = new THREE.Euler().setFromQuaternion(parent.invert().multiply(want), "XYZ");
    const mirror = n.endsWith(".R") ? -1 : 1;
    pose.rot[n] = clampRot(n, [(e.x * 180) / Math.PI, ((e.y * 180) / Math.PI) * mirror, ((e.z * 180) / Math.PI) * mirror]);
  }
  applyPose(sk, pose);
  return { pos: [p.x, p.y, p.z], yaw, pose, d, v, feet: { L, R } };
}

/** The move that drives a figure at frame `f`: the one running then, else the last one finished (null before the first). */
export function moveAt(moves: readonly Move[], f: number): Move | null {
  let last: Move | null = null;
  for (const m of moves) {
    if (f >= m.f0 && f <= m.f1) return m;
    if (f > m.f1) last = m;
  }
  return last;
}

/** Where a path move ends and the way it faces there. */
export function pathEnd(m: PathMove): { at: Vec3; yaw: number } {
  const c = pathCurve(m.path), D = m.path.length < 2 ? 0 : c.getLength();
  const p = m.path[m.path.length - 1] ?? [0, 0, 0];
  const t = D > 0 ? c.getTangentAt(1) : new THREE.Vector3(0, 0, 1);
  return { at: [...p] as Vec3, yaw: headingOf(t.x, t.z) };
}

/** A turn's standing spot and starting heading: where the path before it ended, else what it recorded. */
export function turnStart(moves: readonly Move[], m: TurnMove): { at: Vec3; yaw0: number } {
  let prev: Move | null = null;
  for (const x of moves) if (x !== m && x.f1 <= m.f0 && (!prev || x.f1 >= prev.f1)) prev = x;
  if (prev?.kind === "path") { const e = pathEnd(prev); return { at: e.at, yaw0: e.yaw }; }
  if (prev?.kind === "turn") { const s = turnStart(moves, prev); return { at: s.at, yaw0: shortestYaw(s.yaw0, prev.yaw) }; }
  return { at: m.at, yaw0: m.yaw0 };
}

/** Moves as saved: checked, sorted by start, never overlapping (a later one that overlaps is dropped), at most MOVES_MAX. */
export function normaliseMoves(raw: unknown, lastFrame: number): Move[] {
  if (!Array.isArray(raw)) return [];
  const out: Move[] = [];
  const v3 = (v: unknown): Vec3 | null => (Array.isArray(v) && v.length === 3 && v.every((x) => num(x) !== null) ? (v.map((x) => clamp(x as number, -5000, 5000)) as Vec3) : null);
  for (const r of raw.slice(0, MOVES_MAX * 2)) {
    const o = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
    const f0 = num(o.f0), f1 = num(o.f1);
    if (f0 === null || f1 === null) continue;
    const a = Math.round(clamp(f0, 1, lastFrame)), b = Math.round(clamp(f1, 1, lastFrame));
    if (b <= a) continue;
    if (o.kind === "path") {
      const pts = (Array.isArray(o.path) ? o.path : []).slice(0, PATH_POINTS_MAX).map(v3).filter((x): x is Vec3 => x !== null);
      const gait = o.gait === "run" ? "run" : "walk";
      if (pts.length >= 2) out.push({ kind: "path", gait, f0: a, f1: b, path: pts });
    } else if (o.kind === "turn") {
      const yaw = num(o.yaw), yaw0 = num(o.yaw0), at = v3(o.at);
      if (yaw !== null && yaw0 !== null && at) out.push({ kind: "turn", f0: a, f1: b, yaw: clamp(yaw, -100, 100), yaw0: clamp(yaw0, -100, 100), at });
    }
  }
  out.sort((x, y) => x.f0 - y.f0);
  const kept: Move[] = [];
  for (const m of out) if (!kept.length || m.f0 >= kept[kept.length - 1].f1) kept.push(m);
  return kept.slice(0, MOVES_MAX);
}

/** `moves` with `m` added, dropping any it overlaps. */
export function addMove(moves: readonly Move[], m: Move): Move[] {
  return [...moves.filter((x) => x.f1 <= m.f0 || x.f0 >= m.f1), m].sort((a, b) => a.f0 - b.f0);
}

/** The end frame for a gait over a path from `f0` at its own pace (at least half a second, at most `lastFrame`). */
export function naturalEnd(gait: Gait, points: readonly Vec3[], f0: number, fps: number, lastFrame: number): number {
  return Math.min(lastFrame, f0 + Math.max(Math.round(fps / 2), Math.round(naturalSeconds(gait, pathLength(points)) * fps)));
}

/** A move in a few words for Astra's scene summary (Blender axes: x, −z). */
export function moveWords(m: Move): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  if (m.kind === "turn") return `turns to ${Math.round((((m.yaw * 180) / Math.PI) % 360 + 360) % 360)}° frames ${m.f0}–${m.f1}`;
  const e = m.path[m.path.length - 1];
  return `${m.gait === "run" ? "runs" : "walks"} to (${r(e[0])}, ${r(-e[2])}) frames ${m.f0}–${m.f1}`;
}

export { clonePose };
