import { describe, expect, it, vi } from "vitest";
import { bestControl, cleanScreen, normWords, pressRefusal } from "./screen";
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

// press_button's fence (2026-10-01): a tiny stand-in for DOM elements, enough
// for closest() with the selectors pressRefusal uses (tag, [attr], [attr="v"],
// tag[attr], comma lists).
type Fake = { tagName: string; attrs: Record<string, string>; parent: Fake | null };
function fake(tag: string, attrs: Record<string, string> = {}, parent: Fake | null = null) {
  const el: Fake = { tagName: tag.toUpperCase(), attrs, parent };
  const matches = (e: Fake, sel: string) => {
    const m = /^([a-z]*)((?:\[[^\]]+\])*)$/i.exec(sel.trim());
    if (!m) return false;
    if (m[1] && e.tagName !== m[1].toUpperCase()) return false;
    for (const a of m[2].match(/\[[^\]]+\]/g) ?? []) {
      const [, k, v] = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(a)!;
      if (!(k in e.attrs) || (v !== undefined && e.attrs[k] !== v)) return false;
    }
    return true;
  };
  const api = {
    ...el,
    getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
    hasAttribute: (k: string) => k in attrs,
    closest: (selector: string): unknown => {
      for (let e: Fake | null = el; e; e = e.parent) {
        if (selector.split(",").some((s) => matches(e!, s))) return e === el ? api : wrap(e);
      }
      return null;
    },
  };
  return api;
}
const wraps = new Map<Fake, unknown>();
function wrap(e: Fake): unknown {
  if (!wraps.has(e)) wraps.set(e, fake(e.tagName.toLowerCase(), e.attrs, e.parent));
  return wraps.get(e);
}

describe("pressRefusal", () => {
  const origin = "https://picacho.ai";
  const refuse = (el: unknown) => pressRefusal(el as Element, origin);

  it("presses links inside Picacho, tabs, panel openers and marked buttons", () => {
    expect(refuse(fake("a", { href: "/app/history" }))).toBeNull();
    expect(refuse(fake("button", { role: "tab" }))).toBeNull();
    expect(refuse(fake("button", { type: "button", "aria-expanded": "false" }))).toBeNull();
    expect(refuse(fake("button", { type: "button", "data-aly-press": "" }))).toBeNull();
    // Continue this clip: a link marked safe, drawing a button.
    const marked = { tagName: "A", attrs: { href: "/app/generate?continue=1", "data-aly-press": "" }, parent: null };
    expect(refuse(fake("button", { type: "button" }, marked))).toBeNull();
    // A History tile: one big link with Delete inside it. Delete is a button, judged as itself.
    const tile = { tagName: "A", attrs: { href: "/app/history/x" }, parent: null };
    expect(refuse(fake("button", { type: "button", "aria-label": "Delete" }, tile))).toMatch(/theirs to press/);
  });

  it("refuses plain buttons, forms, payments, other sites and her own controls", () => {
    expect(refuse(fake("button", { type: "button" }))).toMatch(/theirs to press/); // Delete, Buy…
    expect(refuse(fake("button", { type: "submit" }))).toMatch(/sends a form/);
    const form = { tagName: "FORM", attrs: {}, parent: null };
    expect(refuse(fake("button", {}, form))).toMatch(/sends a form/);
    expect(refuse(fake("a", { href: "/app/checkout?plan=elite" }))).toMatch(/payment/);
    expect(refuse(fake("a", { href: "https://billing.stripe.com/x" }))).toMatch(/leaves Picacho/);
    expect(refuse(fake("a", { href: "mailto:hello@picacho.ai" }))).toMatch(/another app/);
    expect(refuse(fake("button", { "data-aly-press": "", disabled: "" }))).toMatch(/switched off/);
    const never = { tagName: "DIV", attrs: { "data-aly-never": "" }, parent: null };
    expect(refuse(fake("a", { href: "/app" }, never))).toMatch(/theirs/);
    const mine = { tagName: "DIV", attrs: { "data-aly-ui": "" }, parent: null };
    expect(refuse(fake("button", { "data-aly-press": "" }, mine))).toMatch(/my own/);
    expect(refuse(fake("div"))).toMatch(/can be pressed/);
  });
});
