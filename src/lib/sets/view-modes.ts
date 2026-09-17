// Viewport modes for Build (the studio, cut 4, 2026-09-17): Lit is the
// stage as it is; Clay draws every surface in one matte grey, so the light
// and the forms read without the colours; Wire draws the edges; Depth draws
// distance. A mode is the scene's override material — three draws every
// mesh with it and nothing else changes. Since the studio's frame (cut A)
// every mode of the page has it, on the live view only: every frame the
// picture model is shown stays lit (set-view.tsx renderLive, frame).

import type * as ThreeNS from "three";

type Three = typeof ThreeNS;

export const VIEW_MODES = ["lit", "clay", "wire", "depth"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** The override material for a mode, or null for the stage as lit. The caller frees the last one. */
export function viewModeMaterial(THREE: Three, mode: ViewMode): ThreeNS.Material | null {
  switch (mode) {
    case "lit":
      return null;
    case "clay":
      return new THREE.MeshStandardMaterial({ color: new THREE.Color("#a9a49b"), roughness: 0.9, metalness: 0 });
    case "wire":
      return new THREE.MeshBasicMaterial({ color: new THREE.Color("#c6c9d1"), wireframe: true });
    case "depth":
      return new THREE.MeshDepthMaterial();
  }
}
