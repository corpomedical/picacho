import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { VIEW_MODES, viewModeMaterial } from "./view-modes";

// Build's viewport modes (the studio, cut 4): an override material per
// mode, none for the stage as lit.

describe("viewModeMaterial", () => {
  it("is nothing for lit, a matte grey for clay, edges for wire, distance for depth", () => {
    expect(viewModeMaterial(THREE, "lit")).toBeNull();
    const clay = viewModeMaterial(THREE, "clay") as THREE.MeshStandardMaterial;
    expect(clay.isMeshStandardMaterial).toBe(true);
    expect(clay.roughness).toBe(0.9);
    const wire = viewModeMaterial(THREE, "wire") as THREE.MeshBasicMaterial;
    expect(wire.wireframe).toBe(true);
    const depth = viewModeMaterial(THREE, "depth") as THREE.MeshDepthMaterial;
    expect(depth.isMeshDepthMaterial).toBe(true);
    expect(VIEW_MODES).toEqual(["lit", "clay", "wire", "depth"]);
  });

  it("is Build's only: the shoot's stage never overrides a material", () => {
    // Read as source: the frame the picture model is shown stays lit.
    const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
    expect(view).not.toContain("overrideMaterial");
    const editor = readFileSync(join(__dirname, "../../components/sets/set-editor.tsx"), "utf8");
    expect(editor).toContain("scene.overrideMaterial = viewModeMaterial(THREE, mode)");
  });
});
