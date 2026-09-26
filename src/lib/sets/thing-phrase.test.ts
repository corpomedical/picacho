import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import raceTrack from "./fixtures-race-track.json";
import { COLOUR_IDS } from "./colour-words";
import { elementPlaces, setElements } from "./elements";
import { RACK_SENTENCE, rackWords } from "./furniture";
import type { ShotCamera } from "./look-cutout";
import { gazeWords } from "./people";
import { normaliseSetSpec, type SetObject, type SetSpec } from "./set-spec";
import { SET_SHOT_GAZE_SENTENCE, SET_THING_WORDS_OPEN, buildSetShotPrompt, stripSetShotScaffold } from "./set-shot-prompt";
import { buildSetTakePrompt } from "./take";
import { stripSetTakeScaffold } from "./take-scaffold";
import { thingPhrase } from "./thing-phrase";
import { CAMERA_RANK_WORDS, FRAME_THIRD_WORDS, THING_PHRASE_KINDS, THING_PHRASE_PATTERN, THING_SIDE_WORDS, thingPhraseText, type ThingPhrase } from "./thing-words";

// A thing in a paint prompt's words (Helios Cut 4, step B5, 2026-09-26):
// "the red car", placed where two share a kind and a colour, colourless
// where its own sheet rides grey — Picacho's closed words only, admins
// only until the proof stills, and matched whole by the sentences the
// brand check takes out, so it reads anything else.

const specOf = (json: unknown): SetSpec => {
  const n = normaliseSetSpec(json);
  if (!n.ok) throw new Error("fixture");
  return n.spec;
};
const race = specOf(raceTrack);
const RACE_CAR = setElements(race).find((e) => e.kind === "car")!;
const MARK = race.marks[0];

/** The race set with a copy of its car `dx` metres along x, its body (largest block) painted `body`. */
function twoCars(dx: number, body?: string): SetSpec {
  const members = [...new Set(RACE_CAR.members.map(([o]) => o))];
  const volume = (o: SetObject) => o.size[0] * o.size[1] * o.size[2];
  const largest = members.reduce((a, b) => (volume(race.objects[b]) > volume(race.objects[a]) ? b : a));
  const copies = members.map((i) => {
    const o = race.objects[i];
    return { ...o, position: [o.position[0] + dx, o.position[1], o.position[2]] as SetObject["position"], color: body && i === largest ? body : o.color };
  });
  return specOf({ ...race, objects: [...race.objects, ...copies] });
}

/** A still's camera 12 m in front of the start line, looking down the track at both cars. */
const CAMERA: ShotCamera = { position: [3, 1.6, 12], target: [3, 0.8, 0], fovDeg: 50, canvasAspect: 16 / 9, figure: { x: MARK.x, z: MARK.z } };

describe("the words, closed", () => {
  it("say a kind, a colour and at most one place, in the sheets' own place words", () => {
    expect(thingPhraseText({ colour: "red", kind: "car", place: null })).toBe("the red car");
    expect(thingPhraseText({ colour: "red", kind: "car", place: { third: "right", rank: 0 } })).toBe("the red car at the right of the frame, nearest the camera");
    expect(thingPhraseText({ colour: "blue", kind: "object", place: { third: "middle", rank: null } })).toBe("the blue object in the middle of the frame");
    expect(thingPhraseText({ colour: null, kind: "car", place: { third: "left", rank: 1 } })).toBe("the car at the left of the frame, second from the camera");
    expect(thingPhraseText({ colour: "grey", kind: "vehicle", place: { side: "left" } })).toBe("the grey vehicle to their left");
    expect(thingPhraseText({ colour: "grey", kind: "structure", place: null })).toBe("the grey structure");
    // The sheets' words, byte for byte (elements.ts planSheets reads the same lists).
    expect(FRAME_THIRD_WORDS).toEqual({ left: "at the left of the frame", middle: "in the middle of the frame", right: "at the right of the frame" });
    expect(CAMERA_RANK_WORDS[0]).toBe("nearest the camera");
  });

  it("match their pattern whole, every one of them, and nothing a model could write", () => {
    const whole = new RegExp(`^${THING_PHRASE_PATTERN}$`);
    const places: ThingPhrase["place"][] = [
      null,
      ...(["left", "middle", "right"] as const).flatMap((third) => [null, 0, 1, 2, 3, 4, 5].map((rank) => ({ third, rank }))),
      ...(Object.keys(THING_SIDE_WORDS) as (keyof typeof THING_SIDE_WORDS)[]).map((side) => ({ side })),
    ];
    let n = 0;
    for (const colour of [null, ...COLOUR_IDS]) {
      for (const kind of THING_PHRASE_KINDS) {
        for (const place of places) {
          const text = thingPhraseText({ colour, kind, place });
          expect(whole.test(text), text).toBe(true);
          n += 1;
        }
      }
    }
    expect(n).toBe(16 * 4 * 26);
    for (const not of ["the red Ferrari", "the scarlet car", "the red car by the pit wall", "the red sports car", "a red car", "the red car at the right of the frame, seventh from the camera", "the red car, nearest the camera"]) {
      expect(whole.test(not), not).toBe(false);
    }
  });
});

