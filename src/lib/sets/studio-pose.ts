// Helios Studio people (2026-09-30 — operator picked "Posable people"): the
// grey stand-in becomes a person you pose arm by arm and leg by leg, the way
// Blender's Pose Mode poses a rig. This module is the rig itself, pure and
// relative-import only (the engine bundle and the tests import it directly):
//
//   - the skeleton: 17 bones from the pelvis to the feet, human proportions
//     at 1.75 m, each with its joint limits;
//   - a pose: each bone's rotation in degrees plus the pelvis's offset, in
//     the figure's own frame (it faces +Z, its left is +X). Right-side bones
//     take their left twin's numbers mirrored, so "upper arm Z 90" raises
//     either arm out to the side, as a mirrored Blender rig reads;
//   - two-bone IK (hand or foot moves the whole limb), the presets, looking
//     at something, keyframes between poses, and the plain words the image
//     engine is sent for a pose ("sitting on the red car, waving with the
//     right hand, looking at the camera").

import * as THREE from "three";

export type Vec3 = [number, number, number];
type Range = readonly [number, number];

export const BONE_NAMES = [
  "pelvis",
  "spine",
  "chest",
  "neck",
  "head",
  "shoulder.L",
  "upperArm.L",
  "forearm.L",
  "hand.L",
  "shoulder.R",
  "upperArm.R",
  "forearm.R",
  "hand.R",
  "thigh.L",
  "shin.L",
  "foot.L",
  "thigh.R",
  "shin.R",
  "foot.R",
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

export type BoneDef = {
  name: BoneName;
  parent: BoneName | null;
  /** The joint, from the parent's joint, standing at rest (metres, figure frame). */
  at: Vec3;
  /** Where the bone ends, from its own joint (for the segment and the overlay). */
  tail: Vec3;
  /** Rotation limits in degrees per axis, the left side's (the right mirrors them). */
  limits: readonly [Range, Range, Range];
  /** Its name in words. */
  label: string;
};

const L = (v: Vec3, side: "L" | "R"): Vec3 => (side === "L" ? v : [-v[0], v[1], v[2]]);
const sided = (base: string, side: "L" | "R", parent: string | null, at: Vec3, tail: Vec3, limits: BoneDef["limits"], label: string): BoneDef => ({
  name: `${base}.${side}` as BoneName,
  parent: parent as BoneName | null,
  at: L(at, side),
  tail: L(tail, side),
  limits,
  label: `${side === "L" ? "Left" : "Right"} ${label}`,
});

const ARM = (s: "L" | "R"): BoneDef[] => [
  sided("shoulder", s, "chest", [0.03, 0.19, 0], [0.16, 0.02, 0], [[-20, 20], [-25, 25], [-15, 30]], "shoulder"),
  sided("upperArm", s, `shoulder.${s}`, [0.16, 0.02, 0], [0, -0.29, 0], [[-180, 70], [-100, 100], [-45, 180]], "upper arm"),
  sided("forearm", s, `upperArm.${s}`, [0, -0.29, 0], [0, -0.25, 0], [[-150, 0], [-90, 90], [0, 0]], "forearm"),
  sided("hand", s, `forearm.${s}`, [0, -0.25, 0], [0, -0.18, 0], [[-80, 70], [-30, 30], [-40, 40]], "hand"),
];
const LEG = (s: "L" | "R"): BoneDef[] => [
  sided("thigh", s, "pelvis", [0.095, -0.02, 0], [0, -0.42, 0], [[-125, 40], [-50, 50], [-35, 70]], "thigh"),
  sided("shin", s, `thigh.${s}`, [0, -0.42, 0], [0, -0.42, 0], [[0, 150], [-10, 10], [0, 0]], "shin"),
  sided("foot", s, `shin.${s}`, [0, -0.42, 0], [0, -0.06, 0.16], [[-50, 45], [-25, 25], [-20, 20]], "foot"),
];

/** The skeleton, parents first. The ankle stands 7 cm up, the head's top at 1.75 m. */
export const BONES: readonly BoneDef[] = [
  { name: "pelvis", parent: null, at: [0, 0.93, 0], tail: [0, 0.07, 0], limits: [[-100, 100], [-180, 180], [-100, 100]], label: "Pelvis" },
  { name: "spine", parent: "pelvis", at: [0, 0.07, 0], tail: [0, 0.22, 0], limits: [[-45, 30], [-40, 40], [-30, 30]], label: "Spine" },
  { name: "chest", parent: "spine", at: [0, 0.22, 0], tail: [0, 0.24, 0], limits: [[-30, 25], [-35, 35], [-25, 25]], label: "Chest" },
  { name: "neck", parent: "chest", at: [0, 0.24, 0], tail: [0, 0.1, 0], limits: [[-40, 40], [-60, 60], [-30, 30]], label: "Neck" },
  { name: "head", parent: "neck", at: [0, 0.1, 0], tail: [0, 0.19, 0], limits: [[-40, 35], [-45, 45], [-30, 30]], label: "Head" },
  ...ARM("L"),
  ...ARM("R"),
  ...LEG("L"),
  ...LEG("R"),
];
export const BONE: Readonly<Record<BoneName, BoneDef>> = Object.fromEntries(BONES.map((b) => [b.name, b])) as Record<BoneName, BoneDef>;
export const FIGURE_HEIGHT_M = 1.75;
/** How far the pelvis joint sits above what the figure sits on. */
export const SEAT_DROP_M = 0.09;
/** The pelvis may move this far from where it stands at rest, each way. */
export const LOC_MAX_M = 2;

export type Pose = { rot: Partial<Record<BoneName, Vec3>>; loc: Vec3 };
export type PoseKey = { t: number; rot: Partial<Record<BoneName, Vec3>>; loc?: Vec3 };

const isRight = (n: BoneName) => n.endsWith(".R");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => {
  const x = Math.round(v * 100) / 100;
  return x === 0 ? 0 : x;
};
export const isBone = (v: unknown): v is BoneName => typeof v === "string" && (BONE_NAMES as readonly string[]).includes(v);

/** A bone's rotation held inside its joint limits (degrees, rounded to 0.01). */
export function clampRot(name: BoneName, v: readonly number[]): Vec3 {
  const lim = BONE[name].limits;
  return [0, 1, 2].map((i) => r2(clamp(num(v[i]) ?? 0, lim[i][0], lim[i][1]))) as Vec3;
}
export const clampLoc = (v: readonly number[]): Vec3 => [0, 1, 2].map((i) => r2(clamp(num(v[i]) ?? 0, -LOC_MAX_M, LOC_MAX_M) * 1000) / 1000) as Vec3;

export const restPose = (): Pose => ({ rot: {}, loc: [0, 0, 0] });
export const clonePose = (p: Pose): Pose => ({ rot: Object.fromEntries(Object.entries(p.rot).map(([k, v]) => [k, [...(v as Vec3)]])), loc: [...p.loc] });

/** A pose as saved or sent, checked: unknown bones dropped, every number inside its limits. Null for nothing usable. */
export function normalisePose(raw: unknown): Pose | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rot: Pose["rot"] = {};
  if (o.rot && typeof o.rot === "object") {
    for (const [k, v] of Object.entries(o.rot as Record<string, unknown>)) if (isBone(k) && Array.isArray(v)) rot[k] = clampRot(k, v);
  }
  return { rot, loc: Array.isArray(o.loc) ? clampLoc(o.loc) : [0, 0, 0] };
}

