import { describe, expect, it } from "vitest";
import {
  BULB,
  SNAP_GAP,
  TAB_LEN,
  TAB_THICK,
  boxFor,
  clampCentre,
  dismissTarget,
  nearestEdge,
  overDismiss,
  parsePlace,
  settle,
  type Stage,
} from "./lamp-place";

// A phone in a browser: 390 wide, a 56 px top bar, the page ends at 800.
const phone: Stage = { left: 0, top: 56, right: 390, bottom: 800 };

describe("where the lamp lands", () => {
  it("stays where it was let go in open space", () => {
    const p = settle(195, 428, phone);
    expect(p).toEqual({ kind: "free", x: 0.5, y: 0.5 });
    expect(boxFor(p as Exclude<typeof p, { kind: "home" }>, phone)).toEqual({
      left: 195 - BULB / 2,
      top: 428 - BULB / 2,
      width: BULB,
      height: BULB,
    });
  });

  it("becomes the tab of an edge its rim comes near", () => {
    // Rim 20 px from the right edge (centre 390 - 22 - 20).
    const p = settle(348, 300, phone);
    expect(p.kind).toBe("edge");
    if (p.kind !== "edge") return;
    expect(p.edge).toBe("right");
    const box = boxFor(p, phone);
    expect(box.left).toBe(390 - TAB_THICK);
    expect(box.width).toBe(TAB_THICK);
    expect(box.height).toBe(TAB_LEN);
    expect(box.top + TAB_LEN / 2).toBeCloseTo(300, 5); // centred where it was let go
  });

  it("stays a bulb just past the snap distance", () => {
    const cx = 390 - BULB / 2 - SNAP_GAP - 1;
    expect(settle(cx, 300, phone).kind).toBe("free");
    expect(nearestEdge(cx, 300, phone)).toEqual({ edge: "right", gap: SNAP_GAP + 1 });
  });

  it("uses the stage's top and bottom, not the screen's (the top bar, the tab bar)", () => {
    const top = settle(200, 56 + BULB / 2 + 4, phone);
    expect(top).toMatchObject({ kind: "edge", edge: "top" });
    if (top.kind === "edge") expect(boxFor(top, phone).top).toBe(56);
    const bottom = settle(200, 800 - BULB / 2 - 4, phone);
    expect(bottom).toMatchObject({ kind: "edge", edge: "bottom" });
    if (bottom.kind === "edge") expect(boxFor(bottom, phone).top).toBe(800 - TAB_THICK);
  });

  it("keeps a tab whole near a corner, and a free bulb inside a smaller screen", () => {
    const corner = boxFor({ kind: "edge", edge: "left", t: 1 }, phone);
    expect(corner.top + corner.height).toBeLessThanOrEqual(800);
    const turned: Stage = { left: 0, top: 0, right: 800, bottom: 360 }; // the phone turned sideways
    const free = boxFor({ kind: "free", x: 0.99, y: 0.99 }, turned);
    expect(free.left + free.width).toBeLessThanOrEqual(800);
    expect(free.top + free.height).toBeLessThanOrEqual(360);
  });

  it("keeps a dragged bulb on the stage", () => {
    expect(clampCentre(-50, 2000, phone)).toEqual({ cx: BULB / 2, cy: 800 - BULB / 2 });
  });
});

describe("hiding it", () => {
  it("hides when it is dropped on the × at the bottom centre", () => {
    const t = dismissTarget(phone);
    expect(t.cx).toBe(195);
    expect(t.cy).toBeLessThan(800);
    expect(overDismiss(t.cx + 20, t.cy - 20, phone)).toBe(true);
    expect(overDismiss(t.cx + 80, t.cy, phone)).toBe(false);
  });
});

describe("what this device remembers", () => {
  it("reads only places it wrote, and home otherwise", () => {
    expect(parsePlace(null)).toEqual({ kind: "home" });
    expect(parsePlace("not json")).toEqual({ kind: "home" });
    expect(parsePlace(JSON.stringify({ kind: "edge", edge: "middle", t: 0.5 }))).toEqual({ kind: "home" });
    expect(parsePlace(JSON.stringify({ kind: "edge", edge: "left", t: 7 }))).toEqual({ kind: "edge", edge: "left", t: 1 });
    expect(parsePlace(JSON.stringify({ kind: "free", x: 0.25, y: -3 }))).toEqual({ kind: "free", x: 0.25, y: 0 });
  });
});
