import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";

// The new layout (2026-09-24, "I want the UI to be simpler and friendlier
// while also being professional"): a draft an admin switches on from the
// bar. Set · Shoot · Film as numbered steps; "In this set" down the left in
// place of the tool rail; one panel on the right; the same stage, shots
// and actions underneath. Read as source, like the page's other tests.

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const view = read("../../components/sets/set-view.tsx");
const panel = read("../../components/sets/things-panel.tsx");
const frame = read("../../components/sets/studio-frame.tsx");

const fnOf = (source: string, head: string, next: string) => {
  const a = source.indexOf(head);
  expect(a, head).toBeGreaterThan(-1);
  const b = source.indexOf(next, a + head.length);
  expect(b, next).toBeGreaterThan(a);
  return source.slice(a, b);
};

describe("the switch", () => {
  it("is an admin's, on a wide screen, remembered in the browser or asked for in the address", () => {
    expect(view).toContain("const simpleOn = simple && wide && modelsOn;");
    expect(view).toContain('if (asked ? asked === "simple" : window.localStorage.getItem("helios.layout") === "simple") setSimple(true);');
    expect(view).toContain('window.localStorage.setItem("helios.layout", next ? "simple" : "classic");');
    expect(view).toContain("{modelsOn && wide && (");
    expect(view).toContain("data-layout-toggle");
  });
});

describe("the new layout", () => {
  it("numbers its steps in the bar, and Set's button moves on to Shoot", () => {
    expect(view).toContain("steps={simpleSteps}");
    expect(frame).toContain("data-studio-steps");
    expect(frame).toContain("{i + 1} · {st.label}");
    expect(view).toContain('onClick={() => setSimpleStep("shoot")}');
    // Film's button is the render, the sequencer's own.
    expect(view).toMatch(/simpleOn && filmOpen && !cutOpen \? \([\s\S]{0,200}onClick=\{\(\) => void renderFilm\(\)\}/);
    // Film is Film; Set and Shoot are both today's shooting mode.
    expect(view).toContain('{ id: "film", label: sw.stepFilm, on: !simpleShooting, onClick: () => studioModes.film.onClick() },');
  });

  it("lists the set's people and things down the left in place of the rail, and the rail floats on the stage", () => {
    expect(view).toMatch(/\(simpleOn \? \(\s*<ThingsPanel/);
    expect(view).toContain("data-floating-tools");
    // A thing says what it is drawn as: a model, its photos, or blocks.
    expect(view).toContain('const state = model && loaded !== "failed" ? (loaded === "ready" ? "model" : "loading") : count > 0 ? "photos" : "blocks";');
    for (const hook of ["data-things-panel", "data-panel-row", "data-panel-state", "data-panel-place"]) expect(panel, hook).toContain(hook);
    // A row opens the thing's card; it never moves the camera.
    expect(view).toContain("onOpen={(key) => openElementCard(key)}");
    // The list replaces the stage's cast strip.
    expect(view).toContain("{!viewingShot && !loadFailed && !filmOpen && !simpleOn && (");
  });

  it("keeps one panel on the right in every step: the card, or Set's words and Astra, the shot's setup, or the film's beat and move", () => {
    const panelView = fnOf(view, "  function stepPanelView() {", "  function setupChipsView(");
    expect(panelView.indexOf("elementCardView(\"dock\")")).toBeLessThan(panelView.indexOf("setupChipsView(true)"));
    expect(panelView).toContain("{chatThread}");
    expect(panelView).toContain("{chatComposer}");
    expect(panelView).toContain("{rigTab && rigPanel(rigTab)}");
    expect(view).toContain("{wide && simpleOn && !cutOpen && stepPanelView()}");
    // Film is one panel too (2026-09-24): the rehearsal, the beat, its move — the classic dock's Film tab, drawn by the same function.
    expect(panelView).toContain("{filmBeatView()}");
    expect(panelView).toContain('{rigPanel("film")}');
    expect(view).toContain('{dockTab === "film" && filmBeatView()}');
    // Only the Cut, reached by its own address, keeps the dock.
    expect(view).toContain("{wide && !(simpleOn && !cutOpen) && (");
  });

  it("moves the setup chips off the stage, and the frame lines start clear of the floating tools", () => {
    expect(view).toContain("{!viewingShot && !simpleOn && setupChipsView(false)}");
    expect(view).toContain("insetsRef.current = { left: simpleOn ? 82 : 14, right: 14, top, bottom };");
  });
});

describe("the words", () => {
  it("exist in every language, with their placeholders", () => {
    const keys = Object.keys(en.sets.simple) as (keyof typeof en.sets.simple)[];
    expect(keys.length).toBeGreaterThan(20);
    for (const m of [en, es, pt, itMsgs]) {
      for (const key of keys) {
        expect(m.sets.simple[key], key).toBeTruthy();
        for (const ph of en.sets.simple[key].match(/\{\w+\}/g) ?? []) expect(m.sets.simple[key], `${key} ${ph}`).toContain(ph);
      }
    }
  });
});
