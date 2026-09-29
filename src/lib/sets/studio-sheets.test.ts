import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GRIP_TAP_PX, LONG_PRESS_MS, LONG_PRESS_SLOP_PX, STUDIO_COMPACT_QUERY, nextSheet, sheetDragHeight, sheetHeights, sheetSnap } from "./studio-sheets";

describe("Helios Studio's bottom sheets (phones and tablets)", () => {
  it("settle closed, half or full from where the finger lets go", () => {
    const room = 700;
    expect(sheetSnap(100, room)).toBe("closed");
    expect(sheetSnap(300, room)).toBe("half");
    expect(sheetSnap(600, room)).toBe("full");
    expect(sheetHeights(room)).toEqual({ half: 350, full: 692, min: 120 });
  });

  it("follow the finger inside the room while dragging", () => {
    expect(sheetDragHeight(350, -100, 700)).toBe(450);
    expect(sheetDragHeight(350, 500, 700)).toBe(0);
    expect(sheetDragHeight(350, -900, 700)).toBe(700);
  });

  it("the same tab closes its sheet; another tab swaps it", () => {
    expect(nextSheet("", "astra")).toBe("astra");
    expect(nextSheet("astra", "astra")).toBe("");
    expect(nextSheet("astra", "props")).toBe("props");
  });

  it("touch timings: a long-press is held still, a grip tap barely moves", () => {
    expect(LONG_PRESS_MS).toBeGreaterThanOrEqual(450);
    expect(LONG_PRESS_SLOP_PX).toBeGreaterThan(GRIP_TAP_PX);
  });

  it("phones and tablets get the compact layout; a desktop window never does", () => {
    expect(STUDIO_COMPACT_QUERY).toContain("(max-width: 1100px)");
    expect(STUDIO_COMPACT_QUERY).toContain("(pointer: coarse)");
  });

  it("everything added for touch is hidden on desktop, and every panel has a tab (read from the markup)", () => {
    const markup = readFileSync(join(__dirname, "../../components/studio/studio-markup.ts"), "utf8");
    expect(markup).toContain(".mOnly{display:none!important}");
    expect(markup).toContain(".app.compact .mOnly{display:flex!important}");
    for (const tab of ["outliner", "props", "astra", "time"]) expect(markup).toContain(`data-sheet='${tab}'`);
    for (const menu of ["file", "edit", "render", "help"]) expect(markup).toContain(`data-open='${menu}'`);
    // Nothing the compact layout adds carries a desktop class of its own.
    expect(markup).not.toContain("@media (max-width:980px)");
  });
});
