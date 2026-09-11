import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildSetScene } from "../../../src/lib/sets/build-scene.ts";
import { matchSummary, placeMatchedCamera, solveMatchPose, type ShotMatch } from "../../../src/lib/sets/match-shot.ts";
import { normaliseSetSpec, type SetSpec, type Vec3 } from "../../../src/lib/sets/set-spec.ts";
import { MIRRORED_MATCH_LINES } from "../render/viewer-parity.mts";
import { buildForMatching, FRAME_EYE_Y, matchedStagePose, matchFramePose, orbitReach, photoSquare, pinnedSet, SNAP_CANVAS_ASPECT } from "./match-pose.mts";
import { REPO_ROOT } from "./util.mts";

// Where a read puts the stage camera: the product's own solve and placement,
// from a fresh set's stage (the first camera in hand, the figure on the
// first mark), on three.js core in Node, as match-shot.test.ts runs them.

const fixture = (name: string): SetSpec => {
  const n = normaliseSetSpec(JSON.parse(readFileSync(join(REPO_ROOT, `src/lib/sets/fixtures-${name}.json`), "utf8")));
  if (!n.ok) throw new Error(name);
  return n.spec;
};

const match = (over: Partial<ShotMatch> = {}): ShotMatch => ({
  subjectFound: true,
  cameraHeightM: 1.4,
  pitchDeg: -8,
  verticalFovDeg: 38,
  subjectDistanceM: 4,
  subjectX: 0.6,
  framing: "full",
  confidence: "medium",
  ...over,
});

describe("matchedStagePose", () => {
  it("is the product's solveMatchPose from the first camera and mark, then its placeMatchedCamera against the set as built", () => {
    for (const name of ["showroom-closed", "rainy-market"]) {
      const spec = fixture(name);
      const built = buildForMatching(THREE, spec);
      const got = matchedStagePose(THREE, spec, built, match(), 1.5);
      const m = spec.marks[0];
      const c = spec.cameras[0];
      const mark = { x: m.x, z: m.z, facingDeg: m.facingDeg };
      const solved = solveMatchPose(match(), { mark, current: { position: c.position, target: c.target, fovDeg: c.fovDeg }, referenceAspect: 1.5, bounds: spec.bounds, canvasAspect: 1 });
      const own = buildSetScene(THREE, spec);
      const placed = placeMatchedCamera(THREE, own.root, solved.pose, { mark, eyeY: 1.45, bounds: spec.bounds, maxDistance: Math.max(spec.bounds.x, spec.bounds.z) * 1.2 + 10 });
      expect(got.solved).toEqual(solved);
      expect([got.position, got.target, got.moved]).toEqual([placed.position, placed.target, placed.moved]);
      expect(got.fovDeg).toBe(solved.pose.fovDeg);
      own.dispose();
      built.dispose();
    }
  });

  it("says its line from the pose as the stage reports it, rounded as api.pose() rounds", () => {
    const spec = fixture("rainy-market");
    const built = buildForMatching(THREE, spec);
    const got = matchedStagePose(THREE, spec, built, match({ verticalFovDeg: 12 }), 16 / 9);
    const r = (n: number) => Math.round(n * 1000) / 1000;
    const reported = { position: got.position.map(r) as [number, number, number], target: got.target.map(r) as [number, number, number], fovDeg: Math.round(got.fovDeg * 100) / 100 };
    expect(got.summary).toEqual(matchSummary(match({ verticalFovDeg: 12 }), got.solved, reported));
    // A lens longer than the stage keeps: the page's longest-lens note.
    expect(got.summary.clamps).toContain("narrow");
    built.dispose();
  });

  it("is drawn as the still is framed: the figure on the mark, the centre square", () => {
    const spec = fixture("showroom-closed");
    const built = buildForMatching(THREE, spec);
    const pose = matchFramePose("e-astra-mt-01-r1", matchedStagePose(THREE, spec, built, match(), 1.5));
    expect(pose).toMatchObject({ poseId: "e-astra-mt-01-r1", figure: true });
    expect(pose).not.toHaveProperty("aspect");
    built.dispose();
  });

  it("mirrors the page's own numbers, which the run checks are still in set-view.tsx", () => {
    expect(MIRRORED_MATCH_LINES).toContain(`const FRAME_EYE_Y = ${FRAME_EYE_Y};`);
    expect(MIRRORED_MATCH_LINES).toContain("controls.maxDistance = Math.max(spec.bounds.x, spec.bounds.z) * 1.2 + 10;");
    expect(orbitReach({ x: 20, z: 30, height: 4 })).toBe(30 * 1.2 + 10);
    expect(SNAP_CANVAS_ASPECT).toBe(1);
  });
});