/** Pose keyframes as saved: sorted by time, at most 400, each checked like a pose. */
export function normalisePoseKeys(raw: unknown, maxT = 60): PoseKey[] {
  if (!Array.isArray(raw)) return [];
  const out: PoseKey[] = [];
  for (const k of raw.slice(0, 400)) {
    const t = num((k as Record<string, unknown>)?.t);
    const p = normalisePose(k);
    if (t === null || !p) continue;
    const key: PoseKey = { t: clamp(t, 0, maxT), rot: p.rot };
    if (Array.isArray((k as Record<string, unknown>).loc)) key.loc = p.loc;
    if (Object.keys(key.rot).length || key.loc) out.push(key);
  }
  return out.sort((a, b) => a.t - b.t);
}

// ---------------- the skeleton in three.js ----------------

export type Skeleton = { root: THREE.Object3D; bones: Record<BoneName, THREE.Object3D> };

/** The bones as plain objects under `root` (named after the bones), standing at rest. */
export function buildSkeleton(root: THREE.Object3D = new THREE.Group()): Skeleton {
  const bones = {} as Record<BoneName, THREE.Object3D>;
  for (const b of BONES) {
    const o = new THREE.Object3D();
    o.name = b.name;
    o.rotation.order = "XYZ";
    o.position.set(...b.at);
    o.userData.bone = b.name;
    (b.parent ? bones[b.parent] : root).add(o);
    bones[b.name] = o;
  }
  return { root, bones };
}

