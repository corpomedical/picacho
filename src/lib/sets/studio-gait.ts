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
  walk: { speed: 1.4, stride: 1.24, stance: 0.58, lift: 0.1, arm: 22, forearm: -18, elbow: 16, lean: -3, sway: 0.022, hipYaw: 6, list: 4, ramp: 0.5, heel: 0.85, strike: 0.3, crouch: 0.02 },
  run: { speed: 4, stride: 2.8, stance: 0.3, lift: 0.26, arm: 42, forearm: -88, elbow: 6, lean: -11, sway: 0.01, hipYaw: 8, list: 3, ramp: 0.8, heel: 0.6, strike: 0.2, crouch: 0.07 },
} as const;
export type Gait = keyof typeof GAITS;
export const GAIT_NAMES = Object.keys(GAITS) as Gait[];

/** Along a path, from f0 to f1 (timeline frames, 1-based). Points are world [x, y, z] on the ground. */
export type PathMove = {
  kind: "path";
  gait: Gait;
  f0: number;
  f1: number;
  path: Vec3[];
  /** The way the figure faced when it set off (radians): it turns onto the path over its first steps instead of snapping. */
  yaw0?: number;
};
/** Turn in place to `yaw` (radians, three.js heading: 0 faces +Z) from f0 to f1, standing at `at` facing `yaw0` unless a path before it says otherwise. */
export type TurnMove = { kind: "turn"; f0: number; f1: number; yaw: number; yaw0: number; at: Vec3 };
export type Move = PathMove | TurnMove;

