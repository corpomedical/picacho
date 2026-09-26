import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_PINNED,
  NAV_TOOLS,
  TOOL_GROUPS,
  isToolNew,
  isUnder,
  localDay,
  parseToolKeys,
  startingPins,
  toolForPath,
  togglePin,
  visibleTools,
  type ToolGates,
} from "./tools";

const NONE: ToolGates = {
  setsVisible: false,
  recceVisible: false,
  mystiqueVisible: false,
  liveVisible: false,
  cutVisible: false,
  pressTourVisible: false,
};
const ALL: ToolGates = {
  setsVisible: true,
  recceVisible: true,
  mystiqueVisible: true,
  liveVisible: true,
  cutVisible: true,
  pressTourVisible: true,
};
const root = join(__dirname, "..", "..");

describe("the sidebar's tools", () => {
  it("every tool opens a page that exists", () => {
    for (const tool of NAV_TOOLS) {
      const page = join(root, "app", ...tool.href.slice(1).split("/"), "page.tsx");
      expect(existsSync(page), tool.href).toBe(true);
    }
  });

  it("every tool sits on one of the panel's shelves, and every shelf has a tool", () => {
    for (const tool of NAV_TOOLS) expect(TOOL_GROUPS).toContain(tool.group);
    for (const group of TOOL_GROUPS) expect(NAV_TOOLS.some((tool) => tool.group === group)).toBe(true);
  });

  it("shows a gated tool only to the accounts its switch lets in", () => {
    expect(visibleTools(NONE).map((t) => t.key)).toEqual(["generate", "upscale", "layers", "templates", "notes"]);
    expect(visibleTools(ALL)).toHaveLength(NAV_TOOLS.length);
    expect(visibleTools({ ...NONE, liveVisible: true }).map((t) => t.key)).toContain("live");
    expect(visibleTools({ ...NONE, mystiqueVisible: true }).map((t) => t.key)).toContain("recast");
    expect(visibleTools({ ...NONE, pressTourVisible: true }).map((t) => t.key)).toContain("pressTour");
    expect(visibleTools({ ...ALL, pressTourVisible: false }).map((t) => t.key)).not.toContain("pressTour");
  });

  it("knows which tool a page belongs to, without matching a longer neighbour", () => {
    expect(toolForPath("/app/live", NAV_TOOLS)?.key).toBe("live");
    expect(toolForPath("/app/sets/abc", NAV_TOOLS)?.key).toBe("sets");
    expect(toolForPath("/app/edit", NAV_TOOLS)?.key).toBe("cut");
    expect(toolForPath("/app/editor", NAV_TOOLS)).toBeUndefined();
    expect(toolForPath("/app/history", NAV_TOOLS)).toBeUndefined();
    expect(isUnder(null, "/app")).toBe(false);
  });

  it("wears New inside its window until opened, and never after", () => {
    const live = NAV_TOOLS.find((t) => t.key === "live")!;
    const upscale = NAV_TOOLS.find((t) => t.key === "upscale")!;
    expect(isToolNew(live, "2026-09-25", new Set())).toBe(true);
    expect(isToolNew(live, live.newUntil!, new Set())).toBe(true);
    expect(isToolNew(live, "2026-12-01", new Set())).toBe(false);
    expect(isToolNew(live, "2026-09-25", new Set(["live"]))).toBe(false);
    expect(isToolNew(upscale, "2026-09-25", new Set())).toBe(false);
    expect(localDay(new Date(2026, 8, 5, 23, 30))).toBe("2026-09-05");
  });

  it("dates each New window as a plain day, so it compares as text", () => {
    for (const tool of NAV_TOOLS) {
      if (tool.newUntil) expect(tool.newUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("reads stored keys defensively and pins in order", () => {
    expect(parseToolKeys(null)).toEqual([]);
    expect(parseToolKeys("not json")).toEqual([]);
    expect(parseToolKeys('{"a":1}')).toEqual([]);
    expect(parseToolKeys('["live","nope",3,"live","upscale"]')).toEqual(["live", "upscale"]);
    expect(togglePin(["live"], "upscale")).toEqual(["live", "upscale"]);
    expect(togglePin(["live", "upscale"], "live")).toEqual(["upscale"]);
  });

  // Spec v2 N1 (2026-09-26): Press Tour is a pinned row under Tools, never a
  // new row in the menu. The pin is a per-browser default: seeded only while
  // nothing is stored, and only where the tool can be seen.
  it("pins Press Tour by default, only while no pin list is stored and only where it can be seen", () => {
    expect(DEFAULT_PINNED).toEqual(["pressTour"]);
    const shown = visibleTools(ALL).map((t) => t.key);
    const hidden = visibleTools(NONE).map((t) => t.key);
    // Nothing stored: the default, if this account can see it.
    expect(startingPins(null, shown)).toEqual(["pressTour"]);
    expect(startingPins(undefined, shown)).toEqual(["pressTour"]);
    expect(startingPins(null, hidden)).toEqual([]);
    // Anything stored is the person's own choice: an unpin (the empty list)
    // is never undone, and a list of their own pins is kept as it is.
    expect(startingPins("[]", shown)).toEqual([]);
    expect(startingPins('["live"]', shown)).toEqual(["live"]);
    expect(startingPins("not json", shown)).toEqual([]);
    // Unpinning the seeded pin stores an empty list, which then wins.
    expect(togglePin(startingPins(null, shown), "pressTour")).toEqual([]);
  });

  it("the sidebar seeds the default pins from what is stored, re-read when the visible tools change", () => {
    const sidebar = readFileSync(join(root, "components", "app-sidebar.tsx"), "utf8");
    expect(sidebar).toContain("pinned = startingPins(window.localStorage.getItem(PINNED_STORAGE_KEY), visibleKeys.split(\" \"));");
    expect(sidebar).not.toContain("pinned = parseToolKeys(window.localStorage.getItem(PINNED_STORAGE_KEY))");
  });

  it("the sidebar and the layout hand every gate through", () => {
    const sidebar = readFileSync(join(root, "components", "app-sidebar.tsx"), "utf8");
    const layout = readFileSync(join(root, "app", "app", "layout.tsx"), "utf8");
    for (const gate of Object.keys(ALL)) {
      expect(sidebar, gate).toContain(gate);
      expect(layout, gate).toContain(`${gate}={${gate}}`);
    }
    expect(sidebar).toContain("visibleTools(");
  });

  it("Press Tour is shown to admins with the switch on, and handed to the phone's lamp by the same gate", () => {
    const layout = readFileSync(join(root, "app", "app", "layout.tsx"), "utf8");
    // Admin first: every other account skips the flag read.
    expect(layout).toContain("const pressTourVisible = isAdmin && (await isPressTourEnabled(supabase));");
    expect(layout).toContain("pressTourOn={pressTourVisible}");
  });
});