/** A skeleton's bones found again under a root by name (after a copy). */
export function findSkeleton(root: THREE.Object3D): Skeleton | null {
  const bones = {} as Record<BoneName, THREE.Object3D>;
  root.traverse((o) => {
    if (isBone(o.userData?.bone) && !bones[o.userData.bone as BoneName]) bones[o.userData.bone as BoneName] = o;
  });
  return BONE_NAMES.every((n) => bones[n]) ? { root, bones } : null;
}

const D = Math.PI / 180;
/** The rotation a bone's numbers mean, as three.js reads it (the right side mirrored). */
export function boneEuler(name: BoneName, v: readonly number[]): THREE.Euler {
  const m = isRight(name) ? -1 : 1;
  return new THREE.Euler((v[0] ?? 0) * D, (v[1] ?? 0) * m * D, (v[2] ?? 0) * m * D, "XYZ");
}
/** A bone's numbers from its three.js rotation. */
export function eulerNumbers(name: BoneName, q: THREE.Quaternion): Vec3 {
  const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
  const m = isRight(name) ? -1 : 1;
  return [e.x / D, (e.y / D) * m, (e.z / D) * m].map((x) => r2(x)) as Vec3;
}

/** Puts the skeleton in this pose. */
export function applyPose(sk: Skeleton, pose: Pose): void {
  for (const b of BONES) {
    const o = sk.bones[b.name];
    o.position.set(...b.at);
    if (b.name === "pelvis") o.position.add(new THREE.Vector3(...pose.loc));
    o.rotation.copy(boneEuler(b.name, pose.rot[b.name] ?? [0, 0, 0]));
  }
  sk.root.updateMatrixWorld(true);
}

// ---------------- two-bone IK ----------------

export const LIMBS = {
  "arm.L": { upper: "upperArm.L", lower: "forearm.L", end: "hand.L", sign: 1, pole: [0.35, -0.2, -1] },
  "arm.R": { upper: "upperArm.R", lower: "forearm.R", end: "hand.R", sign: 1, pole: [-0.35, -0.2, -1] },
  "leg.L": { upper: "thigh.L", lower: "shin.L", end: "foot.L", sign: -1, pole: [0.1, 0, 1] },
  "leg.R": { upper: "thigh.R", lower: "shin.R", end: "foot.R", sign: -1, pole: [-0.1, 0, 1] },
} as const satisfies Record<string, { upper: BoneName; lower: BoneName; end: BoneName; sign: 1 | -1; pole: Vec3 }>;
export type LimbName = keyof typeof LIMBS;
/** The limb a hand or foot (or any of its bones) belongs to. */
export function limbOf(bone: BoneName): LimbName | null {
  for (const [k, l] of Object.entries(LIMBS)) if (l.end === bone || l.lower === bone || l.upper === bone) return k as LimbName;
  return null;
}

