import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Tapping a thing on the stage (R1, 2026-09-21), read as source: set-view
// loads three.js and cannot load here. A tap is watched only with the
// Select tool while the page listens; a still press on the figure neither
// jumps it nor saves its mark; a still press keeps the named camera; the
// thumbnails and the picked box live in the overlay's own scene, which no
// frame or snapshot draws.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
// Code only: what the comments say is not what the code does.
const code = (s: string) => s.replace(/^\s*\/\/.*$/gm, "");
const between = (from: string, to: string) => {
  const a = view.indexOf(from);
  expect(a, from).toBeGreaterThan(-1);
  const b = view.indexOf(to, a + from.length);
  expect(b, to).toBeGreaterThan(a);
  return code(view.slice(a, b));
};

const onDown = between("const onDown = (e: PointerEvent) => {", "const onMove = (e: PointerEvent) => {");
const onMove = between("const onMove = (e: PointerEvent) => {", "const onUp = (e: PointerEvent) => {");
const onUp = between("const onUp = (e: PointerEvent) => {", 'canvas.addEventListener("pointerdown", onDown);');
const onDouble = between("const onDoubleClick = (e: MouseEvent) => {", 'canvas.addEventListener("dblclick", onDoubleClick);');

describe("a tap on the stage", () => {
  it("is recorded first, before laying and measuring, only with the Select tool while the page listens", () => {
    const tap = onDown.indexOf("tapStart = { id: e.pointerId");
    expect(tap).toBeGreaterThan(-1);
    expect(tap).toBeLessThan(onDown.indexOf("const laying = layingRef.current;"));
    expect(tap).toBeLessThan(onDown.indexOf('if (tool === "measure") {'));
    expect(onDown).toContain('else if (elementTapRef.current && tool === "select" && !layingRef.current && e.button === 0) {');
    // A second finger spoils it.
    expect(onDown).toContain("if (pointersDown.size > 1) tapSpoiled = true;");
  });

  it("is judged on the way up, before anything else the release does", () => {
    const judged = onUp.indexOf("isTap(tapStart,");
    expect(judged).toBeGreaterThan(-1);
    expect(judged).toBeLessThan(onUp.indexOf("if (measuring) {"));
    expect(onUp).toContain('e.type === "pointerup"');
  });

  it("the figure under Select moves only past the slop, and a still press never saves its mark", () => {
    expect(onDown).toContain("dragLive = false;");
    expect(onMove).toMatch(/if \(!dragLive\) \{\s*if \(dragFrom && Math\.hypot\(e\.clientX - dragFrom\.x, e\.clientY - dragFrom\.y\) <= slopOf\(dragFrom\.type\)\) return;\s*dragLive = true;\s*stageTouchRef\.current\?\.\(\);/);
    const still = onUp.indexOf("if (!dragLive) {");
    expect(still).toBeGreaterThan(-1);
    expect(still).toBeLessThan(onUp.indexOf("setMark("));
    expect(onUp.slice(still, onUp.indexOf("}", onUp.indexOf("return;", still)))).toContain("return;");
  });

  it("a Select drag keeps the grabbed point under the pointer, on a level plane at its height", () => {
    expect(onDown).toContain("grabPlane.constant = -held.point.y;");
    expect(onMove).toMatch(/if \(stageToolRef\.current === "select" && grabOffset\) \{\s*if \(!raycaster\.ray\.intersectPlane\(grabPlane, hit\)\) return;\s*moveTo\(\{ x: hit\.x \+ grabOffset\.x, z: hit\.z \+ grabOffset\.z \}\);/);
    expect(onUp).toContain("grabOffset = null;");
  });

  it("Move and Turn still place the figure on the press, live from the start", () => {
    expect(onDown).toMatch(/if \(tool === "turn"\) turnTo\(hit\);\s*else moveTo\(hit\);\s*stageTouchRef\.current\?\.\(\);\s*dragLive = true;/);
  });

  it("a double-click wins over the figure's tap", () => {
    expect(onDouble.indexOf("clearTimeout(figureTapTimer)")).toBeLessThan(onDouble.indexOf("if (!overFigure("));
    expect(view).toContain("figureTapTimer = setTimeout(() => {");
    expect(view).toContain("}, FIGURE_TAP_WAIT_MS);");
  });
});

describe("the named camera", () => {
  it("drops to custom on the first change of a grab, never on a still press, and the flag clears at the end", () => {
    const start = between('controls.addEventListener("start", () => {', "});");
    const change = between('controls.addEventListener("change", () => {', "});");
    const end = between('controls.addEventListener("end", () => {', "});");
    expect(start).not.toContain("setCameraId(null)");
    expect(start).toContain("orbitArmed = true;");
    expect(change).toContain("if (!orbitArmed) return;");
    expect(change).toContain("setCameraId(null);");
    expect(end).toContain("orbitArmed = false;");
  });
});

describe("the thumbnails and the picked box", () => {
  it("sit in the overlay's own scene, beside the film's overlay and never in it", () => {
    expect(view).toContain("overlayScene.add(badgeRoot, pickRoot);");
    expect(view).not.toMatch(/overlayRoot\.add\((badgeRoot|pickRoot)/);
    expect(view).toContain("badgeRoot.visible = badgeRoot.children.length > 0 && overlayHolds.size === 0;");
  });

  it("never reach the still's frame or a snapshot", () => {
    const frame = between("          frame(opts) {", "          relayout(");
    const snap = between("          snapshot(px, opts) {", "          frameFigure() {");
    for (const body of [frame, snap]) {
      expect(body).not.toMatch(/badgeRoot|pickRoot|overlayScene/);
    }
  });

  it("take no pointer: a drag that starts on one still orbits, and a tap finds it by its box", () => {
    expect(view).toContain("pointer-events:none;transition:opacity 150ms");
    expect(view).toContain("const key = badgeAt(rects, clientX, clientY, coarse ? BADGE_HIT_SLOP_PX.coarse : BADGE_HIT_SLOP_PX.fine);");
  });

  it("dim when something built stands in front, with the ray's reach put back", () => {
    const dim = between("const dimCoveredBadges = () => {", "const loop = () => {");
    expect(dim).toContain("raycaster.far = Math.max(0, d - 0.2);");
    expect(dim).toContain("raycaster.far = Infinity;");
    expect(dim.indexOf("raycaster.far = Infinity;")).toBeGreaterThan(dim.indexOf("intersectObject(built.root, true)"));
  });
});