describe("a thing on a set", () => {
  it("the race track's one car is the red car, whatever block the eye-line stored", () => {
    for (const [o] of RACE_CAR.members) expect(thingPhrase(o, race, setElements(race), { camera: CAMERA, mark: MARK })).toBe("the red car");
  });

  it("two cars of one kind and colour: where each stands in the frame, or which side of her when out of it", () => {
    const spec = twoCars(6);
    const els = setElements(spec);
    const cars = els.filter((e) => e.kind === "car");
    expect(cars).toHaveLength(2);
    const places = elementPlaces(spec, els, CAMERA);
    const said = cars.map((c) => thingPhrase(c.members[0][0], spec, els, { camera: CAMERA, mark: MARK }));
    for (const [i, c] of cars.entries()) {
      const p = places.find((x) => x.key === c.key)!;
      expect(p.seen, c.key).toBe(true);
      if (!p.seen) continue;
      expect(said[i]).toMatch(new RegExp(`^the red car ${FRAME_THIRD_WORDS[p.across]}(, (${CAMERA_RANK_WORDS.join("|")}))?$`));
    }
    expect(said[0]).not.toBe(said[1]);
    // No camera (a take): the side of the figure each is on.
    const sides = cars.map((c) => thingPhrase(c.members[0][0], spec, els, { camera: null, mark: MARK }));
    expect(sides).toEqual(["the red car to their right", "the red car to their left"]);
  });

  it("two cars of different colours need no place", () => {
    const spec = twoCars(6, "#1e5bd6");
    const els = setElements(spec);
    const cars = els.filter((e) => e.kind === "car");
    expect(cars.map((c) => thingPhrase(c.members[0][0], spec, els, { camera: CAMERA, mark: MARK }))).toEqual(["the red car", "the blue car"]);
  });

  it("a thing whose own sheet rides drawn grey: no colour, named by the sheet's place words", () => {
    const els = setElements(race);
    const place = elementPlaces(race, els, CAMERA).find((p) => p.key === RACE_CAR.key)!;
    expect(place.seen).toBe(true);
    if (!place.seen) return;
    expect(thingPhrase(RACE_CAR.members[0][0], race, els, { camera: CAMERA, mark: MARK, grey: new Set([RACE_CAR.key]) })).toBe(`the car ${FRAME_THIRD_WORDS[place.across]}`);
  });

  // Review of Cut 4 round 1: a take said the block's colour for a thing drawn
  // from its own photos ("the red car" for someone's blue car on its sheet).
  it("a take on a thing with photos: no colour, named by the side of the figure it is on", () => {
    const els = setElements(race);
    const withPhotos = new Set([RACE_CAR.key]);
    const said = thingPhrase(RACE_CAR.members[0][0], race, els, { camera: null, mark: MARK, grey: withPhotos });
    expect(Object.values(THING_SIDE_WORDS).map((w) => `the car ${w}`)).toContain(said);
    expect(said).not.toContain("red");
    // Without photos, the block's colour, as before.
    expect(thingPhrase(RACE_CAR.members[0][0], race, els, { camera: null, mark: MARK })).toBe("the red car");
  });

  it("a block of the set itself is 'the {colour} structure' only when no other block of the set has its colour; else today's words", () => {
    const els = setElements(race);
    // Object 18 (a navy board) shares navy with 9, 13, 14 and 19; the grey walls share grey.
    expect(thingPhrase(18, race, els, { camera: CAMERA, mark: MARK })).toBeNull();
    expect(thingPhrase(11, race, els, { camera: CAMERA, mark: MARK })).toBeNull();
    // The red kerb (object 5) is the only red block of the set itself.
    expect(thingPhrase(5, race, els, { camera: CAMERA, mark: MARK })).toBe("the red structure");
    expect(thingPhrase(999, race, els, { camera: CAMERA, mark: MARK })).toBeNull();
  });
});

