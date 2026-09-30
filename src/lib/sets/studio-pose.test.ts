import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  BONES,
  BONE_NAMES,
  FIGURE_HEIGHT_M,
  POSE_PRESETS,
  applyPose,
  buildSkeleton,
  clampRot,
  findSkeleton,
  jointsOf,
  lookRot,
  normalisePose,
  normalisePoseKeys,
  poseAt,
  poseKind,
  poseSentence,
  poseWords,
  presetPose,
  restPose,
  setPoseKey,
  solveLimb,
  standPoseOf,
  type Pose,
} from "./studio-pose";

describe("the figure's skeleton", () => {
  it("has every bone from the pelvis to the feet, parents first, 1.75 m tall with the soles on the ground", () => {
    expect(BONE_NAMES).toEqual(expect.arrayContaining(["pelvis", "spine", "chest", "neck", "head", "shoulder.L", "upperArm.R", "forearm.L", "hand.R", "thigh.L", "shin.R", "foot.L"]));
    const seen = new Set<string>();
    for (const b of BONES) {
      if (b.parent) expect(seen.has(b.parent), b.name).toBe(true);
      seen.add(b.name);
    }
    const j = jointsOf(restPose());
    expect(j.head.y + 0.19).toBeCloseTo(FIGURE_HEIGHT_M, 2);
    expect(j["foot.L"].y - 0.07).toBeCloseTo(0, 2);
    // Its left is +X, the right mirrors it.
    expect(j["upperArm.L"].x).toBeCloseTo(-j["upperArm.R"].x, 6);
    expect(j["upperArm.L"].x).toBeGreaterThan(0);
  });

  it("holds every rotation inside its joint limits: a knee never bends forwards, an elbow never backwards", () => {
    expect(clampRot("shin.L", [-40, 0, 0])).toEqual([0, 0, 0]);
    expect(clampRot("shin.L", [200, 0, 0])).toEqual([150, 0, 0]);
    expect(clampRot("forearm.R", [30, 0, 5])).toEqual([0, 0, 0]);
    expect(clampRot("neck", [0, 99, 0])).toEqual([0, 60, 0]);
    expect(clampRot("head", [Number.NaN, 12.3456, 0])).toEqual([0, 12.35, 0]);
  });

  it("mirrors the right side: the same numbers raise either arm out to its own side", () => {
    const pose: Pose = { rot: { "upperArm.L": [0, 0, 90], "upperArm.R": [0, 0, 90] }, loc: [0, 0, 0] };
    const j = jointsOf(pose);
    expect(j["forearm.L"].x).toBeGreaterThan(j["upperArm.L"].x + 0.25);
    expect(j["forearm.R"].x).toBeLessThan(j["upperArm.R"].x - 0.25);
    expect(j["forearm.L"].y).toBeCloseTo(j["upperArm.L"].y, 2);
  });

  it("finds its bones again after a copy", () => {
    const sk = buildSkeleton();
    const copy = sk.root.clone(true);
    const found = findSkeleton(copy);
    expect(found).not.toBeNull();
    expect(Object.keys(found!.bones)).toHaveLength(BONE_NAMES.length);
    expect(found!.bones["hand.L"]).not.toBe(sk.bones["hand.L"]);
  });
});

describe("two-bone IK", () => {
  const sk = buildSkeleton();
  it("puts the wrist on any target the arm can reach, the elbow bending the way an elbow bends", () => {
    for (const at of [
      [0.45, 1.2, 0.3],
      [0.3, 1.7, 0.2],
      [0.1, 1.1, 0.35],
      [-0.05, 1.3, 0.3],
    ] as [number, number, number][]) {
      const pose = restPose();
      const miss = solveLimb(sk, pose, "arm.L", new THREE.Vector3(...at));
      expect(miss, at.join(",")).toBeLessThan(0.01);
      expect(pose.rot["forearm.L"]![0]).toBeLessThanOrEqual(0);
    }
  });

  it("puts the ankle on a target, the knee bending forwards", () => {
    const pose = restPose();
    const miss = solveLimb(sk, pose, "leg.R", new THREE.Vector3(-0.12, 0.4, 0.25));
    expect(miss).toBeLessThan(0.01);
    expect(pose.rot["shin.R"]![0]).toBeGreaterThan(20);
    const j = jointsOf(pose);
    expect(j["shin.R"].z).toBeGreaterThan(j["thigh.R"].z);
  });

  it("reaches out straight when the target is too far, and never past the joint limits", () => {
    const pose = restPose();
    const miss = solveLimb(sk, pose, "arm.R", new THREE.Vector3(-3, 1.43, 0));
    expect(miss).toBeGreaterThan(2);
    expect(Math.abs(pose.rot["forearm.R"]![0])).toBeLessThan(3);
    for (const [n, v] of Object.entries(pose.rot)) expect(clampRot(n as never, v!)).toEqual(v);
  });
});