export const MOVES_MAX = 24;
export const PATH_POINTS_MAX = 32;
/** The ankle joint's height above the sole. */
export const ANKLE_M = 0.07;
/** Half the gap between the feet, from the path. */
export const FOOT_SIDE_M = 0.065;
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
 *
 * The speed eases in and out (smoothstep, 2026-09-30 — "walking weird and
 * jumpy"): no kick in the acceleration as the figure sets off, reaches its
 * pace, or settles into a stand. Each ramp covers cruise·r/2, as a straight
 * ramp does, so the pace and the timing are unchanged.
 */
export function distanceAt(t: number, T: number, D: number, ramp: number): { d: number; v: number; cruise: number } {
  if (T <= 0 || D <= 0) return { d: t >= T ? D : 0, v: 0, cruise: 0 };
  const r = Math.min(ramp, T / 2);
  const cruise = D / (T - r);
  const tt = clamp(t, 0, T);
  const up = (x: number) => ({ d: cruise * r * (x ** 3 - x ** 4 / 2), v: cruise * x * x * (3 - 2 * x) });
  if (tt < r) return { ...up(tt / r), cruise };
  if (tt > T - r) {
    const e = up((T - tt) / r);
    return { d: D - e.d, v: e.v, cruise };
  }
  return { d: cruise * (tt - r / 2), v: cruise, cruise };
}

/** The stride (one step of each foot) at a pace, fitted so a whole number of steps ends both feet together. */
export function strideFor(gait: Gait, cruise: number, D: number): { stride: number; halfSteps: number } {
  const g = GAITS[gait];
  // Never much longer than the gait's own stride: past that the legs can't reach, and a faster pace takes quicker steps instead.
  const want = clamp(g.stride * Math.sqrt(Math.max(cruise, 0.05) / g.speed), g.stride * 0.45, g.stride * 1.1);
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

/** Where the ankle is, and the foot's pitch (radians, + toes down); `contact` is the point on the ground a planted foot rolls on (heel or ball), which never moves. */
type FootAt = { at: THREE.Vector3; planted: boolean; lift: number; u: number; pitch: number; yaw: number; contact: THREE.Vector3 | null };
/** From the ankle to the ball of the foot, along it. */
export const TOE_M = 0.13;
/** From the ankle back to the heel's contact, along it. */
export const HEEL_M = 0.05;
const smooth = (x: number) => { const k = clamp(x, 0, 1); return k * k * (3 - 2 * k); };
/** A swinging ankle's height through its swing, 0 at both ends and 1 at its top (u ≈ 0.38). */
export const swingLift = (u: number) => (Math.sin(Math.PI * clamp(u, 0, 1)) * Math.pow(1 - clamp(u, 0, 1), 0.8)) / 0.6334;

/**
 * Where one foot's ankle is when the body has come `d` of `D` metres:
 * planted on its spot, or swinging between two spots. The left foot's
 * spots are at k·stride, the right's at (k + ½)·stride, all clamped to
 * the path's ends, so both start and end side by side.
 */
function footAt(curve: THREE.Curve<THREE.Vector3>, D: number, d: number, stride: number, stance: number, side: 1 | -1, lift: number, heelMax = 0, strikeMax = 0, startYaw: number | null = null): FootAt {
  const off = side > 0 ? 0 : 0.5;
  const spot = (c: number) => clamp(c * stride, 0, D);
  // Where it set off, the feet stand the way the figure faced then (startYaw), not the path's way.
  const tanAt = (s: number) =>
    s <= 1e-9 && startYaw !== null ? new THREE.Vector3(Math.sin(startYaw), 0, Math.cos(startYaw)) : (D > 0 ? curve.getTangentAt(clamp(s / D, 0, 1)) : new THREE.Vector3(0, 0, 1)).setY(0).normalize();
  const where = (s: number) => {
    const u = D > 0 ? s / D : 0;
    const p = curve.getPointAt(u), t = tanAt(s);
    const left = new THREE.Vector3(t.z, 0, -t.x).normalize();
    return p.add(left.multiplyScalar(FOOT_SIDE_M * side)).add(new THREE.Vector3(0, ANKLE_M, 0));
  };
  const half = (stance * stride) / 2;
  // The foot rolls (2026-09-30): it lands on its heel, toes up, and rolls flat; as the body passes
  // over it the heel rises and it rolls on its ball. The point it rolls on stays put, and the leg
  // in front and the leg behind both reach further, so the pelvis needn't sink at each step.
  const heelAt = (behind: number) =>
    behind >= 0 ? heelMax * smooth((behind - 0.08) / Math.max(0.02, half - 0.08)) : -strikeMax * smooth((-behind - 0.08) / Math.max(0.02, half - 0.08));
  const headingAt = (s: number) => { const t = tanAt(s); return headingOf(t.x, t.z); };
  const contactOf = (s: number, th: number) => where(s).add(tanAt(s).multiplyScalar(th >= 0 ? TOE_M : -HEEL_M)).setY(0);
  const rolled = (s: number, th: number) => {
    const t = tanAt(s), c = contactOf(s, th);
    // The ankle from the contact point (along the foot, and up), turned by th about the contact.
    const k = th >= 0 ? -TOE_M : HEEL_M;
    return c.add(t.multiplyScalar(k * Math.cos(th) + ANKLE_M * Math.sin(th))).add(new THREE.Vector3(0, -k * Math.sin(th) + ANKLE_M * Math.cos(th), 0));
  };
  const j = Math.floor((d + half) / stride - off + 1e-9);
  const from = spot(j + off), to = spot(j + 1 + off);
  const w0 = Math.max(0, (j + off) * stride + half), w1 = Math.min(D, (j + 1 + off) * stride - half);
  if (to > from + 1e-9 && d > w0 && d < w1) {
    const u = clamp((d - w0) / (w1 - w0), 0, 1);
    // The swing leaves from the rolled foot and lands flat, gently (smoothstep), never at full speed from a standstill.
    const th0 = heelAt(w0 - from), th1 = heelAt(w1 - to);
    const a = rolled(from, th0), b = rolled(to, th1);
    // Highest early in the swing (u ≈ 0.38), as the knee folds straight after the toes leave, then lower as the
    // leg reaches forward: a single bend of the knee through the swing, not two (2026-10-01).
    const up = swingLift(u) * lift * Math.min(1, (to - from) / stride * 1.2);
    const y0 = headingAt(from), y1 = shortestYaw(y0, headingAt(to));
    return { at: a.lerp(b, smooth(u)).add(new THREE.Vector3(0, up, 0)), planted: false, lift: up, u, pitch: th0 + (th1 - th0) * smooth(u), yaw: y0 + (y1 - y0) * smooth(u), contact: null };
  }
  const at = to > from && d >= w1 ? to : from;
  const th = heelAt(d - at);
  // A planted foot keeps the heading of its spot on the path (it doesn't twist on the ground as the body turns).
  return { at: rolled(at, th), planted: true, lift: 0, u: 0, pitch: th, yaw: headingAt(at), contact: contactOf(at, th) };
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
/** The hip joints from the figure's root, at rest. */
const HIP_X = Math.abs(BONE["thigh.L"].at[0]);
const HIP_Y = BONE.pelvis.at[1] + BONE["thigh.L"].at[1];
/**
 * How far the pelvis must sit below rest (≤ 0) for both legs to reach their feet when the body has come
 * `d` metres — the hips placed from the path (no sway), for the smoothing in gaitFrame.
 */
function legRoom(curve: THREE.Curve<THREE.Vector3>, D: number, d: number, stride: number, g: (typeof GAITS)[Gait], s: number, startYaw: number | null): number {
  const dd = clamp(d, 0, D);
  const p = curve.getPointAt(dd / D), t = curve.getTangentAt(dd / D).setY(0).normalize();
  const left = new THREE.Vector3(t.z, 0, -t.x).normalize();
  // The pelvis turns with the legs (hipYaw) and sways over the standing foot, as gaitFrame poses it.
  const c = Math.cos(TAU * (stride > 0 ? dd / stride : 0)), sw = Math.sin(TAU * (stride > 0 ? dd / stride : 0));
  const turn = ((g.hipYaw * s * sw) * Math.PI) / 180, list = ((g.list * s * c) * Math.PI) / 180;
  const centre = p.clone().add(left.clone().multiplyScalar(g.sway * s * c));
  let room = 0;
  for (const side of [1, -1] as const) {
    const f = footAt(curve, D, dd, stride, g.stance, side, g.lift, g.heel, g.strike, startYaw);
    const hip = centre.clone().add(left.clone().multiplyScalar(HIP_X * side * Math.cos(turn))).add(t.clone().multiplyScalar(-HIP_X * side * Math.sin(turn)));
    const hd = Math.hypot(hip.x - f.at.x, hip.z - f.at.z);
    const top = f.at.y + Math.sqrt(Math.max(0, LEG_REACH_M * LEG_REACH_M - hd * hd));
    room = Math.min(room, top - (p.y + HIP_Y + HIP_X * side * Math.sin(list)) + (1 - swingHold(f)) * SWING_SLACK_M);
  }
  return room;
}
/** How far a swinging leg's hold on the pelvis is relaxed at mid-swing. */
const SWING_SLACK_M = 0.3;
/** How much a foot holds the pelvis down: fully while planted, fading out over the first and in over the last fifth of a swing. */
export function swingHold(f: { planted: boolean; u: number }): number {
  if (f.planted) return 1;
  const e = (x: number) => { const k = clamp(x, 0, 1); return k * k * (3 - 2 * k); };
  return Math.max(1 - e(f.u / 0.2), e((f.u - 0.8) / 0.2));
}

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
  const pathYaw = headingOf(tan.x, tan.z);
  // Setting off facing another way, the body turns onto the path over its first steps (eased), never in one frame.
  const startYaw = num(m.yaw0);
  const turnS = Math.min(0.6, T / 2);
  const yaw = startYaw === null ? pathYaw : startYaw + (shortestYaw(startYaw, pathYaw) - startYaw) * smooth(t / turnS);
  sk.root.position.copy(p);
  sk.root.rotation.set(0, yaw, 0);
  sk.root.updateMatrixWorld(true);
  const phase = stride > 0 ? d / stride : 0;
  // c peaks at each mid-stance (the left foot under the body at +1, the right at -1); sw peaks where the legs are
  // furthest apart (the right foot ahead at +1, the left at -1). Arms and the pelvis's turn follow sw — each arm
  // furthest forward as the OTHER foot lands — and the sway and the hip's drop follow c (2026-10-01, operator: "She
  // is still walking weird": they had followed c, a quarter step late, measured as a 0.09 correlation between the
  // left arm and which foot is ahead).
  const c = Math.cos(TAU * phase), sw = Math.sin(TAU * phase);
  // The upper body: the stand, arms swinging against the legs, the spine leaning into the pace.
  const stand = presetPose("stand");
  const pose: Pose = { rot: { ...stand.rot }, loc: [0, 0, 0] };
  const put = (n: BoneName, v3: Vec3) => (pose.rot[n] = clampRot(n, v3));
  put("upperArm.L", [-g.arm * s * sw, 0, 6]);
  put("upperArm.R", [g.arm * s * sw, 0, 6]);
  // An elbow bends more as its arm swings forward, and opens as it swings back.
  put("forearm.L", [-8 + (g.forearm + 8) * s - g.elbow * s * Math.max(0, sw), 0, 0]);
  put("forearm.R", [-8 + (g.forearm + 8) * s - g.elbow * s * Math.max(0, -sw), 0, 0]);
  // The pelvis turns with the leg in front and drops a few degrees on the swinging side; the spine turns and
  // tilts back against both, so the shoulders turn with the arms and stay level.
  put("pelvis", [0, g.hipYaw * s * sw, g.list * s * c]);
  put("spine", [g.lean * s, -g.hipYaw * 0.8 * s * sw, -g.list * 0.8 * s * c]);
  for (const n of ARM_KEEP) if (upper.rot[n]) pose.rot[n] = [...upper.rot[n]!] as Vec3;
  for (const n of keyed) if (upper.rot[n] && !/^(thigh|shin|foot)|^pelvis$|^spine$/.test(n)) pose.rot[n] = [...upper.rot[n]!] as Vec3;
  pose.loc = [g.sway * s * c, 0, 0];
  // The feet: planted spots and the swing between them.
  const L = footAt(curve, D, d, stride, g.stance, 1, g.lift, g.heel, g.strike, startYaw);
  const R = footAt(curve, D, d, stride, g.stance, -1, g.lift, g.heel, g.strike, startYaw);
  // The pelvis only as high as a planted leg reaches (hips measured with the pelvis at rest height).
  // A swinging leg lets go of the pelvis gradually as it leaves the ground and takes it back as it
  // lands (swingHold), so the height is continuous: it used to count a foot only while it was planted
  // or under 2 cm up, and the pelvis fell 13–18 cm in one frame at every step, the knees snapping 40°+
  // (2026-09-30 — "Why is she walking weird and jumpy?").
  //
  // And the pelvis eases through each double support instead of dropping into it: the lowest the legs
  // allow is taken over a short stretch of the path either side (±W) and averaged, which never rises
  // above what the legs allow here (every sample of the average is a minimum over a stretch holding
  // this point) and turns the one-frame V at each landing into a gentle dip.
  applyPose(sk, pose);
  let drop = 0;
  for (const [f, hip] of [[L, "thigh.L"], [R, "thigh.R"]] as const) {
    const h = sk.bones[hip].getWorldPosition(new THREE.Vector3());
    const hd = Math.hypot(h.x - f.at.x, h.z - f.at.z);
    const top = f.at.y + Math.sqrt(Math.max(0, LEG_REACH_M * LEG_REACH_M - hd * hd));
    drop = Math.min(drop, top - h.y + (1 - swingHold(f)) * SWING_SLACK_M);
  }
  if (D > 0) {
    const W = clamp((0.9 * cruise) / fps, 0.02, 0.2), step = W / 3;
    const raw: number[] = [];
    for (let i = -6; i <= 6; i++) raw.push(legRoom(curve, D, d + i * step, stride, g, s, startYaw));
    let sum = 0, wsum = 0;
    for (let k = -3; k <= 3; k++) {
      let lo = Infinity;
      for (let j = -3; j <= 3; j++) lo = Math.min(lo, raw[k + j + 6]);
      const w = 4 - Math.abs(k);
      sum += lo * w; wsum += w;
    }
    drop = Math.min(drop, sum / wsum);
  }
  // A little bounce at a run's flight, none at a stand.
  // Knees a little soft at pace (the pelvis carried `crouch` lower), so the rise and fall of each step
  // stays a few centimetres; lower only where a leg needs it.
  pose.loc = clampLoc([pose.loc[0], Math.min(drop, -g.crouch * s), 0]);
  // Knees point the way each foot does, so a foot planted on a curve doesn't have to twist past its ankle's reach.
  const kneeTo = (f: FootAt, x: number): Vec3 => {
    const dy = clamp(shortestYaw(yaw, f.yaw) - yaw, -0.45, 0.45);
    return [x * Math.cos(dy) + Math.sin(dy), 0, -x * Math.sin(dy) + Math.cos(dy)];
  };
  solveLimb(sk, pose, "leg.L", L.at, kneeTo(L, 0.1));
  solveLimb(sk, pose, "leg.R", R.at, kneeTo(R, -0.1));
  // Feet level with the ground and facing the way of travel (toes down a little as a swing foot leaves).
  for (const [f, n] of [[L, "foot.L"], [R, "foot.R"]] as const) {
    const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(f.pitch + (f.planted ? 0 : 0.35 * Math.sin(Math.PI * f.u) * s), shortestYaw(yaw, f.yaw), 0, "YXZ"));
    const parent = sk.bones[n].parent!.getWorldQuaternion(new THREE.Quaternion());
    const e = new THREE.Euler().setFromQuaternion(parent.invert().multiply(want), "XYZ");
    const mirror = n.endsWith(".R") ? -1 : 1;
    pose.rot[n] = clampRot(n, [(e.x * 180) / Math.PI, ((e.y * 180) / Math.PI) * mirror, ((e.z * 180) / Math.PI) * mirror]);
  }
  applyPose(sk, pose);
  return { pos: [p.x, p.y, p.z], yaw, pose, d, v, feet: { L, R } };
}

// ---------------- turning on the spot, in steps (2026-09-30, operator: "Pushed keep going") ----------------
//
// A turn used to swivel the whole figure on its planted feet. Now it steps round: the feet re-plant in small
// alternating steps (the foot on the side it turns towards first), each one lifted and set down at its new
// heading while the other stays exactly where it stands; the body turns smoothly between them, and both feet
// end side by side facing the new way.

/** The most a foot turns in one step on the spot. */
const TURN_STEP_RAD = (35 * Math.PI) / 180;
const TURN_LIFT_M = 0.05;

/** How many steps a turn of `delta` radians takes (at least two: one each foot), and each step's heading, from the start. */
export function turnSteps(delta: number): number[] {
  const n = Math.max(2, Math.ceil(Math.abs(delta) / TURN_STEP_RAD) + 1);
  // Step k takes its foot to yaw0 + delta·min(1, (k+1)/(n−1)): the last two both land on the new heading.
  return Array.from({ length: n }, (_, k) => delta * Math.min(1, (k + 1) / (n - 1)));
}

export type TurnFrame = { yaw: number; pose: Pose; feet: { L: { at: THREE.Vector3; planted: boolean; yaw: number }; R: { at: THREE.Vector3; planted: boolean; yaw: number } } };

/**
 * The figure `t` seconds into a turn on the spot at `start.at`, from `start.yaw0` to the move's yaw (the short
 * way round). `upper` gives the bones above the legs. The root is placed here (world), so IK solves in the world.
 */
export function turnFrame(sk: Skeleton, start: { at: Vec3; yaw0: number }, m: TurnMove, t: number, fps: number, upper: Pose = presetPose("stand")): TurnFrame {
  const T = Math.max(1 / fps, (m.f1 - m.f0) / fps);
  const delta = shortestYaw(start.yaw0, m.yaw) - start.yaw0;
  const u = clamp(t / T, 0, 1);
  const yaw = start.yaw0 + delta * smooth(u);
  const at = new THREE.Vector3(...start.at);
  sk.root.position.copy(at);
  sk.root.rotation.set(0, yaw, 0);
  sk.root.updateMatrixWorld(true);
  const steps = Math.abs(delta) < 1e-3 ? [] : turnSteps(delta);
  // The foot on the side it turns towards leads: a turn to the left (yaw growing) steps the left foot first.
  const lead: 1 | -1 = delta >= 0 ? 1 : -1;
  const slot = steps.length ? 1 / steps.length : 1;
  const footOf = (side: 1 | -1) => {
    let from = 0, to = 0, lift = 0, planted = true, w = 0;
    steps.forEach((h, k) => {
      const mover: 1 | -1 = k % 2 === 0 ? lead : (-lead as 1 | -1);
      if (mover !== side) return;
      const a = k * slot, b = (k + 1) * slot;
      if (u >= b) from = to = h;
      else if (u > a) { to = h; w = smooth((u - a) / (b - a)); planted = false; lift = Math.sin(Math.PI * w) * TURN_LIFT_M; }
    });
    const heading = start.yaw0 + from + (to - from) * w;
    const left = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
    return { at: at.clone().add(left.multiplyScalar(FOOT_SIDE_M * side)).add(new THREE.Vector3(0, ANKLE_M + lift, 0)), planted, yaw: heading };
  };
  const L = footOf(1), R = footOf(-1);
  const pose: Pose = clonePose(upper);
  pose.loc = [0, 0, 0];
  applyPose(sk, pose);
  // The pelvis only as low as a planted leg needs (the feet stay under the hips, so hardly at all).
  let drop = 0;
  for (const [f, hip] of [[L, "thigh.L"], [R, "thigh.R"]] as const) {
    if (!f.planted) continue;
    const h = sk.bones[hip].getWorldPosition(new THREE.Vector3());
    const hd = Math.hypot(h.x - f.at.x, h.z - f.at.z);
    drop = Math.min(drop, f.at.y + Math.sqrt(Math.max(0, LEG_REACH_M * LEG_REACH_M - hd * hd)) - h.y);
  }
  pose.loc = clampLoc([0, Math.min(drop, -0.01 * (steps.length ? Math.sin(Math.PI * u) : 0)), 0]);
  const kneeTo = (f: { yaw: number }, x: number): Vec3 => {
    const dy = clamp(shortestYaw(yaw, f.yaw) - yaw, -0.6, 0.6);
    return [x * Math.cos(dy) + Math.sin(dy), 0, -x * Math.sin(dy) + Math.cos(dy)];
  };
  solveLimb(sk, pose, "leg.L", L.at, kneeTo(L, 0.1));
  solveLimb(sk, pose, "leg.R", R.at, kneeTo(R, -0.1));
  // Each foot flat and facing its own heading.
  for (const [f, n] of [[L, "foot.L"], [R, "foot.R"]] as const) {
    const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(f.planted ? 0 : 0.12 * Math.sin(Math.PI * clamp((f.at.y - ANKLE_M) / TURN_LIFT_M, 0, 1)), shortestYaw(yaw, f.yaw), 0, "YXZ"));
    const parent = sk.bones[n].parent!.getWorldQuaternion(new THREE.Quaternion());
    const e = new THREE.Euler().setFromQuaternion(parent.invert().multiply(want), "XYZ");
    const mirror = n.endsWith(".R") ? -1 : 1;
    pose.rot[n] = clampRot(n, [(e.x * 180) / Math.PI, ((e.y * 180) / Math.PI) * mirror, ((e.z * 180) / Math.PI) * mirror]);
  }
  applyPose(sk, pose);
  return { yaw, pose, feet: { L, R } };
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

/** Where a path move's figure stands (its root, on the ground) `t` seconds in — no pose, for things that follow it. */
export function pathRootAt(m: PathMove, t: number, fps: number): Vec3 {
  const curve = pathCurve(m.path);
  const D = m.path.length < 2 ? 0 : curve.getLength();
  if (D <= 0) return [...(m.path[0] ?? [0, 0, 0])] as Vec3;
  const T = Math.max(1 / fps, (m.f1 - m.f0) / fps);
  const p = curve.getPointAt(clamp(distanceAt(t, T, D, GAITS[m.gait].ramp).d / D, 0, 1));
  return [p.x, p.y, p.z];
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
      const yaw0 = num(o.yaw0);
      if (pts.length >= 2) out.push({ kind: "path", gait, f0: a, f1: b, path: pts, ...(yaw0 !== null ? { yaw0: clamp(yaw0, -100, 100) } : {}) });
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
