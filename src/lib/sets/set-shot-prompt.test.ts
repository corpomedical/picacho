import { describe, expect, it } from "vitest";
import { LOOK_SENTENCE, SET_SHOT_FIXED_SENTENCES, SOURCE_PHOTO_SENTENCE, buildSetShotPrompt, describeFacing, stripSetShotScaffold } from "./set-shot-prompt";
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

  // The words the look was tested with (2026-09-12, "C3": a SAM 2 cutout in
  // production's image order, the photos unnumbered; 2026-09-14, the object
  // sheet drawn from that cutout, the same order) — word for word, because
  // these words are what was measured.
  const C3 =
    "One reference photo is a design sheet of objects from this same place: each shown several times on a plain grey ground, from different sides. Draw each of them exactly as it looks there — its shape, design, colour, materials and details — in the place, at the size and turned the way the layout sketch shows it, seen from the sketch's camera. Take nothing else from that photo: not its layout, angle, crop, framing or light.";

  it("with a look, says the tested sentence about the sheet, word for word, and only then", () => {
    const withLook = buildSetShotPrompt({ description: "d", direction: "", look: { url: "/api/media/generated-images/u/sets/s.sheet-g.jpg" } });
    expect(withLook).toContain(C3);
    expect(LOOK_SENTENCE).toBe(C3);
    expect(withLook.split(C3).length - 1).toBe(1);
    expect(p).not.toContain("design sheet");
    expect(buildSetShotPrompt({ description: "d", direction: "", look: null })).not.toContain("design sheet");
  });

  it("puts it after the place and before the person, as it was tested", () => {
    const withLook = buildSetShotPrompt({ description: "Rain-dark cobbles.", direction: "She waits.", look: {} });
    expect(withLook.indexOf("Render the location photorealistically")).toBeLessThan(withLook.indexOf(C3));
    expect(withLook.indexOf(C3)).toBeLessThan(withLook.indexOf("The person stands where the grey figure stands"));
  });

  it("says nothing about a person or an outfit in the look: the cutout holds none", () => {
    // Whatever the caller hands in as the look, the words are the same.
    const a = buildSetShotPrompt({ description: "d", direction: "", look: { sameCharacter: true, savedOutfit: false } });
    const b = buildSetShotPrompt({ description: "d", direction: "", look: { sameCharacter: false } });
    const c = buildSetShotPrompt({ description: "d", direction: "", look: { url: "x" } });
    expect(a).toBe(c);
    expect(b).toBe(c);
    for (const gone of ["The person in it", "dress them as they are dressed there", "outfit photo", "earlier still", "not its camera, framing or light"]) {
      expect(c).not.toContain(gone);
    }
  });

  it("stays under the prompt cap with every sentence in", () => {
    const layout = { mark: { x: 0, z: 0, facingDeg: 135 }, camera: { position: [0, 1.6, 5] as [number, number, number], target: [0, 1, 0] as [number, number, number], fovDeg: 40 } };
    const longest = buildSetShotPrompt({ description: "d".repeat(300), direction: "x".repeat(300), lifted: true, layout, look: { url: "x" } });
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

describe("stripSetShotScaffold", () => {
  // The brand-rule check reads a Set shot through this (pipeline.ts setShot):
  // the operator's fourth still lost an attempt to "No copyrighted
  // characters" on the sentence about the character photos.
  const layout = { mark: { x: 0, z: 0, facingDeg: 135 }, camera: { position: [0, 1.6, 5] as [number, number, number], target: [0, 1, 0] as [number, number, number], fovDeg: 40 } };

  it("leaves Astra's description and the person's direction, and nothing of Picacho's fixed sentences", () => {
    const full = buildSetShotPrompt({ description: "A sunlit circuit; an unbadged scarlet supercar.", direction: "She leans on the car.", lifted: true, layout, look: {} });
    const left = stripSetShotScaffold(full);
    expect(left).toBe("A sunlit circuit; an unbadged scarlet supercar. In this frame: She leans on the car.");
    for (const fixed of SET_SHOT_FIXED_SENTENCES) expect(left).not.toContain(fixed);
    expect(left).not.toContain("grey figure");
    expect(left).not.toContain("character photos");
  });

  it("strips every facing the figure can have, and a prompt with no description or direction to nothing", () => {
    for (const facingDeg of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const full = buildSetShotPrompt({ description: "d", direction: "", layout: { ...layout, mark: { ...layout.mark, facingDeg } } });
      expect(stripSetShotScaffold(full), String(facingDeg)).toBe("d");
    }
    expect(stripSetShotScaffold(buildSetShotPrompt({ description: "", direction: "" }))).toBe("");
  });

  it("every fixed sentence is one the prompt is built from", () => {
    const full = buildSetShotPrompt({
      description: "d",
      direction: "x",
      lifted: true,
      layout: null,
      look: {},
      sourcePhoto: true,
    });
    for (const fixed of SET_SHOT_FIXED_SENTENCES) {
      if (fixed.endsWith("looks:") || fixed.endsWith("looks.")) continue;
      expect(full, fixed.slice(0, 40)).toContain(fixed);
    }
    expect(SET_SHOT_FIXED_SENTENCES).toContain(LOOK_SENTENCE);
  });

  it("says what the source photograph is only when one rides, and the strip removes it", () => {
    const withPhoto = buildSetShotPrompt({ description: "d", direction: "", sourcePhoto: true });
    expect(withPhoto).toContain(SOURCE_PHOTO_SENTENCE);
    // The photograph's people are named out of the shot, in the sentence itself.
    expect(SOURCE_PHOTO_SENTENCE).toContain("they are not in this shot");
    expect(stripSetShotScaffold(withPhoto)).toBe("d");
    expect(buildSetShotPrompt({ description: "d", direction: "" })).not.toContain(
      "real photograph of this same location",
    );
  });
});