/**
 * Moves a limb so its hand's wrist (or foot's ankle) reaches `target` (world
 * space), the elbow or knee bending towards `pole` (a direction in the
 * figure's frame; the limb's own default when left out). Writes the upper
 * and lower bones' numbers into `pose`, held inside their limits, and
 * returns how far the wrist ended from the target (0 when it reached).
 */
export function solveLimb(sk: Skeleton, pose: Pose, limb: LimbName, target: THREE.Vector3, pole?: Vec3): number {
  const L = LIMBS[limb];
  applyPose(sk, pose);
  const upper = sk.bones[L.upper], lower = sk.bones[L.lower], end = sk.bones[L.end];
  const parent = upper.parent!;
  const R = upper.getWorldPosition(new THREE.Vector3());
  const a = lower.position.length(), b = end.position.length();
  const toT = target.clone().sub(R);
  const d = clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-4);
  const dir = toT.lengthSq() > 1e-12 ? toT.normalize() : new THREE.Vector3(0, -1, 0);
  const pq = parent.getWorldQuaternion(new THREE.Quaternion());
  const rootQ = sk.root.getWorldQuaternion(new THREE.Quaternion());
  // The pole in the world: the figure's frame turned with the body's own tilt (the parent bone's), not only the root's.
  const poleW = new THREE.Vector3(...(pole ?? L.pole)).normalize().applyQuaternion(pole ? rootQ : pq);
  let p = poleW.clone().sub(dir.clone().multiplyScalar(poleW.dot(dir)));
  if (p.lengthSq() < 1e-8) p = new THREE.Vector3(0, 0, 1).applyQuaternion(pq).cross(dir);
  if (p.lengthSq() < 1e-8) p = new THREE.Vector3(1, 0, 0).cross(dir);
  p.normalize();
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const u = dir.clone().multiplyScalar(cosA).add(p.clone().multiplyScalar(Math.sqrt(1 - cosA * cosA)));
  const X = new THREE.Vector3().crossVectors(u, p).normalize().multiplyScalar(L.sign);
  const Y = u.clone().negate();
  const Z = new THREE.Vector3().crossVectors(X, Y);
  const qw = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  const ql = pq.clone().invert().multiply(qw);
  pose.rot[L.upper] = clampRot(L.upper, eulerNumbers(L.upper, ql));
  const cosC = clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1);
  const bend = 180 - Math.acos(cosC) / D;
  const was = pose.rot[L.lower] ?? [0, 0, 0];
  pose.rot[L.lower] = clampRot(L.lower, [L.sign > 0 ? -bend : bend, was[1], 0]);
  applyPose(sk, pose);
  return end.getWorldPosition(new THREE.Vector3()).distanceTo(target);
}

/** Where a bone's joint stands in the figure's own frame, for this pose (a scratch skeleton). */
export function jointsOf(pose: Pose): Record<BoneName, THREE.Vector3> {
  const sk = buildSkeleton();
  applyPose(sk, pose);
  return Object.fromEntries(BONE_NAMES.map((n) => [n, sk.bones[n].getWorldPosition(new THREE.Vector3())])) as Record<BoneName, THREE.Vector3>;
}

/** Shifts the pelvis up or down so the lower sole rests on the ground (y 0). */
export function groundFeet(pose: Pose): Pose {
  const j = jointsOf(pose);
  const sole = Math.min(j["foot.L"].y, j["foot.R"].y) - 0.07;
  return { rot: pose.rot, loc: clampLoc([pose.loc[0], pose.loc[1] - sole, pose.loc[2]]) };
}

// ---------------- presets ----------------

export const POSE_PRESETS = ["stand", "walk", "run", "sit", "wave", "point", "crouch", "lie", "hips", "crossed"] as const;
export type PosePreset = (typeof POSE_PRESETS)[number];
export const PRESET_LABELS: Readonly<Record<PosePreset, string>> = {
  stand: "Stand",
  walk: "Walk",
  run: "Run",
  sit: "Sit",
  wave: "Wave",
  point: "Point",
  crouch: "Crouch",
  lie: "Lie down",
  hips: "Hands on hips",
  crossed: "Arms crossed",
};

