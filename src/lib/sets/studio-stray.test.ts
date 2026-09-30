import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Stray edits in Helios Studio (2026-09-30, live: twice Car 1 ended on the garage roof, Y 0.50 then 1.00, with a new
// keyframe, and The place got Z −0.54 with one, while menus and windows were opened and closed and the timeline ruler
// was clicked, auto keying on). Reproduced in the bundled harness on master's engine: the click that closed a menu,
// landing on the gizmo, moved Car 1 up 0.25 m and keyed it; G pressed with a menu open started a move; a move under
// way went on after a click on the ruler; a 2 px click on the gizmo left a "Transform" step and a key. The engine is
// plain DOM + WebGL (no jsdom run), so the guards are pinned by their source; the harness drives them for real.

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const engine = read("../../components/studio/studio-engine.ts");
const markup = read("../../components/studio/studio-markup.ts");

describe("auto keying", () => {
  it("starts off, as in Blender, and the button says which it is", () => {
    expect(engine).toContain("let autoKey = false, snapOn = true;");
    expect(markup).toContain('class=\\"rec\\" id=\\"rec\\" title=\\"Auto keying\\" aria-pressed=\\"false\\"');
    expect(markup).not.toContain('class=\\"rec on\\"');
    expect(engine).toContain('b.setAttribute("aria-pressed", String(autoKey)); b.title = autoKey ? "Auto keying: on · click to turn off" : "Auto keying: off · click to turn on";');
  });
});

describe("the click that closes a menu never reaches the viewport", () => {
  const block = engine.slice(engine.indexOf("let swallowing = false;"), engine.indexOf("document.querySelectorAll(\".list\").forEach(wireList);"));
  it("a press outside an open menu, popup or pie only closes it, before the viewport, the gizmo or a button sees it", () => {
    expect(block).toContain('dOn("pointerdown", (e) => {');
    expect(block).toContain('else if (overlayOpen() && !e.target.closest?.(".list, #pie, [data-menu]")) { closeMenus(); $("pie").hidden = true; swallowing = true; }');
    expect(block).toContain("downAt = null; e.stopPropagation(); e.preventDefault();");
    expect(block).toMatch(/\}, true\);/); // capture: before the canvas's own listeners (TransformControls, orbit, select)
    expect(block).toContain('for (const t of ["pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu"])');
  });
  it("a G/R/S move under way is cancelled by a press anywhere but the viewport, and by a window opening", () => {
    expect(block).toContain("if (modal && e.target !== canvas) { endModal(false); swallowing = true; }");
    expect(engine).toContain("function openWin(title, html) { if (modal) endModal(false);");
  });
  it("no shortcut reaches the viewport while a menu, popup, pie or window is open or holds focus — only Escape", () => {
    expect(engine).toContain('if ((overlayOpen() || e.target.closest?.(".list, #pie, .dlg")) && e.key !== "Escape") return;');
  });
  it("a press on the gizmo that barely moves moves nothing, keys nothing and leaves no undo step", () => {
    expect(engine).toContain("if (same || Math.hypot(mouse[0] - d.sx, mouse[1] - d.sy) < 4) { d.before.forEach((b) => applyTRS(b.i.obj, b.t)); refreshSel(); return; }");
  });
});
