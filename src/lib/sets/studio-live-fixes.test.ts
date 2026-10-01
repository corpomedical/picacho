import { describe, expect, it } from "vitest";
import { RECAST_DIRECTION_MAX_CHARS } from "../recast/recast-brief";
import { normaliseSetSpec, type SetSpec } from "./set-spec";
import { setElements } from "./elements";
import { studioSetParts } from "./studio-parts";
import race from "./fixtures-race-track.json";
import {
  STUDIO_OUTFIT_MAX,
  STUDIO_REAL_OUTFIT_LINE,
  STUDIO_REAL_SCENE_MAX,
  studioCameraCuts,
  studioClayClip,
  studioRealSceneLine,
  studioRecastDirection,
  studioRecastHappens,
  studioSavedOutfit,
  studioScenePartWords,
  studioVisibleParts,
  studioWearLine,
  studioWorldWalkWords,
  type StudioCameraSample,
} from "./studio-recast";

// Helios Studio's live run on picacho.ai, 2026-10-01 (set f0fe7379, the race track): the operator deleted "Pit
// garage", "Wall 2" and "Wall", keyed the camera to hard-cut between three angles, turned on Realistic materials
// and the photographed sky, and sent "Video with your character". The words still named the pit building, the
// prefill said "they walk away from the camera" from one of the three angles, the car and track came back CG,
// and the character came out in a black evening dress again.

const specOf = (raw: unknown): SetSpec => {
  const n = normaliseSetSpec(raw);
  if (!n.ok) throw new Error("fixture");
  return n.spec;
};
const RACE = specOf(race);
const inThing = new Set<string>();
setElements(RACE).forEach((e) => e.members.forEach(([o, c]) => inThing.add(o + ":" + c)));
const RACE_PARTS = studioSetParts(RACE, inThing).map((p) => ({ name: p.name, kind: p.kind as string }));

describe("Real scene words come from the Studio scene as it is now", () => {
  it("the parts he deleted are never named, though the set's description still names a pit building", () => {
    expect(RACE_PARTS.map((p) => p.name)).toEqual(expect.arrayContaining(["Track", "Pit garage", "Wall"]));
    // The description names the pit garage: from the set's words alone, the old line says it.
    expect(studioRealSceneLine({ title: race.title, description: race.description, things: [], hour: 15.8 })).toContain("pit building");
    const left = RACE_PARTS.filter((p) => !["Pit garage", "Wall 2", "Wall"].includes(p.name));
    const line = studioRealSceneLine({ title: race.title, description: race.description, things: ["the yellow car"], parts: left, hour: 15.8 });
    expect(line).not.toMatch(/pit|garage/i);
    expect(line).not.toContain("real concrete walls");
    // What is left, as real things: the place, its surfaces, what still stands, the car in the shot.
    expect(line).toMatch(/^Turn the whole scene into real live-action footage: a real race track with real asphalt/);
    expect(line).toContain("a real yellow car");
    // Things come only from the shot: the description's scarlet car (not in this scene) is not said.
    expect(line).not.toContain("scarlet");
    expect(line.length).toBeLessThanOrEqual(STUDIO_REAL_SCENE_MAX);
  });

  it("each part is said as what it is; a part out of the shot all through the range is not said", () => {
    expect(studioScenePartWords([
      { name: "Pit garage", kind: "building" },
      { name: "Building 2", kind: "building" },
      { name: "Grandstand", kind: "stand" },
      { name: "Track", kind: "road" },
      { name: "Kerbs", kind: "kerb" },
      { name: "Pavement", kind: "ground" },
      { name: "Posts", kind: "pole" },
    ])).toEqual({ buildings: ["a real concrete pit building", "real buildings", "real grandstands"], surfaces: ["asphalt", "kerbs", "pavement"] });
    const track = { name: "Track", kind: "road" }, stand = { name: "Grandstand", kind: "stand" }, pit = { name: "Pit garage", kind: "building" };
    // Three camera angles: the grandstand is only in the second, the pit garage in none.
    const seen = studioVisibleParts([
      [{ part: track, inView: true, size: 3 }, { part: stand, inView: false, size: 1 }, { part: pit, inView: false, size: 2 }],
      [{ part: track, inView: true, size: 2 }, { part: stand, inView: true, size: 4 }, { part: pit, inView: false, size: 2 }],
      [{ part: track, inView: true, size: 1 }, { part: stand, inView: false, size: 1 }, { part: pit, inView: false, size: 9 }],
    ]);
    expect(seen).toEqual([stand, track]);
    // Nothing in the shot: no buildings, no surfaces, and still a whole sentence.
    const bare = studioRealSceneLine({ title: race.title, description: race.description, things: [], parts: [], hour: 12 });
    expect(bare).toContain("a real race track, natural daylight");
    expect(bare).not.toMatch(/pit|scarlet|kerbs/);
  });
});

