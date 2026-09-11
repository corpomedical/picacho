import { describe, expect, it } from "vitest";
import { buildSetShotPrompt, describeFacing } from "./set-shot-prompt";
import { SET_DIRECTION_MAX_CHARS } from "./set-config";

// The server-built prompt for a still in a Set. What it must always say is
// what makes the sketch a layout and the character photos the only face.

describe("buildSetShotPrompt", () => {
  const p = buildSetShotPrompt({ description: "Rain-dark cobbles under amber lamps.", direction: "She looks back over her shoulder." });

  it("asks for the sketch's composition — the one thing the pipeline otherwise forbids copying", () => {
    expect(p).toMatch(/Match its camera position, lens, framing, horizon/);
  });

  it("takes identity only from the character photos, never the grey figure", () => {
    expect(p).toMatch(/take the person's face, hair and features only from the character photos/);
  });

  it("says the sketch's brightness is not the scene's — only when the sketch was lifted", () => {
    const lifted = buildSetShotPrompt({ description: "d", direction: "", lifted: true });
    expect(lifted).toContain("take the time of day, how dark it is and the colour of the light from the description, not from the sketch");
    expect(p).not.toContain("lit brighter");
  });

  it("carries the set's description and the person's direction", () => {
    expect(p).toContain("Rain-dark cobbles under amber lamps.");
    expect(p).toContain("In this frame: She looks back over her shoulder.");
  });

  it("works with no direction, and bounds a long one", () => {
    expect(buildSetShotPrompt({ description: "d", direction: "" })).not.toContain("In this frame");
    const long = buildSetShotPrompt({ description: "d", direction: "x".repeat(5000) });
    expect(long.length).toBeLessThan(1500);
    expect(long).toContain("x".repeat(SET_DIRECTION_MAX_CHARS));
  });

  it("stays far under the composer's 8,000-character prompt cap", () => {
    const layout = { mark: { x: 0, z: 0, facingDeg: 135 }, camera: { position: [0, 1.6, 5] as [number, number, number], target: [0, 1, 0] as [number, number, number], fovDeg: 40 } };
    const longest = buildSetShotPrompt({ description: "d".repeat(300), direction: "x".repeat(300), lifted: true, layout });
    expect(longest.length).toBeLessThan(2600);
  });

  it("says the sketch's objects are block stand-ins for real things, never toys", () => {
    expect(p).toContain("rough stand-in built from simple blocks");
    expect(p).toContain("draw the real thing it stands for");
    expect(p).toContain("nothing may look like a toy, a model or a miniature");
  });

  it("asks for a gaze that can be read", () => {
    expect(p).toContain("Wherever they are looking, make it unmistakable");
  });

  it("with an earlier still as the look, keeps the set's objects the same and nothing else", () => {
    const same = buildSetShotPrompt({ description: "d", direction: "", look: { sameCharacter: true } });
    expect(same).toContain("an earlier still from this same set");
    expect(same).toContain("keep each one's design, colour, materials and details exactly as they are there");
    expect(same).toContain("not its camera, framing or light");
    expect(same).toContain("dress them as they are dressed there");
    expect(same).toContain("Their face, hair and features still come only from the character photos.");
    const other = buildSetShotPrompt({ description: "d", direction: "", look: { sameCharacter: false } });
    expect(other).toContain("The person in it is someone else: take nothing about them from it.");
    expect(other).not.toContain("dress them as they are dressed there");
    expect(p).not.toContain("earlier still");
  });

  it("never gives two clothing instructions: a saved outfit photo decides what they wear", () => {
    const saved = buildSetShotPrompt({ description: "d", direction: "", look: { sameCharacter: true, savedOutfit: true } });
    expect(saved).toContain("take what they wear from the outfit photo");
    expect(saved).not.toContain("dress them as they are dressed there");
    expect(saved).toContain("an earlier still from this same set");
  });

  it("stays under the prompt cap with every sentence in", () => {
    const layout = { mark: { x: 0, z: 0, facingDeg: 135 }, camera: { position: [0, 1.6, 5] as [number, number, number], target: [0, 1, 0] as [number, number, number], fovDeg: 40 } };
    const longest = buildSetShotPrompt({ description: "d".repeat(300), direction: "x".repeat(300), lifted: true, layout, look: { sameCharacter: true } });
    expect(longest.length).toBeLessThan(3000);
  });
});

describe("describeFacing", () => {
  // Camera 5 m down +Z, looking back at the origin along -Z: screen right is +X.
  const cam = { position: [0, 1.6, 5] as [number, number, number], target: [0, 1, 0] as [number, number, number], fovDeg: 40 };
  const at = (facingDeg: number) => describeFacing({ mark: { x: 0, z: 0, facingDeg }, camera: cam });

  it("puts the figure's facing in the camera's terms", () => {
    expect(at(0)).toBe("faces the camera");
    expect(at(45)).toBe("is turned three-quarters toward the camera, facing frame right");
    expect(at(315)).toBe("is turned three-quarters toward the camera, facing frame left");
    expect(at(90)).toBe("is in profile, facing frame right");
    expect(at(270)).toBe("is in profile, facing frame left");
    expect(at(135)).toBe("is turned three-quarters away from the camera, facing frame right");
    expect(at(180)).toBe("has their back to the camera");
  });

  it("reads the operator's second showroom take the way the frame shows it", () => {
    // The layout saved with that take (2026-09-11): the figure turned to 60°,
    // the camera behind and to the left of it.
    const take2 = {
      mark: { x: 1.8, z: 1.3, facingDeg: 60 },
      camera: { position: [-4.084, 2.26, 4.486] as [number, number, number], target: [0, 0.95, 0.3] as [number, number, number], fovDeg: 49 },
    };
    expect(describeFacing(take2)).toBe("is turned three-quarters away from the camera, facing frame right");
    expect(buildSetShotPrompt({ description: "d", direction: "", layout: take2 })).toContain(
      "their body is turned three-quarters away from the camera, facing frame right.",
    );
  });

  it("falls back to the figure's own facing with no camera pose, or a camera on the spot", () => {
    expect(describeFacing(null)).toBeNull();
    expect(describeFacing({ mark: { x: 0, z: 0, facingDeg: 0 }, camera: null })).toBeNull();
    expect(describeFacing({ mark: { x: 0, z: 5, facingDeg: 0 }, camera: cam })).toBeNull();
    expect(buildSetShotPrompt({ description: "d", direction: "", layout: null })).toContain("facing the same way");
  });
});
