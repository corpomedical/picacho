import { describe, expect, it } from "vitest";
import { BADGE_HIT_SLOP_PX, TAP_MAX_MS, TAP_SLOP_PX, badgeAt, elementForHits, isTap, type StageHit } from "./stage-pick";

// A tap on the stage and what it touched (the per-thing reference photos,
// 2026-09-21): a press that barely moved, briefly, with one finger; the
// nearest thing hit, never the sky, the ground being nothing.

const down = (type: string, x = 100, y = 100) => ({ id: 1, type, x, y, t: 1000 });
const up = (dx: number, dy = 0, dt = 100) => ({ id: 1, x: 100 + dx, y: 100 + dy, t: 1000 + dt });

describe("isTap", () => {
  it("allows a mouse 5 px, a pen 6 and a finger 10, and no more", () => {
    expect(TAP_SLOP_PX).toEqual({ mouse: 5, pen: 6, touch: 10 });
    expect(isTap(down("mouse"), up(4), false)).toBe(true);
    expect(isTap(down("mouse"), up(6), false)).toBe(false);
    expect(isTap(down("pen"), up(6), false)).toBe(true);
    expect(isTap(down("touch"), up(9), false)).toBe(true);
    expect(isTap(down("touch"), up(11), false)).toBe(false);
    expect(isTap(down("mouse"), up(3, 4), false)).toBe(true);
  });

  it("is not a tap when held too long, when a second finger went down, or for another pointer", () => {
    expect(isTap(down("mouse"), up(0, 0, TAP_MAX_MS + 1), false)).toBe(false);
    expect(isTap(down("mouse"), up(0, 0, TAP_MAX_MS), false)).toBe(true);
    expect(isTap(down("touch"), up(0), true)).toBe(false);
    expect(isTap(down("mouse"), { ...up(0), id: 2 }, false)).toBe(false);
  });
});

describe("elementForHits", () => {
  const hit = (over: Partial<StageHit>): StageHit => ({ oi: null, copy: null, figure: false, ground: false, sky: false, distance: 1, ...over });
  const keyOf = (oi: number, copy: number) => (oi === 0 ? "c_89e319be_0_-1" : oi === 3 && copy === 1 ? "o_00000000_5_5" : null);

  it("takes the nearest hit: the figure before a car behind it", () => {
    expect(elementForHits([hit({ oi: 0, copy: 0, distance: 6 }), hit({ figure: true, distance: 4 })], keyOf, "figure")).toEqual({ kind: "element", key: "figure" });
    expect(elementForHits([hit({ oi: 0, copy: 0, distance: 3 }), hit({ figure: true, distance: 4 })], keyOf, "figure")).toEqual({ kind: "element", key: "c_89e319be_0_-1" });
  });

  it("maps a block to its element by object and copy; a block of no element is structure", () => {
    expect(elementForHits([hit({ oi: 3, copy: 1 })], keyOf, "figure")).toEqual({ kind: "element", key: "o_00000000_5_5" });
    // With the block's object index, so its card can say its name (Helios Cut 4, step B2).
    expect(elementForHits([hit({ oi: 3, copy: 0 })], keyOf, "figure")).toEqual({ kind: "structure", oi: 3 });
    expect(elementForHits([hit({ oi: 9, copy: 0, distance: 2 }), hit({ oi: 0, copy: 0, distance: 5 })], keyOf, "figure")).toEqual({ kind: "structure", oi: 9 });
  });

  it("skips the sky, and the ground (or nothing) in front is nothing", () => {
    expect(elementForHits([hit({ sky: true, distance: 0.5 }), hit({ oi: 0, copy: 0, distance: 8 })], keyOf, "figure")).toEqual({ kind: "element", key: "c_89e319be_0_-1" });
    expect(elementForHits([hit({ ground: true, distance: 2 }), hit({ oi: 0, copy: 0, distance: 8 })], keyOf, "figure")).toBeNull();
    expect(elementForHits([], keyOf, "figure")).toBeNull();
    expect(elementForHits([hit({ sky: true })], keyOf, "figure")).toBeNull();
  });
});

describe("badgeAt", () => {
  const rects = [
    { key: "a", left: 10, top: 10, right: 40, bottom: 40 },
    { key: "b", left: 30, top: 30, right: 60, bottom: 60 },
  ];

  it("counts the slop, and the topmost badge wins where two overlap", () => {
    expect(BADGE_HIT_SLOP_PX).toEqual({ fine: 6, coarse: 12 });
    expect(badgeAt(rects, 35, 35, 0)).toBe("b");
    expect(badgeAt(rects, 15, 15, 0)).toBe("a");
    expect(badgeAt(rects, 5, 5, 6)).toBe("a");
    expect(badgeAt(rects, 5, 5, 4)).toBeNull();
    expect(badgeAt(rects, 70, 70, 6)).toBeNull();
  });
});
