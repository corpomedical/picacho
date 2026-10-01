import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nearestScrollTop, studioScrollUndo } from "./studio-scroll";

// 2026-10-01 live run: after the Render and Object menus and windows, the whole Studio was pushed up (the top
// bar off-screen, the viewport a strip) until a reload.

const box = (o: Partial<Parameters<typeof studioScrollUndo>[0]>) => ({ holdsStudio: false, inStudio: false, control: false, overflowX: "visible", overflowY: "visible", ...o });

describe("Helios Studio never scrolls as a page", () => {
  it("puts back any scroll of what holds the Studio, and of its boxes that don't scroll", () => {
    // The page's scroller, the document, the Studio's host: both ways.
    expect(studioScrollUndo(box({ holdsStudio: true, overflowY: "auto" }))).toEqual({ x: true, y: true });
    // #app, a panel (.area, overflow hidden), the viewport: put back.
    expect(studioScrollUndo(box({ inStudio: true }))).toEqual({ x: true, y: true });
    expect(studioScrollUndo(box({ inStudio: true, overflowX: "hidden", overflowY: "hidden" }))).toEqual({ x: true, y: true });
    // The phone's top bar scrolls sideways only.
    expect(studioScrollUndo(box({ inStudio: true, overflowX: "auto", overflowY: "hidden" }))).toEqual({ x: false, y: true });
  });

  it("leaves its panes, its text fields and everything else on the page alone", () => {
    expect(studioScrollUndo(box({ inStudio: true, overflowX: "auto", overflowY: "auto" }))).toEqual({ x: false, y: false });
    expect(studioScrollUndo(box({ inStudio: true, overflowY: "scroll", overflowX: "hidden" }))).toEqual({ x: true, y: false });
    expect(studioScrollUndo(box({ inStudio: true, control: true, overflowX: "clip", overflowY: "clip" }))).toEqual({ x: false, y: false });
    expect(studioScrollUndo(box({ overflowY: "hidden" }))).toEqual({ x: false, y: false });
  });

  it("a timeline row is scrolled into its own pane by the least it can", () => {
    const pane = { top: 100, height: 200, scrollTop: 50 };
    expect(nearestScrollTop(pane, { top: 120, height: 22 })).toBe(50);
    expect(nearestScrollTop(pane, { top: 80, height: 22 })).toBe(30);
    expect(nearestScrollTop(pane, { top: 290, height: 22 })).toBe(62);
    expect(nearestScrollTop({ top: 0, height: 10, scrollTop: 0 }, { top: 30, height: 40 })).toBe(30);
    expect(nearestScrollTop({ top: 0, height: 100, scrollTop: 5 }, { top: -40, height: 22 })).toBe(0);
  });

  it("the engine focuses without scrolling, scrolls rows in their pane only, and guards from the start", () => {
    const engine = readFileSync(join(__dirname, "studio-engine.ts"), "utf8");
    expect(engine).not.toMatch(/\.focus\(\)/);
    expect(engine).not.toMatch(/scrollIntoView/);
    const guard = engine.indexOf("guardStudioScroll(");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(engine.indexOf("function openWin("));
  });
});
