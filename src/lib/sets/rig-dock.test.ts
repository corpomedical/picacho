import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RIG_SECTIONS, RIG_TABS, RIG_TAB_SECTIONS, tabAfterFilm, tabOf, tabsFor } from "./rig-dock";

// The rig as a dock (the studio, cut 4): every section in exactly one tab,
// and the panel hiding each section by its tab.

describe("the dock's tabs", () => {
  it("place every section once", () => {
    const placed = RIG_TABS.flatMap((t) => RIG_TAB_SECTIONS[t]);
    expect([...placed].sort()).toEqual([...RIG_SECTIONS].sort());
    for (const s of RIG_SECTIONS) expect(RIG_TAB_SECTIONS[tabOf(s)]).toContain(s);
  });

  it("show Film only while the film is open, and take the front when it opens", () => {
    expect(tabsFor(false)).toEqual(["camera", "light", "look"]);
    expect(tabsFor(true)).toEqual(["camera", "light", "look", "film"]);
    expect(tabAfterFilm("look", true)).toBe("film");
    expect(tabAfterFilm("film", false)).toBe("camera");
    expect(tabAfterFilm("light", false)).toBe("light");
  });

  it("are what the panel hides by: each section carries its tab's switch", () => {
    const panel = readFileSync(join(__dirname, "../../components/sets/rig-panel.tsx"), "utf8");
    for (const s of RIG_SECTIONS) expect(panel, s).toContain(`hidden={!show("${s}")}`);
    expect(panel.match(/hidden=\{!show\(/g)?.length).toBe(RIG_SECTIONS.length);
  });
});