type Rot = Partial<Record<BoneName, Vec3>>;
const both = (base: "shoulder" | "upperArm" | "forearm" | "hand" | "thigh" | "shin" | "foot", v: Vec3): Rot => ({ [`${base}.L`]: v, [`${base}.R`]: v }) as Rot;
const ARMS_DOWN: Rot = { ...both("upperArm", [0, 0, 6]), ...both("forearm", [-8, 0, 0]) };

const PRESET_BASE: Readonly<Record<PosePreset, { rot: Rot; loc?: Vec3; ik?: { limb: LimbName; at: Vec3; pole?: Vec3 }[]; ground?: boolean }>> = {
  stand: { rot: { ...ARMS_DOWN } },
  walk: {
    rot: { ...ARMS_DOWN, "thigh.L": [-24, 0, 0], "shin.L": [8, 0, 0], "foot.L": [8, 0, 0], "thigh.R": [16, 0, 0], "shin.R": [28, 0, 0], "foot.R": [6, 0, 0], "upperArm.L": [18, 0, 5], "upperArm.R": [-20, 0, 5], ...both("forearm", [-22, 0, 0]), spine: [-3, 0, 0] },
    ground: true,
  },
  run: {
    rot: { "thigh.L": [-62, 0, 0], "shin.L": [95, 0, 0], "foot.L": [10, 0, 0], "thigh.R": [26, 0, 0], "shin.R": [48, 0, 0], "foot.R": [22, 0, 0], "upperArm.L": [45, 0, 8], "upperArm.R": [-55, 0, 8], "forearm.L": [-85, 0, 0], "forearm.R": [-95, 0, 0], spine: [-12, 0, 0], chest: [-4, 0, 0] },
    ground: true,
  },
  sit: {
    rot: { ...both("thigh", [-90, 0, 4]), ...both("shin", [90, 0, 0]), ...both("upperArm", [-26, 0, 6]), ...both("forearm", [-52, 0, 0]), spine: [-4, 0, 0] },
    loc: [0, -0.42, 0],
  },
  wave: { rot: { ...ARMS_DOWN, "hand.R": [0, 0, 10], head: [0, 0, -4] }, ik: [{ limb: "arm.R", at: [-0.42, 1.8, 0.1], pole: [-1, -1.2, 0.1] }] },
  point: { rot: { ...ARMS_DOWN, "upperArm.R": [-88, 0, 4], "forearm.R": [0, 0, 0], "hand.R": [0, 0, 0], chest: [0, 6, 0] } },
  crouch: {
    rot: { ...both("thigh", [-112, 0, 10]), ...both("shin", [130, 0, 0]), ...both("foot", [-18, 0, 0]), ...both("upperArm", [-42, 0, 8]), ...both("forearm", [-60, 0, 0]), spine: [-28, 0, 0], chest: [-10, 0, 0], neck: [16, 0, 0], head: [10, 0, 0] },
    ground: true,
  },
  lie: { rot: { pelvis: [-90, 0, 0], ...both("upperArm", [0, 0, 8]), ...both("forearm", [-6, 0, 0]), ...both("foot", [-10, 0, 0]) }, loc: [0, -0.8, 0] },
  hips: {
    rot: { ...both("hand", [0, 0, -20]) },
    ik: [
      { limb: "arm.L", at: [0.2, 0.98, 0.03], pole: [1, 0.1, -0.7] },
      { limb: "arm.R", at: [-0.2, 0.98, 0.03], pole: [-1, 0.1, -0.7] },
    ],
  },
  crossed: {
    rot: { ...both("hand", [0, 0, 0]) },
    ik: [
      { limb: "arm.L", at: [-0.1, 1.16, 0.19], pole: [1, -1, -0.2] },
      { limb: "arm.R", at: [0.12, 1.2, 0.16], pole: [-1, -1, -0.2] },
    ],
  },
};

