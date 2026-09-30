import { describe, expect, it } from "vitest";
import { RECAST_DIRECTION_MAX_CHARS } from "../recast/recast-brief";
import race from "./fixtures-race-track.json";
import {
  STUDIO_REAL_SCENE_MAX,
  STUDIO_RESTAGE_LINE,
  studioFigureLine,
  studioPlaceWords,
  studioRealSceneLine,
  studioRecastDirection,
  studioSceneLight,
} from "./studio-recast";

// "Real scene" (2026-09-30, operator: "Go ahead"): live Test A (8d425291)
// turned the whole race track real with restyle words beside the person's,
// same engine, same price, IDENTITY 92. These words are built from the scene.

describe("Real scene", () => {
  it("builds the scene's words from the set: a race track, its things by colour, the hour's light, every surface real, the moves kept", () => {
    const line = studioRealSceneLine({ title: race.title, description: race.description, things: ["the yellow car", "the grey barrier", "the yellow car"], hour: 15.8 });
    expect(line).toMatch(/^Make the whole scene real live-action footage: a real race track[ ,]/);
    expect(line).toContain("a real yellow car, a real grey barrier, natural daylight, shot on a cinema camera.");
    expect(line.match(/yellow car/g)).toHaveLength(1);
    expect(line).toContain("Every wall, building and surface becomes real material, never flat grey or blocky.");
    expect(line.endsWith("Keep the character's moves and the camera exactly.")).toBe(true);
    expect(line.length).toBeLessThanOrEqual(STUDIO_REAL_SCENE_MAX);
  });

  it("says the light the hour gives", () => {
    expect([6, 12, 18, 20, 23].map(studioSceneLight)).toEqual([
      "soft early-morning daylight",
      "natural daylight",
      "warm golden-hour light",
      "dusk light",
      "real night light from real lamps",
    ]);
  });

  it("knows a place by its words, and stays short when there is a lot to say", () => {
    expect(studioPlaceWords("Neon Alley", "A narrow downtown alley at night.")).toBe("a real city street (a narrow downtown alley at night)");
    expect(studioPlaceWords("Somewhere", "")).toBe("a real place");
    const long = studioRealSceneLine({ title: "X", description: "word ".repeat(80), things: ["the red car", "the blue van", "the green truck", "the white bus"], hour: 12 });
    expect(long.length).toBeLessThanOrEqual(STUDIO_REAL_SCENE_MAX);
  });

  it("on: sent beside the person's words and the figure line, inside Recast's 600; off: today's words", () => {
    const realScene = studioRealSceneLine({ title: race.title, description: race.description, things: ["the yellow car"], hour: 15.8 });
    const words = "She walks toward the camera, past the yellow car.";
    const on = studioRecastDirection({ words, several: false, spot: "middle", engine: "kling-edit", realScene });
    expect(on).toBe(`${words} ${studioFigureLine(false, "middle")} ${realScene}`);
    expect(on.length).toBeLessThanOrEqual(RECAST_DIRECTION_MAX_CHARS);
    expect(studioRecastDirection({ words, several: false, spot: "middle", engine: "kling-edit", realScene: null })).toBe(`${words} ${studioFigureLine(false, "middle")}`);
    // Restage: the real-scene line takes the place of its own live-action line, never both.
    const restaged = studioRecastDirection({ words: "", several: false, spot: "middle", engine: "h3-768", realScene });
    expect(restaged).not.toContain(STUDIO_RESTAGE_LINE);
    expect(restaged).toContain(realScene);
  });
});
