import { describe, expect, it } from "vitest";
import {
  ALONG_PAD,
  BULB,
  MARGIN,
  PEEK,
  PEEK_HOVER,
  RADIUS,
  cornerCentre,
  decide,
  dismissTarget,
  dockCentre,
  freeCentre,
  isTucked,
  lensFor,
  magnet,
  overDismiss,
  overEdge,
  parsePlace,
  placeCentre,
  tuckableSides,
  type Stage,
} from "./lamp-place";

// A desktop browser: the stage is the whole window, home 20 px from the corner.
const desk: Stage = { left: 0, top: 0, right: 1440, bottom: 900 };
const deskSides = tuckableSides(desk, 1440, 900);
const home = { x: 1440 - MARGIN - RADIUS, y: 900 - MARGIN - RADIUS };
// A phone in a browser: a 56 px top bar, the composer's dock from 800 down.
const phone: Stage = { left: 0, top: 56, right: 390, bottom: 800 };
const phoneSides = tuckableSides(phone, 390, 844);
const phoneHome = { x: 390 - MARGIN - RADIUS, y: 800 - 12 - RADIUS };

describe("the sides a lamp can tuck into", () => {
  it("are the screen's own: all four on a desktop, only left and right under a phone's bars", () => {
    expect(deskSides).toEqual({ left: true, right: true, top: true, bottom: true });
    expect(phoneSides).toEqual({ left: true, right: true, top: false, bottom: false });
  });
});

describe("where a throw lands", () => {
  it("parks in the corner it is thrown at, and bottom-right is home", () => {
    expect(decide(700, 450, -3000, -2000, desk, deskSides)).toEqual({ kind: "corner", corner: "tl" });
    expect(decide(700, 450, 3000, -2000, desk, deskSides)).toEqual({ kind: "corner", corner: "tr" });
    expect(decide(700, 450, -3000, 2000, desk, deskSides)).toEqual({ kind: "corner", corner: "bl" });
    expect(decide(700, 450, 3000, 2000, desk, deskSides)).toEqual({ kind: "home" });
    // Dropped near a corner, whatever the speed.
    expect(decide(60, 70, 0, 0, desk, deskSides)).toEqual({ kind: "corner", corner: "tl" });
    // Thrown up and left, landing on the top side just past the corner's zone: still the corner.
    expect(decide(700, 330, -2500, -1500, desk, deskSides)).toEqual({ kind: "corner", corner: "tl" });
    // Further along that side, it tucks in there.
    expect(decide(700, 330, -1200, -1500, desk, deskSides)).toMatchObject({ kind: "edge", edge: "top" });
  });

  it("tucks into the side it is thrown at, where the throw meets it", () => {
    const p = decide(900, 400, 2400, 0, desk, deskSides);
    expect(p).toMatchObject({ kind: "edge", edge: "right" });
    if (p.kind === "edge") expect(p.t).toBeCloseTo(400 / 900, 3);
    // Dropped with its rim close to a side.
    expect(decide(RADIUS + 20, 450, 0, 0, desk, deskSides)).toMatchObject({ kind: "edge", edge: "left" });
    expect(decide(700, 900 - RADIUS - 10, 0, 0, desk, deskSides)).toMatchObject({ kind: "edge", edge: "bottom" });
  });

  it("stays where a careful hand puts it in open space", () => {
    expect(decide(720, 450, 0, 0, desk, deskSides)).toEqual({ kind: "free", x: 0.5, y: 0.5 });
    // A slow nudge carries it a little way on.
    const p = decide(720, 450, 300, 0, desk, deskSides);
    expect(p.kind).toBe("free");
    if (p.kind === "free") expect(p.x).toBeCloseTo((720 + 300 * 0.22) / 1440, 5);
  });

  it("never tucks under a phone's top bar or into its dock", () => {
    const up = decide(195, 300, 0, -2500, phone, phoneSides);
    expect(up.kind).not.toBe("edge");
    const down = decide(195, 700, 0, 2500, phone, phoneSides);
    expect(down.kind).not.toBe("edge");
    // Its sides still take it.
    expect(decide(195, 400, 2500, 0, phone, phoneSides)).toMatchObject({ kind: "edge", edge: "right" });
  });
});

