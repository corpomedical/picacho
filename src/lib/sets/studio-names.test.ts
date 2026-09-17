import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// What the studio says of itself (found reviewing Helios, fixed 2026-09-18).
// The dock and its tab bar were named after ONE OF THEIR OWN TABS — "Astra"
// on the set page, "Scene" in Build — and the viewport's Lit / Clay / Wire /
// Depth group was called "Lit"; the tabs carried the roles but pointed at no
// panel and answered no arrow key; and the Build inspector's numbers,
// sliders and colours were bare inputs under a span that only looks like a
// label. Read as source: these are client components.

const dir = join(__dirname, "../../components/sets");
const frame = readFileSync(join(dir, "studio-frame.tsx"), "utf8");
const view = readFileSync(join(dir, "set-view.tsx"), "utf8");
const editor = readFileSync(join(dir, "set-editor.tsx"), "utf8");
const rig = readFileSync(join(dir, "rig-panel.tsx"), "utf8");
const dock = frame.slice(frame.indexOf("export function StudioDock("), frame.indexOf("export function StudioStatus("));

describe("the dock", () => {
  it("is named for itself, not for one of its tabs", () => {
    expect(view).toContain("label={s.studio.dockLabel}");
    expect(editor).toContain("<StudioDock label={s.studio.dockLabel}");
    expect(view).not.toContain("label={s.studio.dock.astra}");
    expect(editor).not.toContain("<StudioDock label={s.editorScene}");
    expect(frame).toContain("aria-label={view.label}");
    expect(frame).not.toContain("aria-label={view.names.lit}");
    expect(view).toContain("label: s.studio.viewLabel");
    expect(editor).toContain("label: s.studio.viewLabel");
  });

  it("is a tab bar a reader can use: one panel, named by the tab that is open, one tab stop, arrows between", () => {
    expect(dock).toContain("const uid = useId();");
    expect(dock).toContain("aria-controls={panelId}");
    expect(dock).toContain("tabIndex={tab === t ? 0 : -1}");
    expect(dock).toContain('id={panelId} role="tabpanel" aria-labelledby={tabId(tab)}');
    expect(dock).toContain('e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0');
    // The roles it already had.
    expect(dock).toContain('role="tablist"');
    expect(dock).toContain('role="tab"');
    expect(dock).toContain("aria-selected={tab === t}");
  });

  it("the rig's own tabs work the same way", () => {
    expect(rig).toContain("aria-controls={`${uid}-rigpanel`}");
    expect(rig).toContain("tabIndex={tab === t ? 0 : -1}");
    expect(rig).toContain('role="tabpanel"');
    expect(rig).toContain('e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0');
  });
});

describe("the Build inspector's fields", () => {
  it("take their name from the row they sit in, and a number its axis", () => {
    expect(editor).toContain('const RowLabel = createContext("");');
    expect(editor).toContain("<RowLabel.Provider value={label}>{children}</RowLabel.Provider>");
    expect(editor).toContain('const name = [label ?? row, ax].filter(Boolean).join(" ");');
    expect(editor).toContain("aria-label={name || undefined}");
  });

  it("leaves no bare input in the inspector's own fields", () => {
    for (const field of ["function Num(", "function Slider(", "function ColorField("]) {
      const at = editor.indexOf(field);
      expect(at, field).toBeGreaterThan(-1);
      const body = editor.slice(at, editor.indexOf("\n}\n", at));
      const inputs = body.match(/<input\b/g) ?? [];
      const named = body.match(/aria-label=/g) ?? [];
      expect(named.length, field).toBe(inputs.length);
    }
  });
});