describe("the sentences, matched whole (the brand check reads anything else)", () => {
  const phrases = ["the red car", "the red car at the right of the frame, nearest the camera", "the car at the left of the frame", "the grey vehicle to their left", "the red structure"];

  it("an eye-line in a still and in a take, said with the phrase and taken out before the brand check", () => {
    const els = setElements(race);
    for (const named of phrases) {
      const still = gazeWords({ at: "object", index: 23 }, race, MARK, "still", els, named);
      expect(still).toBe(`They look at ${named}, their eyes on it.`);
      expect(stripSetShotScaffold(buildSetShotPrompt({ description: "d", direction: "x", gaze: still }))).toBe("d In this frame: x.");
      const take = gazeWords({ at: "object", index: 23 }, race, MARK, "take", els, named);
      expect(take).toBe(`By the end of the shot they look at ${named}, their eyes on it.`);
      expect(stripSetTakeScaffold(buildSetTakePrompt("x", { gaze: take }))).toBe(stripSetTakeScaffold(buildSetTakePrompt("x", {})));
    }
    // Without a phrase, the words are exactly as they were.
    expect(gazeWords({ at: "object", index: 23 }, race, MARK, "still", els, null)).toBe(gazeWords({ at: "object", index: 23 }, race, MARK, "still", els));
  });

  it("a rack in a take, said with the phrase and taken out", () => {
    for (const named of phrases) {
      const rack = rackWords({ to: "object", index: 23 }, race, named);
      expect(rack).toBe(`During the move the focus racks from the person to ${named}: the person falls soft as it comes sharp.`);
      expect(stripSetTakeScaffold(buildSetTakePrompt("x", { rack }))).toBe(stripSetTakeScaffold(buildSetTakePrompt("x", {})));
    }
    expect(rackWords({ to: "object", index: 23 }, race, null)).toBe(rackWords({ to: "object", index: 23 }, race));
  });

  it("a sentence that only looks like one keeps its words in front of the brand check", () => {
    for (const theirs of ["They look at the red Ferrari, their eyes on it.", "They look at the red car by the Shell sign, their eyes on it."]) {
      expect(stripSetShotScaffold(buildSetShotPrompt({ description: "d", direction: theirs }))).toBe(`d In this frame: ${theirs}`);
      expect(theirs.replace(SET_SHOT_GAZE_SENTENCE, "")).toBe(theirs);
    }
    const rack = "During the move the focus racks from the person to the red Ferrari: the person falls soft as it comes sharp.";
    expect(rack.replace(RACK_SENTENCE, "")).toBe(rack);
  });
});

describe("who gets them (read as source)", () => {
  it("admins only until the proof stills and take: the still and the take both gate on SET_THING_WORDS_OPEN, and nowhere else calls the phrase", () => {
    expect(SET_THING_WORDS_OPEN).toBe(false);
    const src = readFileSync(join(__dirname, "actions.ts"), "utf8");
    const still = src.slice(src.indexOf("async function shootStill("), src.indexOf("export async function takeInSet("));
    expect(still).toContain("const thingWordsOn = access.isAdmin || SET_THING_WORDS_OPEN;");
    expect(still).toContain('thingWordsOn && layout && gazeNow?.at === "object"');
    expect(still).toContain("? thingPhrase(gazeNow.index, shown, els, { camera: frameCamera, mark: layout.mark, grey: new Set(elementPlan.riding.filter((r) => greyed.has(r.key)).map((r) => r.key)) })");
    const take = src.slice(src.indexOf("async function takeWork("));
    expect(take).toContain("const takeThingWords = access.isAdmin || SET_THING_WORDS_OPEN;");
    // A thing drawn from its own photos in the take's frames is named without a colour (review of Cut 4 round 1).
    expect(take).toContain("? new Set(resolvePhotos(endEls, (await listElementPhotos(createAdminClient(), userId, setId)).photos).held.map((h) => h.key))");
    expect(take).toContain("const endThing = (index: number) => (takeThingWords ? thingPhrase(index, endShown, endEls, { camera: null, mark: endMark, grey: endGrey }) : null);");
    expect(src.match(/thingPhrase\(/g)).toHaveLength(2);
    // Built outside people.ts and furniture.ts (critic item 6): neither imports it.
    // (people.ts reads elements.ts for a type alone, which leaves nothing at run time.)
    for (const f of ["people.ts", "furniture.ts"]) expect(readFileSync(join(__dirname, f), "utf8"), f).not.toMatch(/^import (?!type )[^\n]*from "\.\/(?:elements|thing-phrase)"/m);
  });
});