describe("pose presets", () => {
  const J = (name: (typeof POSE_PRESETS)[number]) => jointsOf(presetPose(name));
  it("every preset stays inside the joint limits", () => {
    for (const p of POSE_PRESETS) for (const [n, v] of Object.entries(presetPose(p).rot)) expect(clampRot(n as never, v!), `${p} ${n}`).toEqual(v);
  });
  it("stands, walks and runs with a foot on the ground", () => {
    for (const p of ["stand", "walk", "run", "crouch"] as const) {
      const j = J(p);
      expect(Math.min(j["foot.L"].y, j["foot.R"].y) - 0.07, p).toBeCloseTo(0, 2);
    }
    expect(J("walk")["foot.L"].z).toBeGreaterThan(J("walk")["foot.R"].z + 0.2);
  });
  it("sits with the seat at chair height, crouches low, lies flat", () => {
    const sit = J("sit");
    expect(sit.pelvis.y).toBeGreaterThan(0.4);
    expect(sit.pelvis.y).toBeLessThan(0.6);
    expect(sit["shin.L"].z).toBeGreaterThan(0.35);
    expect(J("crouch").pelvis.y).toBeLessThan(0.5);
    const lie = J("lie");
    expect(lie.head.y).toBeLessThan(0.3);
    expect(Math.abs(lie.head.z - lie.pelvis.z)).toBeGreaterThan(0.5);
  });
  it("waves with the right hand above the head, points straight ahead, rests hands on the hips, crosses the arms", () => {
    const w = J("wave");
    expect(w["hand.R"].y).toBeGreaterThan(w.head.y);
    expect(w["hand.L"].y).toBeLessThan(1);
    const p = J("point");
    expect(p["hand.R"].z).toBeGreaterThan(0.45);
    expect(p["hand.R"].y).toBeCloseTo(p["upperArm.R"].y, 1);
    const h = J("hips");
    expect(h["hand.L"].distanceTo(new THREE.Vector3(0.2, 0.98, 0.03))).toBeLessThan(0.01);
    expect(h["hand.R"].distanceTo(new THREE.Vector3(-0.2, 0.98, 0.03))).toBeLessThan(0.01);
    const c = J("crossed");
    expect(c["hand.L"].x).toBeLessThan(0);
    expect(c["hand.R"].x).toBeGreaterThan(0);
  });
  it("each preset reads back as itself in words", () => {
    expect(poseWords(presetPose("stand"))).toBe("standing");
    expect(poseWords(presetPose("walk"))).toBe("walking");
    expect(poseWords(presetPose("run"))).toBe("running");
    expect(poseWords(presetPose("sit"))).toBe("sitting");
    expect(poseWords(presetPose("crouch"))).toBe("crouching");
    expect(poseWords(presetPose("lie"))).toBe("lying down on their back");
    expect(poseWords(presetPose("wave"))).toBe("standing, waving with the right hand");
    expect(poseWords(presetPose("point"))).toBe("standing, pointing ahead with the right hand");
    expect(poseWords(presetPose("hips"))).toBe("standing, hands on hips");
    expect(poseWords(presetPose("crossed"))).toBe("standing, arms crossed");
  });
});

describe("looking at something", () => {
  it("turns the face towards a direction, split over chest, neck and head, inside the limits", () => {
    const r = lookRot([1, 0, 0]);
    const yaw = r.chest![1] + r.neck![1] + r.head![1];
    expect(yaw).toBeCloseTo(90, 0);
    const up = lookRot([0, 1, 1]);
    expect(up.head![0]).toBeLessThan(0);
    const behind = lookRot([0, 0, -1]);
    expect(behind.neck![1]).toBeLessThanOrEqual(60);
  });
});

