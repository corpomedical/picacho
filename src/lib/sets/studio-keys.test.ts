import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The studio's keys (cut 4), read as source: the shoot page's F, R and ⌘K,
// the editor's V G R S and 1–4, all guarded so a field keeps the keyboard.

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const view = read("../../components/sets/set-view.tsx");
const editor = read("../../components/sets/set-editor.tsx");
const palette = read("../../components/sets/command-palette.tsx");

describe("the shoot page", () => {
  it("frames the figure on F, shows the rig on R and opens the commands on ⌘K, never from a field", () => {
    const start = view.indexOf("The studio's keys (cut 4)");
    expect(start).toBeGreaterThan(-1);
    const block = view.slice(start, view.indexOf("window.addEventListener(\"keydown\", onKey)", start));
    expect(block).toContain('k === "f"');
    expect(block).toContain('k === "r"');
    expect(block).toContain('(e.metaKey || e.ctrlKey) && k === "k"');
    expect(block).toMatch(/TEXTAREA|INPUT/);
    expect(block).toContain("isContentEditable");
  });

  it("has a ⌘K pill and the palette", () => {
    expect(view).toContain("<CommandPalette");
    expect(view).toContain("setPaletteOpen(true)");
  });
});

describe("the editor", () => {
  it("picks a tool on V, G, R and S, and a view on 1–4, never from a field", () => {
    const start = editor.indexOf("const onKey = (e: KeyboardEvent) => {");
    const block = editor.slice(start, editor.indexOf("window.addEventListener(\"keydown\", onKey)", start));
    for (const [k, tool] of [
      ["v", "select"],
      ["g", "move"],
      ["r", "rotate"],
      ["s", "scale"],
    ]) {
      expect(block, `${k} → ${tool}`).toMatch(new RegExp(`k === "${k}" \\? "${tool}"`));
    }
    expect(block).toContain("VIEW_MODES[Number(k) - 1]");
    expect(block).toMatch(/TEXTAREA|INPUT/);
  });
});

describe("the palette", () => {
  it("closes on Escape and runs on Enter", () => {
    expect(palette).toContain('e.key === "Escape"');
    expect(palette).toContain('e.key === "Enter"');
    expect(palette).toContain('e.key === "ArrowDown"');
  });
});
