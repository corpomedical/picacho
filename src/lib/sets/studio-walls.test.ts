import { describe, expect, it } from "vitest";
import * as THREE from "three";
import race from "./fixtures-race-track.json";
import { WALL_WARN_SHARE, isPlainBlock, wallShare, wallWarns } from "./studio-walls";

// The wall warning (2026-09-30): the race-track fixture's own blocks, built
// as boxes where the set says they stand, sampled from a shot camera.

type Obj = { size: number[]; position: number[]; rotation: number[]; repeat: { count: number; offset: number[] } | null; color: string };
const DEG = Math.PI / 180;

function place(): THREE.Group {
  const g = new THREE.Group();
  for (const o of race.objects as Obj[]) {
    const n = o.repeat?.count ?? 1;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(o.size[0], Math.max(0.01, o.size[1]), o.size[2]), new THREE.MeshStandardMaterial({ color: o.color }));
      const off = o.repeat?.offset ?? [0, 0, 0];
      m.position.set(o.position[0] + off[0] * i, o.position[1] + off[1] * i, o.position[2] + off[2] * i);
      m.rotation.set(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG);
      g.add(m);
    }
  }
  g.updateMatrixWorld(true);
  return g;
}

function camera(at: [number, number, number], look: [number, number, number]): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 500);
  c.position.set(...at);
  c.lookAt(...look);
  c.updateMatrixWorld(true);
  return c;
}

describe("the wall warning on the race-track fixture", () => {
  const set = place();
  const inSet = (m: THREE.Object3D) => isPlainBlock(m);

  it("the set's own establishing camera: no plain wall close enough to warn", () => {
    const c1 = race.cameras[0];
    const share = wallShare(camera(c1.position as [number, number, number], c1.target as [number, number, number]), [set], inSet);
    expect(share).toBeLessThan(WALL_WARN_SHARE);
    expect(wallWarns(share)).toBe(false);
  });

  it("a camera 3 m from the pit building's plain face, looking along it: the wall fills the frame's side and it warns", () => {
    // The pit building is a 28 × 8 × 120 m block whose face stands at x = 17.
    const share = wallShare(camera([14, 1.6, 10], [17, 1.6, -4]), [set], inSet);
    expect(share).toBeGreaterThan(WALL_WARN_SHARE);
    expect(wallWarns(share)).toBe(true);
  });

  it("the fixture's 4 × 20 m side wall beside the road (x −4…0) fills half the frame of a camera next to it", () => {
    const share = wallShare(camera([0.5, 1.6, 40], [0.5, 0.8, 30]), [set], inSet);
    expect(share).toBeGreaterThan(0.4);
    expect(wallWarns(share)).toBe(true);
  });

  it("the road under the camera never counts, and a textured block is not plain", () => {
    expect(wallShare(camera([6, 3, 40], [6.01, 0, 40]), [set], inSet)).toBe(0);
    const textured = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshStandardMaterial({ map: new THREE.Texture() }));
    expect(isPlainBlock(textured)).toBe(false);
    expect(isPlainBlock(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 4), new THREE.MeshStandardMaterial()))).toBe(false);
  });
});