describe("pose keyframes", () => {
  it("eases each bone between the keys that hold it; a bone no key holds keeps its numbers", () => {
    const a: Pose = { rot: { "upperArm.R": [0, 0, 0] }, loc: [0, 0, 0] };
    const b: Pose = { rot: { "upperArm.R": [0, 0, 120] }, loc: [0, -0.4, 0] };
    let keys = setPoseKey([], 0, a, ["upperArm.R"]);
    keys = setPoseKey(keys, 2, b, ["upperArm.R", "pelvis"]);
    const base: Pose = { rot: { head: [0, 30, 0] }, loc: [0, 0, 0] };
    expect(poseAt(keys, 1, "linear", base).rot["upperArm.R"]).toEqual([0, 0, 60]);
    expect(poseAt(keys, 1, "bezier", base).rot["upperArm.R"]![2]).toBeCloseTo(60, 6);
    expect(poseAt(keys, 0.5, "bezier", base).rot["upperArm.R"]![2]).toBeLessThan(30);
    expect(poseAt(keys, 1, "constant", base).rot["upperArm.R"]).toEqual([0, 0, 0]);
    expect(poseAt(keys, 1, "linear", base).loc).toEqual([0, -0.4, 0]);
    expect(poseAt(keys, 1, "linear", base).rot.head).toEqual([0, 30, 0]);
    expect(poseAt(keys, 5, "linear", base).rot["upperArm.R"]).toEqual([0, 0, 120]);
  });
  it("keys one bone or the whole pose, replacing a key on the same frame", () => {
    const k1 = setPoseKey([], 1, presetPose("wave"), ["hand.R"]);
    expect(Object.keys(k1[0].rot)).toEqual(["hand.R"]);
    expect(k1[0].loc).toBeUndefined();
    const k2 = setPoseKey(k1, 1.001, presetPose("sit"), null);
    expect(k2).toHaveLength(1);
    expect(Object.keys(k2[0].rot)).toHaveLength(BONE_NAMES.length);
    expect(k2[0].loc).toEqual([0, -0.42, 0]);
  });
});

describe("saving a pose", () => {
  it("round-trips through JSON and checks what comes back", () => {
    const p = presetPose("wave");
    expect(normalisePose(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(normalisePose({ rot: { "shin.L": [-90, 0, 0], tail: [1, 2, 3] }, loc: [0, 99, 0] })).toEqual({ rot: { "shin.L": [0, 0, 0] }, loc: [0, 2, 0] });
    expect(normalisePose(null)).toBeNull();
    expect(normalisePose("sit")).toBeNull();
    const keys = setPoseKey(setPoseKey([], 2, presetPose("sit"), null), 0, presetPose("stand"), ["thigh.L"]);
    expect(normalisePoseKeys(JSON.parse(JSON.stringify(keys)))).toEqual(keys);
    expect(normalisePoseKeys([{ t: "x" }, { t: 1, rot: {} }, 5])).toEqual([]);
  });
  it("a figure placed from an old scene (no pose saved) stands", () => {
    const sk = buildSkeleton();
    applyPose(sk, normalisePose(undefined) ?? presetPose("stand"));
    expect(poseKind(presetPose("stand"))).toBe("standing");
    expect(sk.bones.pelvis.position.y).toBeCloseTo(0.93, 6);
  });
});

describe("the pose in words for the image engine", () => {
  it("says the seat, the hands and the gaze", () => {
    const sit = presetPose("sit");
    const wave = presetPose("wave");
    const both: Pose = { rot: { ...sit.rot, "upperArm.R": wave.rot["upperArm.R"], "forearm.R": wave.rot["forearm.R"] }, loc: sit.loc };
    expect(poseWords(both, { sittingOn: "the red car", lookingAt: "the camera" })).toBe("sitting on the red car, waving with the right hand, looking at the camera");
    expect(poseSentence(both, { sittingOn: "the red car", lookingAt: "the camera" })).toBe("The character is sitting on the red car, waving with the right hand, looking at the camera.");
    expect(poseWords(presetPose("stand"), { leaningOn: "the wall" })).toBe("standing, leaning on the wall");
  });
  it("names the set's own stand pose nearest to it", () => {
    expect(standPoseOf(presetPose("sit"))).toBe("sit");
    expect(standPoseOf(presetPose("stand"), { sittingOn: "the car" })).toBe("sit");
    expect(standPoseOf(presetPose("run"))).toBe("walk");
    expect(standPoseOf(presetPose("stand"), { leaningOn: "the car" })).toBe("lean");
    expect(standPoseOf(presetPose("wave"))).toBe("stand");
  });
});
