import { describe, expect, it } from "vitest";
import race from "./fixtures-race-track.json";
import { RECAST_DIRECTION_MAX_CHARS } from "../recast/recast-brief";
import { recastWindowCredits } from "../recast/trim";
import {
  STUDIO_OUTFIT_MAX,
  STUDIO_REAL_OUTFIT_LINE,
  STUDIO_REAL_SCENE_MAX,
  studioFigureLine,
  studioOutfitFromPrompt,
  studioRealSceneLine,
  studioRecastCredits,
  studioRecastDirection,
  studioRecastPhotos,
  studioRecastStart,
  studioRecastWindow,
  studioWalkWords,
  studioWearLine,
} from "./studio-recast";

// Operator, 2026-09-30: "Why is she walking weird and jumpy? Add outfit and make it so I can pick from eva's image
// gallery generation to pick from." — then "Fix every little detail … Make it happen."

describe("what they wear", () => {
  it("the Outfit box, a look from the gallery (image 1 to the engine), both, or neither", () => {
    expect(studioWearLine({ outfit: " a red leather jacket,  black jeans. ", look: false })).toBe("The character wears: a red leather jacket, black jeans.");
    expect(studioWearLine({ outfit: "", look: true })).toBe("The character wears the outfit and hair from image 1.");
    expect(studioWearLine({ outfit: "a navy gown", look: true })).toBe("The character wears: a navy gown (as in image 1).");
    expect(studioWearLine({ outfit: "  ", look: false })).toBeNull();
    // A photo's look is its outfit reference, which the render lane calls the outfit photo.
    expect(studioWearLine({ outfit: "", look: true, photo: true })).toBe("The character wears the outfit from the outfit photo.");
    expect(studioWearLine({ outfit: "a navy gown", look: true, photo: true })).toBe("The character wears: a navy gown (as in the outfit photo).");
  });

  it("replaces the photos' outfit in the Real scene line, which stays inside its cap by leaving out whole items", () => {
    const base = { title: race.title, description: race.description, things: ["the yellow car"], hour: 15.8 };
    expect(studioRealSceneLine(base)).toContain(STUDIO_REAL_OUTFIT_LINE);
    const longest = studioWearLine({ outfit: "x".repeat(STUDIO_OUTFIT_MAX + 50), look: true })!;
    const line = studioRealSceneLine({ ...base, wear: longest });
    expect(line).not.toContain(STUDIO_REAL_OUTFIT_LINE);
    expect(line).toContain(longest);
    expect(line.length).toBeLessThanOrEqual(STUDIO_REAL_SCENE_MAX);
    expect(line).toContain("a real sky with soft clouds, real ground");
    expect(line.endsWith("Keep the moves and camera exactly.")).toBe(true);
  });

  it("with Real scene off it is still said, after the figure line, inside Recast's 600", () => {
    const wear = studioWearLine({ outfit: "a white summer dress", look: false });
    const d = studioRecastDirection({ words: "She walks.", several: false, spot: "middle", engine: "kling-edit", realScene: null, wear });
    expect(d).toBe(`She walks. ${studioFigureLine(false, "middle")} The character wears: a white summer dress.`);
    const realScene = studioRealSceneLine({ title: race.title, description: race.description, things: [], hour: 12, wear });
    const full = studioRecastDirection({ words: "w".repeat(700), several: true, spot: "left", engine: "kling-edit", realScene, wear });
    expect(full.length).toBeLessThanOrEqual(RECAST_DIRECTION_MAX_CHARS);
    expect(full.endsWith("Keep the moves and camera exactly.")).toBe(true);
  });

  it("the outfit words a gallery picture's prompt gives, for the Outfit box", () => {
    expect(studioOutfitFromPrompt("Eva wearing a red leather jacket and black jeans, standing on a rooftop at dusk")).toBe("a red leather jacket and black jeans");
    expect(studioOutfitFromPrompt("Portrait of Eva, dressed in a navy blue evening gown. Soft light.")).toBe("a navy blue evening gown");
    expect(studioOutfitFromPrompt("Eva in a white linen suit walking through Rome")).toBe("white linen suit");
    expect(studioOutfitFromPrompt("A close-up of Eva laughing")).toBe("");
    expect(studioOutfitFromPrompt(null)).toBe("");
    expect(studioOutfitFromPrompt("wearing " + "a very long coat ".repeat(20)).length).toBeLessThanOrEqual(STUDIO_OUTFIT_MAX);
  });
});

describe("a look from the gallery, priced as Recast quotes it", () => {
  it("Into the clip: the same price (Kling O3 Edit bills seconds; the look is one of its four references)", () => {
    expect(studioRecastCredits("kling-edit", 5, 4, 1)).toBe(studioRecastCredits("kling-edit", 5, 4, 0));
  });
  it("Restage: one reference picture more, as Recast's own quote counts it (photos + added images)", () => {
    const refs = studioRecastPhotos("h3-768", 4) + 1;
    expect(studioRecastCredits("h3-768", 4, 4, 1)).toBe(recastWindowCredits("h3-768", { seconds: 4, frames: null }, studioRecastWindow(4), refs));
    expect(studioRecastCredits("h3-768", 4, 4, 1)).toBeGreaterThanOrEqual(studioRecastCredits("h3-768", 4, 4, 0));
  });
  it("goes to Recast as its added image", () => {
    const body = studioRecastStart({ sendId: "s", path: "p", characterId: "c", engine: "kling-edit", seconds: 4, direction: "", read: null, castTag: null, imagePath: "u1/studio-look-1.jpg" });
    expect(body.imagePaths).toEqual(["u1/studio-look-1.jpg"]);
    expect(studioRecastStart({ sendId: "s", path: "p", characterId: "c", engine: "kling-edit", seconds: 4, direction: "", read: null, castTag: null }).imagePaths).toBeUndefined();
  });
});

describe("what happens, as the shot camera sees it", () => {
  it("toward, away, across — or nothing to say for a small step", () => {
    expect(studioWalkWords({ depth0: 13, depth1: 3, x0: 0.1, x1: 0 })).toBe("toward the camera");
    expect(studioWalkWords({ depth0: 3, depth1: 9, x0: 0, x1: 0.1 })).toBe("away from the camera");
    expect(studioWalkWords({ depth0: 6, depth1: 6.2, x0: -0.7, x1: 0.6 })).toBe("across the frame from left to right");
    expect(studioWalkWords({ depth0: 8, depth1: 4, x0: 0.6, x1: -0.3 })).toBe("toward the camera, crossing the frame from right to left");
    expect(studioWalkWords({ depth0: 6, depth1: 6.3, x0: 0, x1: 0.1 })).toBeNull();
  });
});
