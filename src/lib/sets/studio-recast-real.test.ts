import { describe, expect, it } from "vitest";
import { RECAST_DIRECTION_MAX_CHARS } from "../recast/recast-brief";
import race from "./fixtures-race-track.json";
import {
  STUDIO_REAL_OUTFIT_LINE,
  STUDIO_REAL_SCENE_MAX,
  STUDIO_RESTAGE_LINE,
  studioDescribedThings,
  studioFigureLine,
  studioPlaceWords,
  studioRealSceneLine,
  studioRecastDirection,
  studioSceneLight,
  studioSceneSky,
} from "./studio-recast";

// "Real scene" (2026-09-30). Live Test A (8d425291, IDENTITY 92) was
// handwritten: "Turn the whole scene into real live-action footage: a real
// race track with real asphalt, kerbs and grass, a real concrete pit building,
// a real yellow sports car, natural daylight, shot on a cinema camera." The
// first built line (f997e4ea, IDENTITY 72) quoted the set's description, was
// cut inside a clause ("…beside a)"), named no sky or ground (both stayed
// flat CG) and said nothing of the outfit (a black evening dress appeared).
// Operator: "fix".

const RACE_LINE =
  "Turn the whole scene into real live-action footage: a real race track with real asphalt, kerbs and grass, a real concrete pit building, a real scarlet sports car, natural daylight, a real sky with soft clouds, real ground, shot on a cinema camera. The character keeps the outfit and hair from the photos. Keep the moves and camera exactly.";

/** The comma-separated items between the colon and ", shot on a cinema camera". */
function items(line: string): string[] {
  const body = line.slice(line.indexOf(": ") + 2, line.indexOf(", shot on a cinema camera."));
  return body.split(/, (?=a real |real |natural |soft |warm |dusk )/);
}
const KNOWN = /^(a real [a-z ]+( with real [a-z, ]+)?|real [a-z ]+|natural daylight|soft early-morning daylight|warm golden-hour light|dusk light|a real [a-z ]+ sky( with soft clouds)?( through the windows)?)$/;

describe("Real scene", () => {
  it("the race-track fixture reads like Test A's words, with the sky, the ground and the outfit added", () => {
    const line = studioRealSceneLine({ title: race.title, description: race.description, things: [], hour: 15.8 });
    expect(line).toBe(RACE_LINE);
    expect(line.length).toBeLessThanOrEqual(STUDIO_REAL_SCENE_MAX);
    // Nothing of the set's own sentences, which is where the cut came from.
    expect(line).not.toMatch(/[()]|sunlit|unbadged|angular/);
  });

  it("names the things the set's words give a colour, as the engine hears them", () => {
    expect(studioDescribedThings("A yellow sports coupe rests upright inside an open cockpit garage beside a")).toEqual(["yellow sports car"]);
    expect(studioDescribedThings(race.description)).toEqual(["scarlet sports car"]);
    expect(studioDescribedThings("Golden afternoon light over grey concrete.")).toEqual([]);
  });

  it("at the cap, whole items go, lowest first; nothing is cut mid-clause, and the sky, ground and outfit always stay", () => {
    const crowded = studioRealSceneLine({
      title: "Scarlet Apex Circuit",
      description: `${race.description} A yellow sports coupe, a blue van and a white bus wait by the pit lane.`,
      things: ["the green truck", "the black motorcycle", "the silver jet"],
      hour: 12,
    });
    expect(crowded.length).toBeLessThanOrEqual(STUDIO_REAL_SCENE_MAX);
    expect(crowded).toContain("a real scarlet sports car"); // the first thing is the last to go
    expect(crowded).not.toContain("silver jet");
    for (const item of items(crowded)) expect(item).toMatch(KNOWN);
    for (const hour of [3, 6, 12, 18, 20]) {
      for (const [title, description] of [
        [race.title, race.description],
        ["Neon Alley", "A narrow downtown alley with a black taxi, a red scooter, a white van and a blue bus beside tall buildings and walls."],
        ["Loft", "An apartment loft kitchen."],
        ["X", "word ".repeat(200)],
      ]) {
        const line = studioRealSceneLine({ title, description, things: ["the red car", "the blue van", "the green truck", "the white bus"], hour });
        expect(line.length).toBeLessThanOrEqual(STUDIO_REAL_SCENE_MAX);
        expect(line).toContain(studioSceneSky(hour));
        expect(line).toContain(", real ground, shot on a cinema camera.");
        expect(line).toContain(STUDIO_REAL_OUTFIT_LINE);
        expect(line.endsWith("Keep the moves and camera exactly.")).toBe(true);
        expect(line).not.toMatch(/\b(she|he|her|his)\b/i);
        for (const item of items(line)) expect(item).toMatch(KNOWN);
      }
    }
  });

  it("a street, an interior and an unknown place get their own real surfaces", () => {
    expect(studioRealSceneLine({ title: "Neon Alley", description: "A narrow downtown alley with a black taxi.", things: ["the red scooter"], hour: 22 })).toBe(
      "Turn the whole scene into real live-action footage: a real city street with real pavement, kerbs and shopfronts, a real black taxi, a real red scooter, real night light from real lamps, a real night sky, real ground, shot on a cinema camera. The character keeps the outfit and hair from the photos. Keep the moves and camera exactly.",
    );
    expect(studioPlaceWords("Loft", "An apartment loft kitchen.")).toBe("a real home with real furniture, floors and walls");
    expect(studioRealSceneLine({ title: "Loft", description: "An apartment loft kitchen.", things: [], hour: 12 })).toContain("a real sky with soft clouds through the windows");
    expect(studioPlaceWords("Somewhere", "")).toBe("a real place with real walls, floors and materials");
  });

  it("says the light and the sky the hour gives", () => {
    expect([6, 12, 18, 20, 23].map(studioSceneLight)).toEqual([
      "soft early-morning daylight",
      "natural daylight",
      "warm golden-hour light",
      "dusk light",
      "real night light from real lamps",
    ]);
    expect([6, 12, 18, 20, 23].map(studioSceneSky)).toEqual(["a real morning sky", "a real sky with soft clouds", "a real golden evening sky", "a real dusk sky", "a real night sky"]);
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
