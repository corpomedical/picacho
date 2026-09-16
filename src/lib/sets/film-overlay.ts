// Film's overlay on the stage (canvas pages H and I, 2026-09-16): the
// camera's path through the set, every keyframe numbered on it with its
// lens and its distance to the person, and, for the selected beat, what its
// two keyframes' lenses see: a cone from each camera out to the frame it
// draws at the distance it aims. H: "the path curves through the set with
// every keyframe numbered on it … select one and its framing shows as a
// dashed frame around what it sees". I: "what each keyframe's lens sees —
// the same width at her".
//
// This module is the geometry only, as plain numbers. The stage draws it
// (set-view.tsx), and never into a frame sent to the image model.
//
// Keyframe 1 is where the film starts (the start still's own camera, when it
// was recorded); keyframe n + 1 is where beat n ends. A film whose start has
// no recorded camera draws from beat 1's end, numbered as ever.
//
// Pure and relative-import only: the page and the tests share it.

import type { FilmPose } from "./film";
import { nearestLens } from "./build-scene";
import { poseAlong, type FilmMove } from "./moves";
import type { Vec3 } from "./set-spec";

/** Points drawn along each beat's move: enough for an orbit to read round. */
export const FILM_PATH_SAMPLES = 32;
/** How far a cone reaches, metres: the distance its keyframe aims, kept inside this. */
export const FILM_CONE_MIN_M = 0.5;
export const FILM_CONE_MAX_M = 80;
/** The person's eyes, metres: where a keyframe's distance is measured to (the rig's own measure). */
export const FILM_EYE_M = 1.5;

export type FilmOverlayKey = {
  /** Where the camera stands. */
  at: Vec3;
  /** Its number on the path: 1 for the start, n + 1 for beat n's end. */
  number: number;
  /** The selected beat's end. */
  selected: boolean;
  /** The listed lens the page names for this field of view (the chip's own rule). */
  lensMm: number;
  /** Camera to the person's eyes, metres. */
  distanceM: number;
};

export type FilmOverlayCone = {
  apex: Vec3;
  /** The frame at the aimed distance: top left, top right, bottom right, bottom left, as the camera sees it. */
  corners: [Vec3, Vec3, Vec3, Vec3];
  /** The selected beat's end, drawn solid; its start is drawn dashed. */
  selected: boolean;
};

export type FilmOverlayPlan = { path: Vec3[]; keys: FilmOverlayKey[]; cones: FilmOverlayCone[] };

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : [0, 0, -1];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * What a keyframe's lens sees, as a cone: from the camera to the frame it
 * draws at the distance it aims. `frame` is the picture's shape: the band's
 * width over its height, and the band's share of the render's height (the
 * field of view is measured across the render; a Scope band is part of it).
 */
export function filmCone(pose: FilmPose, frame: { bandAspect: number; heightShare: number }, selected: boolean): FilmOverlayCone {
  const toTarget = sub(pose.target, pose.position);
  const depth = Math.min(FILM_CONE_MAX_M, Math.max(FILM_CONE_MIN_M, len(toTarget)));
  const forward = norm(toTarget);
  // Straight up or down, "right" is taken from the world's x.
  const sideways = cross(forward, [0, 1, 0]);
  const right = len(sideways) > 1e-6 ? norm(sideways) : ([1, 0, 0] as Vec3);
  const up = norm(cross(right, forward));
  const halfH = depth * Math.tan((pose.fovDeg * Math.PI) / 360) * frame.heightShare;
  const halfW = halfH * frame.bandAspect;
  const centre = add(pose.position, scale(forward, depth));
  const at = (w: number, h: number) => add(centre, add(scale(right, w), scale(up, h)));
  return { apex: pose.position, corners: [at(-halfW, halfH), at(halfW, halfH), at(halfW, -halfH), at(-halfW, -halfH)], selected };
}

/** The overlay for a film: its path, its numbered keyframes and the selected beat's cones. */
export function planFilmOverlay(input: {
  start: FilmPose | null;
  beats: readonly { end: FilmPose; move: FilmMove | null }[];
  /** The selected beat (from 0), or null. */
  selected: number | null;
  mark: { x: number; z: number };
  frame: { bandAspect: number; heightShare: number };
  /** The rig's sensor, for the lens each keyframe is named as (rig.ts sensorHeightMm); full frame when absent. */
  sensorHeightMm?: number;
}): FilmOverlayPlan {
  const { start, beats, selected, mark, frame } = input;
  const keyOf = (pose: FilmPose, number: number, isSelected: boolean): FilmOverlayKey => ({
    at: pose.position,
    number,
    selected: isSelected,
    lensMm: nearestLens(pose.fovDeg, input.sensorHeightMm),
    distanceM: Math.hypot(pose.position[0] - mark.x, pose.position[1] - FILM_EYE_M, pose.position[2] - mark.z),
  });

  const keys: FilmOverlayKey[] = [];
  if (start) keys.push(keyOf(start, 1, false));
  beats.forEach((beat, i) => keys.push(keyOf(beat.end, i + 2, selected === i)));

  const path: Vec3[] = [];
  beats.forEach((beat, i) => {
    const from = i === 0 ? start : beats[i - 1].end;
    if (!from) return;
    for (let s = path.length === 0 ? 0 : 1; s <= FILM_PATH_SAMPLES; s++) {
      path.push(poseAlong(beat.move, from, beat.end, s / FILM_PATH_SAMPLES).position);
    }
  });

  const cones: FilmOverlayCone[] = [];
  if (selected !== null && beats[selected]) {
    const from = selected === 0 ? start : beats[selected - 1].end;
    if (from) cones.push(filmCone(from, frame, false));
    cones.push(filmCone(beats[selected].end, frame, true));
  }
  return { path, keys, cones };
}