describe("a tucked lamp", () => {
  it("shows PEEK px of itself on the screen, clear of the corners", () => {
    const right = dockCentre("right", 0.5, desk, deskSides);
    expect(right.x - RADIUS).toBe(1440 - PEEK);
    expect(right.y).toBe(450);
    const top = dockCentre("top", 0.3, desk, deskSides);
    expect(top.y + RADIUS).toBe(PEEK);
    expect(dockCentre("left", 0, desk, deskSides).y).toBe(ALONG_PAD);
    expect(dockCentre("left", 1, desk, deskSides).y).toBe(900 - ALONG_PAD);
  });

  it("peeks out further under a mouse", () => {
    const at = dockCentre("right", 0.5, desk, deskSides, PEEK_HOVER);
    expect(1440 - (at.x - RADIUS)).toBe(PEEK + PEEK_HOVER);
  });

  it("stays whole beside a side the screen doesn't end at (a place kept from before)", () => {
    const at = dockCentre("top", 0.5, phone, phoneSides);
    expect(at.y - RADIUS).toBe(56 + MARGIN);
    expect(isTucked({ kind: "edge", edge: "top", t: 0.5 }, phoneSides)).toBe(false);
    expect(isTucked({ kind: "edge", edge: "left", t: 0.5 }, phoneSides)).toBe(true);
  });

  it("keeps its light in the part still on the screen, smaller as that part narrows", () => {
    const at = dockCentre("right", 0.5, desk, deskSides);
    const o = overEdge(at.x, at.y, desk);
    expect(o).toEqual({ edge: "right", over: BULB - PEEK });
    const lens = lensFor(o.edge, o.over);
    // Moved toward the page by half of what is hidden, and shrunk.
    expect(lens.x).toBeCloseTo(-(BULB - PEEK) / 2, 5);
    expect(lens.y).toBe(0);
    expect(lens.scale).toBeCloseTo(0.84, 2);
    expect(lens.vis).toBeCloseTo(PEEK / BULB, 5);
    // Whole on the screen: the light stays in the middle, full size.
    expect(lensFor("left", 0)).toEqual({ x: 0, y: 0, scale: 1, vis: 1 });
  });
});

describe("parked and put down", () => {
  it("mirrors home in the other corners", () => {
    expect(cornerCentre("tl", desk, home)).toEqual({ x: MARGIN + RADIUS, y: MARGIN + RADIUS });
    expect(cornerCentre("tr", desk, home)).toEqual({ x: home.x, y: MARGIN + RADIUS });
    expect(cornerCentre("bl", phone, phoneHome)).toEqual({ x: MARGIN + RADIUS, y: phoneHome.y });
    expect(placeCentre({ kind: "home" }, desk, home, deskSides)).toBe(home);
  });

  it("keeps a lamp put down whole on a smaller screen", () => {
    const turned: Stage = { left: 0, top: 0, right: 800, bottom: 360 };
    const at = freeCentre(0.99, 0.99, turned);
    expect(at.x + RADIUS).toBeLessThanOrEqual(800 - MARGIN);
    expect(at.y + RADIUS).toBeLessThanOrEqual(360 - MARGIN);
  });
});

describe("in the hand", () => {
  it("is drawn toward a corner it comes near, and says which", () => {
    const near = magnet(home.x - 40, home.y - 30, desk, home, deskSides);
    expect(near.corner).toBe("home");
    expect(near.cornerPull).toBeGreaterThan(0);
    expect(near.x).toBeGreaterThan(home.x - 40);
    const far = magnet(700, 450, desk, home, deskSides);
    expect(far).toEqual({ x: 700, y: 450, corner: null, cornerPull: 0, edge: null, edgePull: 0 });
  });

  it("is drawn toward a side it can tuck into, only close in", () => {
    const close = magnet(1440 - RADIUS - 10, 450, desk, home, deskSides);
    expect(close.edge).toBe("right");
    expect(close.edgePull).toBeGreaterThan(0.5);
    expect(close.x).toBeGreaterThan(1440 - RADIUS - 10);
    expect(magnet(195, 56 + RADIUS + 5, phone, phoneHome, phoneSides).edge).not.toBe("top");
  });
});

describe("hiding it", () => {
  it("hides when it is dropped on the × at the bottom centre", () => {
    const t = dismissTarget(phone);
    expect(t.x).toBe(195);
    expect(t.y).toBeLessThan(800);
    expect(overDismiss(t.x + 20, t.y - 20, phone)).toBe(true);
    expect(overDismiss(t.x + 80, t.y, phone)).toBe(false);
  });
});

describe("what this device remembers", () => {
  it("reads only places it wrote, and home otherwise", () => {
    expect(parsePlace(null)).toEqual({ kind: "home" });
    expect(parsePlace("not json")).toEqual({ kind: "home" });
    expect(parsePlace(JSON.stringify({ kind: "edge", edge: "middle", t: 0.5 }))).toEqual({ kind: "home" });
    expect(parsePlace(JSON.stringify({ kind: "edge", edge: "left", t: 7 }))).toEqual({ kind: "edge", edge: "left", t: 1 });
    expect(parsePlace(JSON.stringify({ kind: "free", x: 0.25, y: -3 }))).toEqual({ kind: "free", x: 0.25, y: 0 });
    expect(parsePlace(JSON.stringify({ kind: "corner", corner: "tl" }))).toEqual({ kind: "corner", corner: "tl" });
    expect(parsePlace(JSON.stringify({ kind: "corner", corner: "br" }))).toEqual({ kind: "home" });
  });
});
