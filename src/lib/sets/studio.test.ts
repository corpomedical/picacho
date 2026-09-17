import { describe, expect, it } from "vitest";
import { normaliseSetRig } from "./rig";
import { schemeDefaults } from "./light-schemes";
import { DOCK_TABS, RAIL_TOOLS, dockTabAfter, dockTabsFor, railToolForKey, railToolsFor, studioChecked, studioHeld, studioLab } from "./studio";

// The studio's frame (board J1, cut A): the nine-tool rail on single keys,
// the dock's tabs per mode, and the status bar's three lists.

describe("the rail", () => {
  it("has the nine drawn tools on nine different single keys, in three groups", () => {
    expect(RAIL_TOOLS.map((t) => t.id)).toEqual(["select", "move", "turn", "size", "camera", "light", "mark", "measure", "kit"]);
    expect(new Set(RAIL_TOOLS.map((t) => t.key)).size).toBe(9);
    expect(RAIL_TOOLS.every((t) => t.key.length === 1)).toBe(true);
    expect(RAIL_TOOLS.map((t) => t.group)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3]);
  });

  it("keeps every tool in every mode, saying which are off and why", () => {
    const build = railToolsFor("build");
    expect(build.map((t) => t.id)).toEqual(RAIL_TOOLS.map((t) => t.id));
    expect(build.find((t) => t.id === "size")?.use).toBe("tool");
    expect(build.find((t) => t.id === "kit")?.use).toBe("action");
    expect(build.find((t) => t.id === "measure")).toMatchObject({ use: "off", note: "measure" });
    for (const mode of ["shoot", "film"] as const) {
      const rail = railToolsFor(mode);
      expect(rail.map((t) => t.id)).toEqual(RAIL_TOOLS.map((t) => t.id));
      expect(rail.filter((t) => t.use === "tool").map((t) => t.id)).toEqual(["select", "move", "turn"]);
      expect(rail.find((t) => t.id === "size")).toMatchObject({ use: "off", note: "build" });
      expect(rail.find((t) => t.id === "kit")).toMatchObject({ use: "off", note: "build" });
      expect(rail.find((t) => t.id === "measure")).toMatchObject({ use: "off", note: "measure" });
    }
  });

  it("reads a key into a tool, either case, and ignores a key that is off here", () => {
    expect(railToolForKey("build", "g")).toBe("move");
    expect(railToolForKey("build", "S")).toBe("size");
    expect(railToolForKey("shoot", "r")).toBe("turn");
    expect(railToolForKey("shoot", "s")).toBeNull();
    expect(railToolForKey("shoot", "k")).toBeNull();
    expect(railToolForKey("build", "d")).toBeNull();
    expect(railToolForKey("shoot", "Shift")).toBeNull();
  });
});

describe("the dock", () => {
  it("shows the drawn tabs on the shoot, Film while the film is open, and the scene with its edits in Build", () => {
    expect(dockTabsFor("shoot", false)).toEqual(["scene", "camera", "light", "look", "history", "astra"]);
    expect(dockTabsFor("shoot", true)).toEqual(["scene", "camera", "light", "look", "film", "history", "astra"]);
    expect(dockTabsFor("build", false)).toEqual(["scene", "history", "astra"]);
    for (const t of dockTabsFor("shoot", true)) expect(DOCK_TABS).toContain(t);
  });

  it("goes to Film when the film opens, back to Camera when it closes on Film, and keeps any other tab", () => {
    expect(dockTabAfter("look", "shoot", true, true)).toBe("film");
    expect(dockTabAfter("film", "shoot", false, false)).toBe("camera");
    expect(dockTabAfter("light", "shoot", false, false)).toBe("light");
    expect(dockTabAfter("camera", "build", false, false)).toBe("scene");
  });
});

describe("the status bar", () => {
  const rig = normaliseSetRig(null);

  it("holds the frame and the lens always, and the rest as the rig sets them", () => {
    expect(studioHeld(rig, { move: false, pose: false })).toEqual(["frame", "lens"]);
    expect(studioHeld({ ...rig, stop: 2.8 }, { move: false, pose: false })).toEqual(["frame", "lens", "stop", "focus"]);
    expect(studioHeld({ ...rig, time: 16.75 }, { move: true, pose: true })).toEqual(["frame", "lens", "sun", "hour", "move", "pose"]);
    expect(studioHeld({ ...rig, light: schemeDefaults("golden-hour", 0) }, { move: false, pose: false })).toContain("sun");
    expect(studioHeld({ ...rig, light: schemeDefaults("window", 0) }, { move: false, pose: false })).not.toContain("sun");
  });

  it("lists what the rig check reads after the render, never the stop", () => {
    expect(studioChecked(rig)).toEqual([]);
    const checked = studioChecked({ ...rig, light: schemeDefaults("golden-hour", 0), stop: 2.8, palette: "amber-hour" });
    expect(checked).toContain("plot");
    expect(checked).toContain("palette");
    expect(checked).not.toContain("focus");
  });

  it("lists what the lab makes: grain from a stock, character from a lens, black and white from the silver palette", () => {
    expect(studioLab(rig)).toEqual([]);
    expect(studioLab({ ...rig, stock: "film35" })).toEqual(["grain"]);
    expect(studioLab({ ...rig, lens: "anamorphic" })).toEqual(["character"]);
  });
});