describe("What happens, when the camera cuts", () => {
  const still = (p: [number, number, number], d: [number, number, number], n: number): StudioCameraSample[] => Array.from({ length: n }, () => ({ p, d }));
  const unit = (x: number, y: number, z: number): [number, number, number] => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
  // His keys: 1→40 (1,-8,1.6)→(5,-7,1.6) | 41→80 (10.5,-6.5,0.7→1.3) | 81→120 (-1,1.5,5)→(1.5,2.5,5).
  const cuts: StudioCameraSample[] = [
    ...Array.from({ length: 40 }, (_, i) => ({ p: [1 + (4 * i) / 39, -8 + i / 39, 1.6] as [number, number, number], d: unit(0, 1, -0.1) })),
    ...Array.from({ length: 40 }, (_, i) => ({ p: [10.5, -6.5, 0.7 + (0.6 * i) / 39] as [number, number, number], d: unit(-1, 0.5, 0) })),
    ...Array.from({ length: 40 }, (_, i) => ({ p: [-1 + (2.5 * i) / 39, 1.5 + i / 39, 5] as [number, number, number], d: unit(0.2, -0.3, -1) })),
  ];

  it("hard cuts between three angles are two cuts; a fixed camera neither cuts nor moves; a dolly moves", () => {
    expect(studioCameraCuts(cuts)).toEqual({ cuts: 2, moving: true });
    expect(studioCameraCuts(still([0, 2, 8], unit(0, 0, -1), 120))).toEqual({ cuts: 0, moving: false });
    const dolly = Array.from({ length: 96 }, (_, i) => ({ p: [0, 2, 8 - i * 0.03] as [number, number, number], d: unit(0, 0, -1) }));
    expect(studioCameraCuts(dolly)).toEqual({ cuts: 0, moving: true });
  });

  it("the walk is said in world terms, never from one camera, and the cuts are named", () => {
    const words = studioRecastHappens("", [{ kind: "walk", from: 0, to: 4.8, toward: "away from the camera", gaze: "looking ahead", world: studioWorldWalkWords({ over: "the track", to: "the yellow car", stops: true, metres: 7 }) }], studioCameraCuts(cuts));
    expect(words).toBe("From 0 s to 4.8 s they walk across the track to the yellow car and stop beside it. The camera cuts between 3 angles.");
    expect(words).not.toMatch(/camera\b(?! cuts)/);
    // A fixed camera keeps the words as the camera sees them.
    expect(studioRecastHappens("", [{ kind: "walk", from: 0, to: 4.8, toward: "away from the camera", gaze: "looking ahead" }], { cuts: 0 })).toBe("From 0 s to 4.8 s they walk away from the camera, looking ahead.");
  });

  it("world words: over, to, stop; or how far when nothing is near", () => {
    expect(studioWorldWalkWords({ over: "the track", to: "the yellow car", stops: false, metres: 7 })).toBe("across the track toward the yellow car");
    expect(studioWorldWalkWords({ over: null, to: "the yellow car", stops: true, metres: 7 })).toBe("to the yellow car and stop beside it");
    expect(studioWorldWalkWords({ over: "the grass", to: null, stops: true, metres: 7 })).toBe("across the grass and stop");
    expect(studioWorldWalkWords({ over: null, to: null, stops: false, metres: 6.4 })).toBe("about 6 m");
    expect(studioWorldWalkWords({ over: null, to: null, stops: true, metres: 0.2 })).toBe("about 1 m and stop");
  });
});