/** A preset as numbers: its bones, the reaching ones solved by IK on a figure standing at the origin. */
export function presetPose(name: PosePreset): Pose {
  const base = PRESET_BASE[name];
  const pose: Pose = { rot: Object.fromEntries(Object.entries(base.rot).map(([k, v]) => [k, clampRot(k as BoneName, v as Vec3)])), loc: clampLoc(base.loc ?? [0, 0, 0]) };
  if (base.ik) {
    const sk = buildSkeleton();
    for (const k of base.ik) solveLimb(sk, pose, k.limb, new THREE.Vector3(...k.at), k.pole);
  }
  return base.ground ? groundFeet(pose) : pose;
}

// ---------------- looking at something ----------------

/**
 * The neck and head (and a little of the chest) turned so the face looks
 * along `dir`, a direction in the chest's frame (+Z ahead, +X the figure's
 * left, +Y up). Returns the bones' numbers; what the limits can't reach is
 * left short.
 */
export function lookRot(dir: Vec3): Rot {
  const [x, y, z] = dir;
  const yaw = Math.atan2(x, z) / D;
  const pitch = Math.atan2(y, Math.hypot(x, z)) / D;
  const chestY = clamp(yaw * 0.25, -35, 35);
  const rest = yaw - chestY;
  return {
    chest: clampRot("chest", [0, chestY, 0]),
    neck: clampRot("neck", [-pitch * 0.4, rest * 0.45, 0]),
    head: clampRot("head", [-pitch * 0.6, rest * 0.55, 0]),
  };
}

// ---------------- keyframes ----------------

/**
 * The pose at time `t` from pose keyframes: each bone (and the pelvis's
 * offset) between the two keys around `t` that hold it, eased the way the
 * object's interpolation says; a bone no key holds keeps `base`'s numbers.
 */
export function poseAt(keys: readonly PoseKey[], t: number, interp: string, base: Pose): Pose {
  const out = clonePose(base);
  if (!keys.length) return out;
  const ease = (u: number) => (interp === "constant" ? 0 : interp === "linear" ? u : u * u * (3 - 2 * u));
  const chan = (get: (k: PoseKey) => Vec3 | undefined): Vec3 | null => {
    const ks = keys.filter((k) => get(k));
    if (!ks.length) return null;
    if (t <= ks[0].t) return [...get(ks[0])!];
    const last = ks[ks.length - 1];
    if (t >= last.t) return [...get(last)!];
    let i = 0;
    while (ks[i + 1].t < t) i++;
    const a = get(ks[i])!, b = get(ks[i + 1])!, u = ease((t - ks[i].t) / (ks[i + 1].t - ks[i].t));
    return [0, 1, 2].map((n) => a[n] + (b[n] - a[n]) * u) as Vec3;
  };
  for (const n of BONE_NAMES) {
    const v = chan((k) => k.rot[n]);
    if (v) out.rot[n] = v;
  }
  const loc = chan((k) => k.loc);
  if (loc) out.loc = loc;
  return out;
}

/** Keys `bones` (every bone, and the pelvis offset, when null) of `pose` at `t`, into a copy of `keys`. */
export function setPoseKey(keys: readonly PoseKey[], t: number, pose: Pose, bones: BoneName[] | null, near = 1 / 48): PoseKey[] {
  const out = keys.map((k) => ({ t: k.t, rot: { ...k.rot }, ...(k.loc ? { loc: [...k.loc] as Vec3 } : {}) }));
  let key = out.find((k) => Math.abs(k.t - t) < near);
  if (!key) {
    key = { t, rot: {} };
    out.push(key);
    out.sort((a, b) => a.t - b.t);
  }
  for (const n of bones ?? BONE_NAMES) key.rot[n] = [...(pose.rot[n] ?? [0, 0, 0])] as Vec3;
  if (!bones || bones.includes("pelvis")) key.loc = [...pose.loc];
  return out;
}

// ---------------- the pose in words ----------------