describe("photoSquare: the part of a reference photo its still shows", () => {
  it("is the photo's centre square, its shorter side each way", () => {
    expect(photoSquare(1536, 1024)).toEqual({ left: 256, top: 0, size: 1024 });
    expect(photoSquare(900, 1200)).toEqual({ left: 0, top: 150, size: 900 });
    expect(photoSquare(1537, 1024)).toEqual({ left: 256, top: 0, size: 1024 });
    expect(photoSquare(800, 800)).toEqual({ left: 0, top: 0, size: 800 });
  });

  it("is what the product's still holds for a read with the photo's own camera: the photo's lens across the square, the subject where it sits in the square", () => {
    // Level, so the mark's vertical line crosses the screen's centre line at the camera's height.
    const bounds = { x: 20, z: 20, height: 4 };
    const current = { position: [0, 1.6, 6] as Vec3, target: [0, 1.2, 0] as Vec3, fovDeg: 45 };
    for (const [w, h] of [[1536, 1024], [900, 1200], [2048, 853], [1200, 1200]]) {
      const vfov = 38;
      const sq = photoSquare(w, h);
      // Whole pixels, within half a pixel of the photo's exact centre.
      expect(Math.abs(sq.left - (w - sq.size) / 2)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(sq.top - (h - sq.size) / 2)).toBeLessThanOrEqual(0.5);
      // The photo's focal length in pixels, from its vertical field of view, and the lens across its square.
      const f = h / 2 / Math.tan((vfov * Math.PI) / 360);
      const squareFov = (2 * Math.atan(sq.size / 2 / f) * 180) / Math.PI;
      for (const subjectX of [0.4, 0.5, 0.62]) {
        const solved = solveMatchPose(match({ verticalFovDeg: vfov, pitchDeg: 0, subjectX, cameraHeightM: 1.5, subjectDistanceM: 4 }), {
          mark: { x: 0, z: 0, facingDeg: 0 },
          current,
          referenceAspect: w / h,
          bounds,
          canvasAspect: SNAP_CANVAS_ASPECT,
        });
        expect(solved.notes).toEqual({});
        expect(solved.pose.fovDeg).toBeCloseTo(squareFov, 9);
        const cam = new THREE.PerspectiveCamera(solved.pose.fovDeg, SNAP_CANVAS_ASPECT, 0.01, 100);
        cam.position.set(...solved.pose.position);
        cam.lookAt(new THREE.Vector3(...solved.pose.target));
        cam.updateMatrixWorld();
        const onScreen = new THREE.Vector3(0, solved.pose.position[1], 0).project(cam);
        // Where the subject sits in the photo's centre square, 0 at its left edge, 1 at its right.
        expect((onScreen.x + 1) / 2).toBeCloseTo((subjectX * w - (w - sq.size) / 2) / sq.size, 9);
        expect(onScreen.y).toBeCloseTo(0, 9);
      }
    }
  });

});

describe("pinnedSet", () => {
  const pool = ["fx-beach", "fx-rainy-market", "fx-showroom-closed", "fx-showroom-open"].map((key) => ({ key }));

  it("pins a photo's set by the seed and the photo alone: the same whatever order the pool comes in or which other photos run", () => {
    const a = pinnedSet(pool, "mt-01", 7);
    expect(pinnedSet([...pool].reverse(), "mt-01", 7)).toEqual(a);
    expect(pinnedSet(pool, "mt-01", 7)).toEqual(a);
    const picks = new Set(Array.from({ length: 20 }, (_, i) => pinnedSet(pool, `mt-${i}`, 7).key));
    expect(picks.size).toBeGreaterThan(1);
    const seeds = new Set(Array.from({ length: 20 }, (_, s) => pinnedSet(pool, "mt-01", s).key));
    expect(seeds.size).toBeGreaterThan(1);
  });

  it("refuses an empty pool", () => {
    expect(() => pinnedSet([], "mt-01", 1)).toThrow(/no set/);
  });
});
