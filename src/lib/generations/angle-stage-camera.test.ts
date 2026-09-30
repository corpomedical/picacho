import { describe, expect, it } from "vitest";
import {
  angleFramePrompt,
  describeStageCamera,
  measureStageCamera,
  readStageCameraView,
} from "./angle-stage-camera";

// The stage's home camera (angle-stage-view.tsx HOME), looking at the origin.
const HOME = { x: 0, y: 0.12, z: 2.1 };
const R = Math.hypot(HOME.y, HOME.z);
const orbit = (deg: number, scale = 1) => {
  const a = (deg * Math.PI) / 180;
  const flat = Math.hypot(HOME.z);
  return { x: Math.sin(a) * flat * scale, y: HOME.y * scale, z: Math.cos(a) * flat * scale };
};

describe("measureStageCamera", () => {
  it("reads the home camera as the take's own view", () => {
    const v = measureStageCamera(HOME, HOME);
    expect(v.azimuthDeg).toBeCloseTo(0);
    expect(v.elevationDeg).toBeCloseTo(0);
    expect(v.distanceRatio).toBeCloseTo(1);
  });

  it("a turn towards +x is a turn to the subject's left (positive)", () => {
    expect(measureStageCamera(orbit(45), HOME).azimuthDeg).toBeCloseTo(45);
    expect(measureStageCamera(orbit(-90), HOME).azimuthDeg).toBeCloseTo(-90);
  });

  it("reads height and distance against the take's camera", () => {
    const up = measureStageCamera({ x: 0, y: R * Math.sin(Math.PI / 6), z: R * Math.cos(Math.PI / 6) }, HOME);
    expect(up.elevationDeg).toBeCloseTo(30 - (Math.asin(HOME.y / R) * 180) / Math.PI);
    expect(measureStageCamera(orbit(0, 0.5), HOME).distanceRatio).toBeCloseTo(0.5);
  });
});

describe("readStageCameraView", () => {
  it("takes three finite numbers and nothing else", () => {
    expect(readStageCameraView(undefined)).toBeNull();
    expect(readStageCameraView("45")).toBeNull();
    expect(readStageCameraView({ azimuthDeg: 45, elevationDeg: 0 })).toBeNull();
    expect(readStageCameraView({ azimuthDeg: "45", elevationDeg: 0, distanceRatio: 1 })).toBeNull();
    expect(readStageCameraView({ azimuthDeg: NaN, elevationDeg: 0, distanceRatio: 1 })).toBeNull();
    expect(readStageCameraView({ azimuthDeg: 45, elevationDeg: 0, distanceRatio: 1 })).toEqual({
      azimuthDeg: 45,
      elevationDeg: 0,
      distanceRatio: 1,
    });
  });

  it("wraps the turn and clamps height and distance", () => {
    expect(readStageCameraView({ azimuthDeg: 270, elevationDeg: 200, distanceRatio: 99 })).toEqual({
      azimuthDeg: -90,
      elevationDeg: 90,
      distanceRatio: 5,
    });
    expect(readStageCameraView({ azimuthDeg: -180, elevationDeg: -200, distanceRatio: 0 })).toEqual({
      azimuthDeg: 180,
      elevationDeg: -90,
      distanceRatio: 0.1,
    });
  });
});

describe("describeStageCamera", () => {
  const view = (azimuthDeg: number, elevationDeg = 0, distanceRatio = 1) => ({ azimuthDeg, elevationDeg, distanceRatio });

  it("says nothing when the camera is where the take's was", () => {
    expect(describeStageCamera(view(0))).toBe("");
    expect(describeStageCamera(view(8, 5, 1.1))).toBe("");
  });

  it("words 09-30's turn: three-quarter from her left, facing the picture's left", () => {
    const w = describeStageCamera(view(45.4));
    expect(w).toContain("a three-quarter view from the subject's left side");
    expect(w).toContain("about 45° round from the front");
    // The first wording ("we see their left side") came back as a profile.
    expect(w).toContain("turned about 45° away from the camera, towards the left of the picture");
    expect(w).toContain("not in profile, we still see their face and front at an angle");
  });

  it("mirrors for the other side, and names slight, profile and back views", () => {
    const right = describeStageCamera(view(-90));
    expect(right).toContain("a side profile view from the subject's right side");
    expect(right).toContain("seen side-on, in profile, facing the right of the picture");
    expect(describeStageCamera(view(-25))).toContain("turned only slightly, about 25°, towards the right of the picture");
    expect(describeStageCamera(view(135))).toContain("a three-quarter view from behind, on the subject's left side");
    expect(describeStageCamera(view(175))).toContain("a view from directly behind the subject");
    expect(describeStageCamera(view(175))).toContain("we see their back");
  });

  it("adds height and distance only when they changed", () => {
    expect(describeStageCamera(view(0, 40))).toBe(
      "Camera placement: the same front view as image 2, from a high angle looking down.",
    );
    expect(describeStageCamera(view(0, -25))).toContain("from a low angle looking up");
    expect(describeStageCamera(view(0, 0, 0.5))).toContain("a close-up, much closer than image 2");
    expect(describeStageCamera(view(0, 0, 2))).toContain("a wide shot, the subject small in the frame");
    expect(describeStageCamera(view(45))).not.toMatch(/looking|closer|wide/);
  });
});

describe("angleFramePrompt", () => {
  const OLD =
    "Recreate the scene from image 2 at exactly the camera angle, subject pose and composition of image 1. " +
    "Image 1 is a rough 3D sketch of the same scene — follow its framing precisely, but take every detail of " +
    "the subject's face, hair, clothing, lighting and background from image 2. Photorealistic cinematic film " +
    "still, same color grade as image 2.";

  it("is the original prompt, word for word, without a view or at the take's own view", () => {
    expect(angleFramePrompt("", undefined)).toBe(OLD);
    expect(angleFramePrompt("A rooftop.", undefined)).toBe(`${OLD} The scene: A rooftop.`);
    expect(angleFramePrompt("A rooftop.", { azimuthDeg: 0, elevationDeg: 0, distanceRatio: 1 })).toBe(
      `${OLD} The scene: A rooftop.`,
    );
  });

  it("with a turned camera: the words first, image 2 for looks only, the take's wording yields", () => {
    const p = angleFramePrompt("Full-body photo of Eva on a rooftop, facing the camera.", {
      azimuthDeg: 45,
      elevationDeg: 0,
      distanceRatio: 1,
    });
    expect(p.startsWith("Camera placement: a three-quarter view from the subject's left side")).toBe(true);
    expect(p).toContain("never its camera angle or framing");
    expect(p).toContain(
      "The scene: Full-body photo of Eva on a rooftop, facing the camera. (where these words say where the camera is or which way the subject faces, the camera placement above wins).",
    );
  });
});