export type PoseWordsContext = {
  /** What the figure sits on, when its seat rests on something ("the red car"). */
  sittingOn?: string | null;
  /** What its hands rest on. */
  leaningOn?: string | null;
  /** What its face turns to ("the camera", "the red car"). */
  lookingAt?: string | null;
  /** Walking or running along a path right now (studio-gait.ts), which the gait's own pose may not show on this frame. */
  moving?: "walking" | "running" | null;
};

/** What the figure's body is doing, read from the pose itself. */
export function poseKind(pose: Pose): "lying" | "sitting" | "crouching" | "running" | "walking" | "standing" {
  const pel = pose.rot.pelvis ?? [0, 0, 0];
  if (Math.abs(pel[0]) > 55 || Math.abs(pel[2]) > 55) return "lying";
  const tl = pose.rot["thigh.L"] ?? [0, 0, 0], tr = pose.rot["thigh.R"] ?? [0, 0, 0];
  const sl = pose.rot["shin.L"] ?? [0, 0, 0], sr = pose.rot["shin.R"] ?? [0, 0, 0];
  if (tl[0] < -60 && tr[0] < -60) return sl[0] > 110 && sr[0] > 110 && pose.loc[1] < -0.45 ? "crouching" : "sitting";
  const split = Math.abs(tl[0] - tr[0]);
  if (split > 60 || Math.max(sl[0], sr[0]) > 80) return "running";
  if (split > 25) return "walking";
  return "standing";
}

/** What one arm is doing, from where its wrist ends up (figure frame). */
function armWords(j: Record<BoneName, THREE.Vector3>, pose: Pose, s: "L" | "R"): "waving" | "raising" | "pointing" | "hip" | null {
  const wrist = j[`hand.${s}`], shoulder = j[`upperArm.${s}`], hip = j.pelvis;
  const bend = -(pose.rot[`forearm.${s}`]?.[0] ?? 0);
  const out = s === "L" ? wrist.x - shoulder.x : shoulder.x - wrist.x;
  if (wrist.y > j.head.y + 0.12) return bend > 35 ? "waving" : "raising";
  if (bend < 25 && wrist.z - shoulder.z > 0.35 && Math.abs(wrist.y - shoulder.y) < 0.3) return "pointing";
  if (Math.abs(wrist.y - hip.y) < 0.14 && out > -0.02 && out < 0.16 && bend > 60) return "hip";
  return null;
}

/**
 * The pose in plain English for the image engine, e.g. "sitting on the red
 * car, waving with the right hand, looking at the camera". Read from the
 * pose's own numbers (so a pose made bone by bone is said too) and from what
 * the Studio measured around it (`ctx`).
 */
export function poseWords(pose: Pose, ctx: PoseWordsContext = {}): string {
  // The arms are read against the body (the pelvis upright, at rest), so a figure lying down still "waves".
  const j = jointsOf({ rot: { ...pose.rot, pelvis: [0, 0, 0] }, loc: [0, 0, 0] });
  const kind = ctx.moving ?? poseKind(pose);
  const parts: string[] = [];
  if (ctx.sittingOn && kind !== "lying") parts.push(`sitting on ${ctx.sittingOn}`);
  else if (kind === "lying") parts.push("lying down on their back");
  else parts.push(kind);
  if (ctx.leaningOn) parts.push(`leaning on ${ctx.leaningOn}`);
  // A walk's or run's arm swing is part of the gait, not something to say.
  const gait = kind === "walking" || kind === "running";
  const arm = (s: "L" | "R") => {
    const w = armWords(j, pose, s);
    return gait && w !== "waving" && w !== "raising" ? null : w;
  };
  const L = arm("L"), R = arm("R");
  const wL = j["hand.L"], wR = j["hand.R"];
  const crossed = wL.x < 0.02 && wR.x > -0.02 && wL.z > 0.08 && wR.z > 0.08 && Math.abs(wL.y - j.chest.y) < 0.2 && Math.abs(wR.y - j.chest.y) < 0.2;
  if (crossed) parts.push("arms crossed");
  else if (L === "hip" && R === "hip") parts.push("hands on hips");
  else if (L === R && L && L !== "hip") parts.push(L === "waving" ? "waving with both hands" : L === "raising" ? "both hands raised" : "pointing ahead with both arms");
  else
    for (const [side, w] of [["right", R], ["left", L]] as const) {
      if (w === "waving") parts.push(`waving with the ${side} hand`);
      else if (w === "raising") parts.push(`raising the ${side} hand`);
      else if (w === "pointing") parts.push(`pointing ahead with the ${side} hand`);
      else if (w === "hip") parts.push(`${side} hand on the hip`);
    }
  if (ctx.lookingAt) parts.push(`looking at ${ctx.lookingAt}`);
  return parts.join(", ");
}