describe("Video with your character's payload: a clay clip and the outfit said in words", () => {
  it("a clay clip is on whenever Real scene is, unless the person unticks it", () => {
    expect(studioClayClip(true, null)).toBe(true);
    expect(studioClayClip(true, undefined)).toBe(true);
    expect(studioClayClip(false, null)).toBe(false);
    expect(studioClayClip(true, false)).toBe(false);
    expect(studioClayClip(false, true)).toBe(true);
  });

  it("the character's saved outfit is said when nothing else is picked; a look or typed words come first", () => {
    const saved = studioSavedOutfit({ traits: { outfit: "a white tank top and light blue jeans" } });
    expect(saved).toBe("a white tank top and light blue jeans");
    expect(studioWearLine({ outfit: "", look: false, saved })).toBe("The character wears their own outfit: a white tank top and light blue jeans.");
    expect(studioWearLine({ outfit: "", look: true, saved })).toBe("The character wears the outfit and hair from image 1.");
    expect(studioWearLine({ outfit: "a red jacket", look: false, saved })).toBe("The character wears: a red jacket.");
    expect(studioWearLine({ outfit: "", look: false, saved: "" })).toBeNull();
    // The outfit photos' description wins over the trait only when there are outfit photos (the generate lane's rule).
    expect(studioSavedOutfit({ traits: { outfit: "jeans" }, outfit_description: "a black leather biker jacket", outfit_image_urls: ["u/o.jpg"] })).toBe("a black leather biker jacket");
    expect(studioSavedOutfit({ traits: { outfit: "jeans" }, outfit_description: "a black leather biker jacket", outfit_image_urls: [] })).toBe("jeans");
    expect(studioSavedOutfit(null)).toBe("");
    const long = studioSavedOutfit({ traits: { outfit: "a fitted cream knit sweater with ribbed cuffs, high-waisted dark denim jeans, white leather sneakers and a thin gold necklace" } });
    expect(long.length).toBeLessThanOrEqual(STUDIO_OUTFIT_MAX);
    expect("a fitted cream knit sweater with ribbed cuffs, high-waisted dark denim jeans, white leather sneakers and a thin gold necklace".startsWith(long)).toBe(true);
    expect(long).not.toMatch(/[,\s]$/);
  });

  it("the direction sent with a Real-scene take: the scene now, the saved outfit, the moves kept, inside Recast's limit", () => {
    const left = RACE_PARTS.filter((p) => !["Pit garage", "Wall 2", "Wall"].includes(p.name));
    const wear = studioWearLine({ outfit: "", look: false, saved: "a white tank top and light blue jeans" }) || STUDIO_REAL_OUTFIT_LINE;
    const realScene = studioRealSceneLine({ title: race.title, description: race.description, things: ["the yellow car"], parts: left, hour: 18.5, wear });
    const words = studioRecastHappens("", [{ kind: "walk", from: 0, to: 4.8, toward: null, world: "across the track to the yellow car and stop beside it" }], { cuts: 2 });
    const direction = studioRecastDirection({ words, several: false, spot: "middle", engine: "kling-edit", realScene, wear });
    expect(direction.length).toBeLessThanOrEqual(RECAST_DIRECTION_MAX_CHARS);
    expect(direction.startsWith(words)).toBe(true);
    expect(direction).toContain("The character wears their own outfit: a white tank top and light blue jeans.");
    expect(direction).toContain("Keep the moves and camera exactly.");
    expect(direction).not.toMatch(/pit building|evening dress/);
    // Real scene off: the outfit is still said (the live take had nothing typed and came back in a black dress).
    const plain = studioRecastDirection({ words, several: false, spot: "middle", engine: "kling-edit", realScene: null, wear: studioWearLine({ outfit: "", look: false, saved: "" }) || STUDIO_REAL_OUTFIT_LINE });
    expect(plain).toContain(STUDIO_REAL_OUTFIT_LINE);
  });
});
