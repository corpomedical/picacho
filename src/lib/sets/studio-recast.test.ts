import { describe, expect, it } from "vitest";
import { RECAST_ENGINES, recastCreditCost } from "../recast/recast";
import { RECAST_DIRECTION_MAX_CHARS } from "../recast/recast-brief";
import type { RecastRead } from "../recast/recast-read";
import { recastWindowCredits } from "../recast/trim";
import {
  STUDIO_RECAST_ENGINES,
  STUDIO_RESTAGE_LINE,
  parseStudioRecastEngine,
  studioFaceReadable,
  studioFigureLine,
  studioFigureSpot,
  studioRecastCredits,
  studioRecastDirection,
  studioRecastHappens,
  studioRecastRange,
  studioRecastSize,
  studioRecastStart,
  studioRecastTag,
} from "./studio-recast";

// Helios Studio · "Video with your character" (2026-09-30): the range, the
// size, the price and the payload the Studio hands Recast.

const read = (people: { tag: string; where: string; lead?: boolean }[]): RecastRead =>
  ({
    title: "t",
    motion: "m",
    world: "a grey 3D mock-up",
    people: people.map((p) => ({ does: "walks", lead: false, ...p })),
    keeps: [{ what: "the red car", kind: "object" }],
    cuts: [],
    framing: "wide",
    sound: "silent",
    headVisible: true,
    confidence: "high",
  }) as unknown as RecastRead;

describe("the lanes", () => {
  it("are Recast's Into the clip and Restage, and nothing else is taken", () => {
    expect(STUDIO_RECAST_ENGINES.map((e) => RECAST_ENGINES[e].job)).toEqual(["scene", "restage"]);
    expect(parseStudioRecastEngine("kling-edit")).toBe("kling-edit");
    expect(parseStudioRecastEngine("h3-768")).toBe("h3-768");
    for (const other of ["kling-pro", "luma-720", "h3-480", "wan-scene-720", "", null, 3]) expect(parseStudioRecastEngine(other)).toBeNull();
  });
});

describe("the range", () => {
  const at = (start: number, end: number, engine: "kling-edit" | "h3-768" = "kling-edit") => studioRecastRange({ start, end, fps: 24, lastFrame: 240, engine });
  it("is the playback range, inclusive, in seconds", () => {
    expect(at(1, 120)).toEqual({ start: 1, end: 120, seconds: 5, clamped: false });
    expect(at(1, 240)).toEqual({ start: 1, end: 240, seconds: 10, clamped: false });
  });
  it("is at least Recast's 3 s: the end moves, then the start when the timeline ends", () => {
    expect(at(10, 20)).toEqual({ start: 10, end: 81, seconds: 3, clamped: true });
    expect(at(230, 240)).toEqual({ start: 169, end: 240, seconds: 3, clamped: true });
  });
  it("is never past the timeline or the job's ceiling", () => {
    expect(studioRecastRange({ start: 1, end: 900, fps: 24, lastFrame: 900, engine: "h3-768" }).seconds).toBe(15);
    expect(studioRecastRange({ start: 1, end: 900, fps: 24, lastFrame: 900, engine: "kling-edit" }).seconds).toBe(30);
  });
});

describe("the size", () => {
  it("keeps the shot's shape with the short side at 720 (Kling O3 Edit takes 720–3840 a side)", () => {
    expect(studioRecastSize(16 / 9)).toEqual({ width: 1280, height: 720 });
    expect(studioRecastSize(9 / 16)).toEqual({ width: 720, height: 1280 });
    expect(studioRecastSize(1)).toEqual({ width: 720, height: 720 });
    expect(studioRecastSize(2.39)).toEqual({ width: 1720, height: 720 });
    expect(studioRecastSize(0.8)).toEqual({ width: 720, height: 900 });
    const s = studioRecastSize(2.39);
    expect(Math.min(s.width, s.height)).toBeGreaterThanOrEqual(RECAST_ENGINES["kling-edit"].accepts!.minSide);
  });
});

describe("the price is Recast's own quote", () => {
  it("is recastWindowCredits for the range, with Restage's photos riding as references", () => {
    for (const seconds of [3, 5, 73 / 24, 10]) {
      expect(studioRecastCredits("kling-edit", seconds, 4)).toBe(recastWindowCredits("kling-edit", { seconds, frames: null }, { start: 0, end: seconds }, 0));
      expect(studioRecastCredits("h3-768", seconds, 4)).toBe(recastWindowCredits("h3-768", { seconds, frames: null }, { start: 0, end: seconds }, 4));
      expect(studioRecastCredits("h3-768", seconds, 1)).toBe(recastWindowCredits("h3-768", { seconds, frames: null }, { start: 0, end: seconds }, 1));
    }
    // More than four photos: four ride (actions.ts photosOfRow), none still counts one.
    expect(studioRecastCredits("h3-768", 5, 9)).toBe(recastCreditCost("h3-768", { seconds: 5, frames: null }, 4));
    expect(studioRecastCredits("h3-768", 5, 0)).toBe(recastCreditCost("h3-768", { seconds: 5, frames: null }, 1));
  });
  it("5 s: 3 credits into the clip, 5 restaged with four photos (the numbers on the button)", () => {
    expect(studioRecastCredits("kling-edit", 5, 4)).toBe(3);
    expect(studioRecastCredits("h3-768", 5, 4)).toBe(5);
    expect(studioRecastCredits("h3-768", 5, 1)).toBe(4);
    expect(studioRecastCredits("kling-edit", 10, 1)).toBe(6);
  });
});

