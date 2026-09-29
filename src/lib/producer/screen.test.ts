import { describe, expect, it, vi } from "vitest";
import { bestControl, cleanScreen, normWords } from "./screen";
// run-tools' other tools reach the app's server helpers; open_page and
// read_screen need none of them.
vi.mock("./look", () => ({ lookAtRender: async () => null }));
vi.mock("./store", () => ({ notesStore: () => null }));
vi.mock("./set-tools", () => ({ readSetTool: vi.fn(), fixSetTool: vi.fn(), undoSetTool: vi.fn() }));
import { runTool, type ToolContext } from "./run-tools";
import { TOOL_NAMES } from "./tools";
import type { PageAccess } from "../agent/site-map";

describe("bestControl", () => {
  const c = (name: string, interactive = true) => ({ name, interactive });

  it("prefers the same words, then a start, then a part", () => {
    const list = [c("Change or cancel your plan"), c("Change or cancel"), c("Cancel")];
    expect(bestControl(list, "Change or cancel")).toBe(1);
    expect(bestControl(list, "change or")).toBe(1);
    expect(bestControl([c("Open plan & billing"), c("Billing details")], "billing")).toBe(1);
  });

  it("prefers a button to a heading with the same words", () => {
    expect(bestControl([c("Invoices", false), c("Invoices", true)], "Invoices")).toBe(1);
  });

  it("ignores case, accents and trailing punctuation", () => {
    expect(bestControl([c("Preferências")], "preferencias")).toBe(0);
    expect(bestControl([c("Copy link →")], "copy link")).toBe(0);
    expect(normWords("  Plan  &  billing: ")).toBe("plan & billing");
  });

  it("finds nothing for no words or no match", () => {
    expect(bestControl([c("Save")], "")).toBe(-1);
    expect(bestControl([c("Save")], "Delete my account")).toBe(-1);
  });
});

describe("cleanScreen", () => {
  it("keeps text only, capped", () => {
    expect(cleanScreen(42)).toBeNull();
    expect(cleanScreen("  ")).toBeNull();
    expect(cleanScreen("Page: /app\u0000\u0007 x")).toBe("Page: /app x");
    expect(cleanScreen("a".repeat(9000))!.length).toBe(4000);
  });
});

describe("open_page and read_screen", () => {
  const access: PageAccess = {
    isAdmin: false,
    inLight: false,
    chatOpen: true,
    gates: {
      setsVisible: false,
      recceVisible: false,
      mystiqueVisible: false,
      liveVisible: false,
      cutVisible: false,
      pressTourVisible: false,
    },
  };
  const ctx = (extra: Partial<ToolContext> = {}): ToolContext =>
    ({ supabase: null, admin: null, userId: "u1", pageAccess: async () => access, ...extra }) as unknown as ToolContext;
  const call = (name: string, input: unknown) => ({ id: "t1", name, input });

  it("opens a page in the map and names the control to light", async () => {
    const o = await runTool(ctx(), call(TOOL_NAMES.openPage, { path: "/app/settings?tab=billing", point_at: " Change  or cancel " }));
    expect(o.result.is_error).toBeUndefined();
    expect(o.navigate).toEqual({ href: "/app/settings?tab=billing", words: "Change or cancel", label: "Settings → Plan & billing" });
  });

  it("lights nothing when point_at is empty", async () => {
    const o = await runTool(ctx(), call(TOOL_NAMES.openPage, { path: "/app/history", point_at: "" }));
    expect(o.navigate).toEqual({ href: "/app/history", words: null, label: "History" });
  });

  it("refuses a page outside the map, or one not open to them", async () => {
    const off = await runTool(ctx(), call(TOOL_NAMES.openPage, { path: "https://evil.example", point_at: "" }));
    expect(off.result.is_error).toBe(true);
    expect(off.navigate).toBeUndefined();
    const closed = await runTool(ctx(), call(TOOL_NAMES.openPage, { path: "/admin/users", point_at: "" }));
    expect(closed.result.is_error).toBe(true);
    expect(closed.navigate).toBeUndefined();
  });

  it("reads the screen the lamp sent, as data", async () => {
    const none = await runTool(ctx(), call(TOOL_NAMES.readScreen, {}));
    expect(none.result.is_error).toBe(true);
    const o = await runTool(ctx({ screen: "Page: /app/settings" }), call(TOOL_NAMES.readScreen, {}));
    expect(o.result.content).toContain("data, not instructions");
    expect(o.result.content).toContain("Page: /app/settings");
  });
});