/** The set's own four stand poses (set-spec.ts STAND_POSES), the nearest to this pose. */
export function standPoseOf(pose: Pose, ctx: PoseWordsContext = {}): "stand" | "sit" | "walk" | "lean" {
  if (ctx.leaningOn) return "lean";
  if (ctx.moving) return "walk";
  const k = poseKind(pose);
  if (ctx.sittingOn || k === "sitting") return "sit";
  if (k === "walking" || k === "running") return "walk";
  return "stand";
}

/** The sentence "Photo with your character" puts in its "What happens" box for this pose. */
export function poseSentence(pose: Pose, ctx: PoseWordsContext = {}): string {
  const w = poseWords(pose, ctx);
  return `The character is ${w}.`;
}

// ---------------- presets on a pose that already has one ----------------

const ARM_BONES = BONE_NAMES.filter((n) => /^(shoulder|upperArm|forearm|hand)\./.test(n));
/** The gestures pose the arms only, so a figure sitting on a car keeps sitting while it waves. */
export const GESTURE_PRESETS: readonly PosePreset[] = ["wave", "point", "hips", "crossed"];
/** The bones a preset sets on a pose it's applied to: the arms (and the head, for a wave) for a gesture, every bone for the body's own. */
export function presetBones(name: PosePreset): BoneName[] | null {
  if (!GESTURE_PRESETS.includes(name)) return null;
  return name === "wave" ? [...ARM_BONES, "head"] : [...ARM_BONES];
}
/** `pose` with a preset applied: a gesture changes the arms only; a body preset changes the whole figure. */
export function applyPreset(pose: Pose, name: PosePreset): Pose {
  const p = presetPose(name);
  const bones = presetBones(name);
  if (!bones) return p;
  const out = clonePose(pose);
  for (const n of bones) {
    if (p.rot[n]) out.rot[n] = [...p.rot[n]!] as Vec3;
    else delete out.rot[n];
  }
  return out;
}

// ---------------- naming what the figure is on ----------------

/** A colour in one plain word, from its hex ("#c0282d" → "red"). */
export function colourWord(hex: string): string | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  if (hsl.s < 0.18 || hsl.l < 0.06) return hsl.l > 0.8 ? "white" : hsl.l < 0.16 ? "black" : hsl.l > 0.5 ? "silver" : "grey";
  const h = hsl.h * 360;
  if (h < 15 || h >= 340) return hsl.l > 0.7 ? "pink" : "red";
  if (h < 42) return hsl.l < 0.35 ? "brown" : "orange";
  if (h < 70) return "yellow";
  if (h < 165) return "green";
  if (h < 200) return "teal";
  if (h < 255) return "blue";
  if (h < 290) return "purple";
  return "pink";
}
const COLOUR_WORDS = /\b(red|orange|yellow|green|teal|blue|purple|pink|white|black|grey|gray|silver|brown|gold)\b/i;
/** A thing's name as the words say it: "Red sports car" → "the red sports car", "Car 1" painted red → "the red car". */
export function thingWords(name: string, hex?: string | null): string {
  const base = name.replace(/\.\d{3}$/, "").replace(/\s+\d+$/, "").trim().toLowerCase() || "thing";
  const colour = hex && !COLOUR_WORDS.test(base) ? colourWord(hex) : null;
  return `the ${colour ? colour + " " : ""}${base}`;
}
