import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The studio's keys (cut 4, then the frame's rail in cut A), read as
// source: the shoot page's F and ⌘K and the rail's keys (studio.ts
// railToolForKey), the editor's rail keys and 1–4, all guarded so a field
// keeps the keyboard.

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const view = read("../../components/sets/set-view.tsx");
const editor = read("../../components/sets/set-editor.tsx");
const palette = read("../../components/sets/command-palette.tsx");

describe("the shoot page", () => {
  it("frames the figure on F, opens the commands on ⌘K and reads the rail's keys, never from a field", () => {
    const start = view.indexOf("The studio's keys (cut 4");
    expect(start).toBeGreaterThan(-1);
    const block = view.slice(start, view.indexOf("window.addEventListener(\"keydown\", onKey)", start));
    expect(block).toContain('k === "f"');
    expect(block).toContain('railToolForKey("shoot", k)');
    expect(block).not.toContain('k === "r"');
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
  it("reads the rail's keys into tools and actions, and a view on 1–4, never from a field", () => {
    const start = editor.indexOf("const onKey = (e: KeyboardEvent) => {");
    const block = editor.slice(start, editor.indexOf("window.addEventListener(\"keydown\", onKey)", start));
    expect(block).toContain('railToolForKey("build", k)');
    expect(block).toContain("railRef.current(railTool)");
    // The rail's actions, current each render: the transform tools, and a camera, a light, a mark, a prop.
    const rail = editor.slice(editor.indexOf("railRef.current = (id) => {"), editor.indexOf("function openFind()"));
    for (const [id, does] of [
      ["turn", 'setTool("rotate")'],
      ["size", 'setTool("scale")'],
      ["camera", "addACamera()"],
      ["light", "addALight()"],
      ["mark", "addAMark()"],
      ["kit", "setKitOpen"],
    ]) {
      expect(rail, `${id} → ${does}`).toContain(does);
      expect(rail).toContain(`id === "${id}"`);
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
