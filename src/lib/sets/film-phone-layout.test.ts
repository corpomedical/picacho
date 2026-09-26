import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A phone's Film (375 × 812, 2026-09-22), read as source like the page's
// other tests: the setup chips wrapped into five rows and the film dock
// grew up under them, so its play, length and engine chips could not be
// tapped. The chips are one row that swipes there, the dock stops below
// that row, and the computer's chips and sequencer are as they were.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const between = (from: string, to: string) => {
  const at = view.indexOf(from);
  expect(at, from).toBeGreaterThan(-1);
  return view.slice(at, view.indexOf(to, at));
};
// The chips are one function since the new layout (2026-09-24): the stage and the Shoot panel both draw them.
const chipsBlock = between("<div ref={inPanel ? undefined : chipsRef} data-setup-chips", "\n  const chatHeader = (");
const dockBlock = between("{!wide && filmOpen && (\n            <div\n              data-film-dock", "{/* A photo set: the photo beside camera 1");
// Tailwind's spacing scale: one step is 4 px.
const px = (cls: string, prefix: string) => {
  const m = cls.match(new RegExp(`(?:^|\\s)${prefix}-(\\d+(?:\\.\\d+)?)(?:\\s|$)`));
  expect(m, `${prefix} in ${cls}`).not.toBeNull();
  return Number(m![1]) * 4;
};

describe("the setup chips in a phone's Film", () => {
  it("are one row that swipes on a phone in Film, and wrap as before everywhere else", () => {
    expect(view).toContain("const chipsInRow = !wide && filmOpen;");
    expect(chipsBlock).toContain(
      'data-setup-chips className={inPanel ? "flex flex-wrap items-center gap-2" : `absolute left-3.5 right-3.5 top-3.5 z-20 ${chipsInRow ? "" : "flex flex-wrap items-center gap-2"}`}>',
    );
    expect(chipsBlock).toContain(
      '<div data-setup-row className={chipsInRow ? "flex items-center gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "contents"}>',
    );
    // No wrap in the row: one line of chips, never five.
    const row = chipsBlock.slice(chipsBlock.indexOf("data-setup-row"), chipsBlock.indexOf(": \"contents\""));
    expect(row).not.toContain("flex-wrap");
  });

  it("hang every menu from the row there, so the scroller never cuts one off", () => {
    expect(view).toContain('const chipAnchor = chipsInRow ? "flex" : "relative";');
    // Eight chips open a menu (the new layout's shape and shot size, Helios Cut 3, step 16; who, look,
    // camera, mark, pose, gaze); none keeps a box of its own in the row.
    expect(chipsBlock.split("<div className={chipAnchor}>").length - 1).toBe(8);
    expect(chipsBlock).not.toContain('<div className="relative">');
    // Every one of them opens downward, under the row.
    expect(chipsBlock).not.toContain("DMENU_UP");
    expect(chipsBlock).not.toContain("DMENU_RIGHT");
  });
});

describe("the film dock on a phone", () => {
  it("never reaches the chips' row: its tallest is the stage less the row, the gap and the edges", () => {
    const dockClass = dockBlock.slice(dockBlock.indexOf("className={`absolute"), dockBlock.indexOf("`}", dockBlock.indexOf("className={`absolute")));
    const chipsClass = chipsBlock.slice(0, chipsBlock.indexOf("`}>"));
    const rowClass = chipsBlock.slice(chipsBlock.indexOf("data-setup-row"), chipsBlock.indexOf(": \"contents\""));
    const chip = view.slice(view.indexOf("const DCHIP =\n"), view.indexOf(";", view.indexOf("const DCHIP =\n")));
    // 14 above the row, a 32 px chip, an 8 px gap, and the dock's own 14 at the stage's foot.
    const room = px(chipsClass, "top") + px(chip, "h") + px(rowClass, "gap") + px(dockClass, "bottom");
    expect(room).toBe(68);
    expect(dockClass).toContain(`max-h-[calc(100%-${room}px)]`);
    // When it must give, the beats' row shrinks and scrolls; the cards in it keep their height.
    expect(dockBlock).toContain('<div className="flex items-stretch gap-2 overflow-x-auto">');
    expect(dockBlock).toContain("flex min-h-fit min-w-[210px] max-w-[280px] flex-1 flex-col");
  });

  it("opens the Starts menu inside itself, seen and pressable", () => {
    // The tile is no box of its own: the menu hangs from the dock, not above the tile in the scrolling row.
    expect(dockBlock).toContain('<div className="flex-shrink-0">\n                  <button\n                    type="button"\n                    onClick={() => toggleMenu("filmStart")}');
    expect(dockBlock).toContain('className={`${DMENU_BASE} left-2 top-2`}\n                      style={{ maxHeight: "calc(100% - 16px)" }}');
    expect(dockBlock).not.toContain("DMENU_UP");
    // Over the page's click-away layer (z-20) while it is open; under the chips' row otherwise.
    expect(view).toContain('className="fixed inset-0 z-20"');
    expect(dockBlock).toContain('${menu === "filmStart" ? "z-30" : "z-10"}');
  });
});

describe("the computer", () => {
  it("keeps its wrapped chips, each menu under its own chip, and the sequencer under the viewport", () => {
    // Off the row the wrapper is `contents` and each chip keeps its relative box: the frame's layout, unchanged.
    expect(chipsBlock).toContain('"flex flex-wrap items-center gap-2"');
    expect(view).toContain('const chipAnchor = chipsInRow ? "flex" : "relative";');
    expect(view).toContain("{wide && filmOpen && (\n          <Sequencer");
    // The chip row belongs to Film on a phone only, never Shoot or Cut, never the frame.
    expect(view).not.toContain("const chipsInRow = !wide;");
    expect(view).not.toContain("const chipsInRow = filmOpen;");
  });
});
