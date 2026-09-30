// Helios Studio · "Video with your character" · the wall warning (2026-09-30,
// operator: "Go ahead"). Live Test A turned the whole race track real — all
// but one big plain grey wall of The place, close to the camera and filling
// the left third of the frame, which the engine left as a dark slab. Before
// a send, the shot camera's first frame is sampled on a grid of rays: the
// share whose first hit is a flat, untextured, upright block of The place
// within a few metres is how much of the frame such a wall fills. Past
// WALL_WARN_SHARE the window says so; it never blocks the send.

import * as THREE from "three";

/** Closer than this, a plain wall reads as a slab to the engine. */
export const WALL_NEAR_M = 8;
/** A block counts as a wall when two of its sides are at least this long. */
export const WALL_MIN_SIDE_M = 2;
/** Over this share of the frame, the window warns. */
export const WALL_WARN_SHARE = 0.25;
const COLS = 24;
const ROWS = 14;

/** A big plain block: two sides at least WALL_MIN_SIDE_M, and no picture on any of its materials. */
export function isPlainBlock(mesh: THREE.Object3D): boolean {
  const m = mesh as THREE.Mesh;
  if (!m.isMesh) return false;
  const mats = (Array.isArray(m.material) ? m.material : [m.material]) as (THREE.Material & { map?: THREE.Texture | null })[];
  if (mats.some((mat) => mat?.map)) return false;
  const size = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
  return [size.x, size.y, size.z].filter((s) => s >= WALL_MIN_SIDE_M).length >= 2;
}

/**
 * The share of the camera's frame (0–1) whose first hit, among `occluders`,
 * is an upright face of a plain block `isWall` accepts, within WALL_NEAR_M.
 * Floors and ceilings don't count: a road is not a wall.
 */
export function wallShare(camera: THREE.Camera, occluders: THREE.Object3D[], isWall: (mesh: THREE.Object3D) => boolean): number {
  camera.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  let hits = 0;
  const normal = new THREE.Vector3();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ray.setFromCamera(new THREE.Vector2(((c + 0.5) / COLS) * 2 - 1, ((r + 0.5) / ROWS) * 2 - 1), camera);
      const first = ray.intersectObjects(occluders, true).find((h) => (h.object as THREE.Mesh).isMesh && h.object.visible);
      if (!first || first.distance > WALL_NEAR_M || !first.face || !isWall(first.object)) continue;
      normal.copy(first.face.normal).transformDirection(first.object.matrixWorld);
      if (Math.abs(normal.y) < 0.5) hits++;
    }
  }
  return hits / (COLS * ROWS);
}

export function wallWarns(share: number): boolean {
  return share > WALL_WARN_SHARE;
}