describe("which figure", () => {
  it("says where a figure stands across the frame", () => {
    expect([studioFigureSpot(-0.6), studioFigureSpot(0.1), studioFigureSpot(0.7)]).toEqual(["left", "middle", "right"]);
  });
  it("one figure: the read's lead", () => {
    expect(studioRecastTag(read([{ tag: "A", where: "left" }, { tag: "B", where: "right", lead: true }]), [0], 0)).toBe("B");
    expect(studioRecastTag(read([{ tag: "A", where: "centre" }]), [0.1], 0)).toBe("A");
  });
  it("several: matched by where each stands, only when the read says it plainly", () => {
    const r = read([{ tag: "A", where: "right, foreground" }, { tag: "B", where: "left side" }]);
    expect(studioRecastTag(r, [-0.6, 0.6], 0)).toBe("B");
    expect(studioRecastTag(r, [-0.6, 0.6], 1)).toBe("A");
    expect(studioRecastTag(read([{ tag: "A", where: "foreground" }, { tag: "B", where: "left" }]), [-0.6, 0.6], 0)).toBeNull();
    expect(studioRecastTag(read([{ tag: "A", where: "left" }]), [-0.6, 0.6], 0)).toBeNull();
    expect(studioRecastTag(r, [0.1, 0.12], 0)).toBeNull();
    expect(studioRecastTag(null, [0], 0)).toBeNull();
  });
});

describe("the words", () => {
  it("prefill what happens from the pose and the moves inside the range", () => {
    expect(studioRecastHappens("", [{ kind: "walk", from: 0, to: 73 / 24, toward: "the red car" }, { kind: "turn", from: 3.04, to: 3.5, toward: "the camera" }])).toBe(
      "From 0 s to 3 s they walk to the red car. From 3 s to 3.5 s they turn to face the camera.",
    );
    expect(studioRecastHappens("The character is sitting on the red car.", [])).toBe("The character is sitting on the red car.");
    expect(studioRecastHappens("", [{ kind: "run", from: 1, to: 4, toward: null }])).toBe("From 1 s to 4 s they run.");
  });
  it("always say the mannequin is replaced, which one when there are several, and Restage's line", () => {
    expect(studioRecastDirection({ words: " She waves. ", several: false, spot: "middle", engine: "kling-edit" })).toBe(`She waves. ${studioFigureLine(false, "middle")}`);
    const two = studioRecastDirection({ words: "", several: true, spot: "left", engine: "h3-768" });
    expect(two).toBe(`${studioFigureLine(true, "left")} ${STUDIO_RESTAGE_LINE}`);
    expect(two).toContain("on the left of the frame");
  });
  it("stay inside Recast's limit, shortening the person's words first", () => {
    const d = studioRecastDirection({ words: "x".repeat(2000), several: true, spot: "right", engine: "h3-768" });
    expect(d.length).toBeLessThanOrEqual(RECAST_DIRECTION_MAX_CHARS);
    expect(d.endsWith(STUDIO_RESTAGE_LINE)).toBe(true);
  });
});

describe("the payload", () => {
  it("is one character, the chosen lane, the whole recording as the window, the press's sendId, the rights of a scene made here", () => {
    const r = read([{ tag: "A", where: "centre", lead: true }]);
    const body = studioRecastStart({ sendId: "s-1", path: "u/c.mp4", characterId: "c1", engine: "h3-768", seconds: 5, direction: "d", read: r, castTag: "A" });
    expect(body).toEqual({
      sendId: "s-1",
      path: "u/c.mp4",
      characterIds: ["c1"],
      engine: "h3-768",
      keeps: ["the red car"],
      direction: "d",
      castTag: "A",
      read: r,
      window: { start: 0, end: 5 },
      faceAt: { first: true, last: true },
      rights: true,
    });
    expect(studioRecastStart({ sendId: "s", path: "p", characterId: "c", engine: "kling-edit", seconds: 3, direction: "", read: null, castTag: null, faceAt: { first: false, last: true } }).faceAt).toEqual({ first: false, last: true });
    expect("castTag" in studioRecastStart({ sendId: "s", path: "p", characterId: "c", engine: "kling-edit", seconds: 3, direction: "", read: null, castTag: null })).toBe(false);
  });
});

describe("where the face check can read the face", () => {
  it("needs the head in the frame, big enough, and not turned away (a profile still reads)", () => {
    expect(studioFaceReadable({ headPx: 60, frameH: 720, turnDeg: 10, inFrame: true })).toBe(true);
    expect(studioFaceReadable({ headPx: 60, frameH: 720, turnDeg: 90, inFrame: true })).toBe(true);
    expect(studioFaceReadable({ headPx: 20, frameH: 720, turnDeg: 10, inFrame: true })).toBe(false);
    expect(studioFaceReadable({ headPx: 60, frameH: 720, turnDeg: 150, inFrame: true })).toBe(false);
    expect(studioFaceReadable({ headPx: 60, frameH: 720, turnDeg: 10, inFrame: false })).toBe(false);
  });
});
