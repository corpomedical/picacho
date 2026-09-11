// Where the stage camera stands for one Match-this-shot read, in a set, as
// the product's page puts it (set-view.tsx pickReference, then its stage's
// matchTo): the product's own solveMatchPose — the figure on the set's first
// mark, the set's first camera as the camera in hand, the photo's shape as
// prepared — then the product's placeMatchedCamera against the set as built
// (three.js core, in Node, as match-shot.test.ts runs it), and the page's
// line for it (matchSummary). Pure over the three.js it is handed.
//
// Two numbers are the page's own, mirrored (render/viewer-parity.mts checks
// the lines at run start): the figure's eye height, FRAME_EYE_Y, and the
// orbit's reach, controls.maxDistance. The canvas is the snapshot page's
// square (render/snap-page.html): its centre square is all of it, which
// solveMatchPose reads as it reads a landscape screen's (the still spans the
// lens's vertical field of view) — a phone held upright is not what is drawn.
//
// The set each photo is matched in is pinned by the run's seed and the
// photo's id (pinnedSet): the same set for both builders and every run, and
// a photo keeps its set when other photos come or go.

import type * as ThreeNS from "three";
import { buildSetScene } from "../../../src/lib/sets/build-scene.ts";
import { matchSummary, placeMatchedCamera, solveMatchPose, type CameraMove, type CameraPose, type MatchNotes, type ShotMatch } from "../../../src/lib/sets/match-shot.ts";
import type { SetSpec, Vec3 } from "../../../src/lib/sets/set-spec.ts";
import type { Pose } from "../render/chrome.mts";
import { sha256 } from "./util.mts";

/** set-view.tsx: const FRAME_EYE_Y = 1.45; */
export const FRAME_EYE_Y = 1.45;
/** set-view.tsx: controls.maxDistance = Math.max(spec.bounds.x, spec.bounds.z) * 1.2 + 10; */
export const orbitReach = (bounds: SetSpec["bounds"]): number => Math.max(bounds.x, bounds.z) * 1.2 + 10;
/** The snapshot page's canvas is square: 1024 × 1024. */
export const SNAP_CANVAS_ASPECT = 1;

export type StagePose = {
  solved: { pose: CameraPose; notes: MatchNotes };
  /** Where placeMatchedCamera stood the camera, and how it moved it. */
  position: Vec3;
  target: Vec3;
  fovDeg: number;
  moved: CameraMove;
  /** The page's line: from the pose as the stage reports it (api.pose(): 3 decimals, the lens to 2). */
  summary: ReturnType<typeof matchSummary>;
};

type Built = ReturnType<typeof buildSetScene>;

/** The set as built, once per set: every read pinned to it is placed against the same scene. */
export function buildForMatching(THREE: typeof ThreeNS, spec: SetSpec): Built {
  return buildSetScene(THREE, spec);
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** One read's stage camera in a set (built by buildForMatching). */
export function matchedStagePose(THREE: typeof ThreeNS, spec: SetSpec, built: Built, match: ShotMatch, referenceAspect: number): StagePose {
  const m = spec.marks[0];
  const mark = { x: m.x, z: m.z, facingDeg: m.facingDeg };
  const c = spec.cameras[0];
  const solved = solveMatchPose(match, {
    mark,
    current: { position: c.position, target: c.target, fovDeg: c.fovDeg },
    referenceAspect,
    bounds: spec.bounds,
    canvasAspect: SNAP_CANVAS_ASPECT,
  });
  const placed = placeMatchedCamera(THREE, built.root, solved.pose, { mark, eyeY: FRAME_EYE_Y, bounds: spec.bounds, maxDistance: orbitReach(spec.bounds) });
  const reported: CameraPose = {
    position: [r3(placed.position[0]), r3(placed.position[1]), r3(placed.position[2])],
    target: [r3(placed.target[0]), r3(placed.target[1]), r3(placed.target[2])],
    fovDeg: Math.round(solved.pose.fovDeg * 100) / 100,
  };
  return { solved, position: placed.position, target: placed.target, fovDeg: solved.pose.fovDeg, moved: placed.moved, summary: matchSummary(match, solved, reported) };
}

/** The still the person would take from there: the centre square, the set's own lift, the grey figure on the mark. */
export function matchFramePose(poseId: string, p: StagePose): Pose {
  return { poseId, position: p.position, target: p.target, fovDeg: p.fovDeg, figure: true };
}

/** The set a photo is matched in: pinned by the seed and the photo's id, from the pool in key order. */
export function pinnedSet<T extends { key: string }>(pool: readonly T[], photoId: string, seed: number): T {
  if (pool.length === 0) throw new Error("no set to match in");
  const sorted = [...pool].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return sorted[parseInt(sha256(`${seed}:${photoId}`).slice(0, 8), 16) % sorted.length];
}
