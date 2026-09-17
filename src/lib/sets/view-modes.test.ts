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

  it("draws the live view only: both pages set the override around their draw, and the shoot clears it before the sketch", () => {
    const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
    const editor = readFileSync(join(__dirname, "../../components/sets/set-editor.tsx"), "utf8");
    // The shoot (the studio's frame, cut A): the override is set just before
    // the live draw and cleared right after it, so frame() and snapshot()
    // — the sketch the picture model reads — never see it.
    const live = view.slice(view.indexOf("const renderLive = () => {"), view.indexOf("const loop = () => {"));
    expect(live.indexOf("scene.overrideMaterial = viewOverride;")).toBeGreaterThan(-1);
    expect(live.indexOf("scene.overrideMaterial = null;")).toBeGreaterThan(live.indexOf("renderer.render(scene, camera);"));
    const frame = view.slice(view.indexOf("          frame(opts) {"), view.indexOf("          relayout() {"));
    expect(frame).not.toContain("overrideMaterial");
    expect(view).toContain("viewOverride = viewModeMaterial(THREE, mode);");
    expect(editor).toContain("scene.overrideMaterial = viewModeMaterial(THREE, mode)");
  });
});
