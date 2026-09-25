import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NAV_TOOLS,
  TOOL_GROUPS,
  isToolNew,
  isUnder,
  localDay,
  parseToolKeys,
  toolForPath,
  togglePin,
  visibleTools,
  type ToolGates,
} from "./tools";

const NONE: ToolGates = { setsVisible: false, recceVisible: false, mystiqueVisible: false, liveVisible: false, cutVisible: false };
const ALL: ToolGates = { setsVisible: true, recceVisible: true, mystiqueVisible: true, liveVisible: true, cutVisible: true };
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

  it("the sidebar and the layout hand every gate through", () => {
    const sidebar = readFileSync(join(root, "components", "app-sidebar.tsx"), "utf8");
    const layout = readFileSync(join(root, "app", "app", "layout.tsx"), "utf8");
    for (const gate of Object.keys(ALL)) {
      expect(sidebar, gate).toContain(gate);
      expect(layout, gate).toContain(`${gate}={${gate}}`);
    }
    expect(sidebar).toContain("visibleTools(");
  });
});
