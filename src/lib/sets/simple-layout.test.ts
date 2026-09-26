import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThingsPanel, ThingsStrip, rowLine, type PanelRow } from "../../components/sets/things-panel";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";

// The new layout (2026-09-24, "I want the UI to be simpler and friendlier
// while also being professional"): a draft an admin switches on from the
// bar, behind its own gate (HELIOS_SIMPLE_FOR_ALL, Helios Cut 3). Set · Shoot · Film as numbered steps; "In this set" down the left in
// place of the tool rail; one panel on the right; the same stage, shots
// and actions underneath. Read as source, like the page's other tests.

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const view = read("../../components/sets/set-view.tsx");
const panel = read("../../components/sets/things-panel.tsx");
const frame = read("../../components/sets/studio-frame.tsx");
const config = read("set-config.ts");
const data = read("data.ts");
const setPage = read("../../app/app/sets/[id]/page.tsx");

const formatN = (msg: string, n: number) => msg.replace("{n}", String(n));

const fnOf = (source: string, head: string, next: string) => {
  const a = source.indexOf(head);
  expect(a, head).toBeGreaterThan(-1);
  const b = source.indexOf(next, a + head.length);
  expect(b, next).toBeGreaterThan(a);
  return source.slice(a, b);
};

describe("the switch", () => {
  // Its own gate (Helios Cut 3, step 10): simpleLayout, admins until
  // HELIOS_SIMPLE_FOR_ALL opens it — never models' admin-only switch.
  it("is where the layout is offered, on a wide screen, remembered in the browser or asked for in the address", () => {
    expect(view).toContain("const simpleOn = simple && wide3 && simpleLayout;");
    expect(view).not.toMatch(/const simple(On|Phone) = [^;]*modelsOn/);
    expect(view).toContain("if (!simpleLayout) return;");
    expect(view).toContain('const stored = asked ? null : window.localStorage.getItem("helios.layout");');
    expect(view).toContain('want = asked ? asked === "simple" : HELIOS_SIMPLE_FOR_ALL ? stored !== "classic" : stored === "simple";');
    expect(view).toContain("}, [simpleLayout]);");
    expect(view).toContain('window.localStorage.setItem("helios.layout", next ? "simple" : "classic");');
    expect(view).toContain("{simpleLayout && wide3 && (");
    expect(view).toContain("data-layout-toggle");
  });

  // The width floor (Helios Cut 3, step 11): three columns from 1180 px;
  // tablets and small windows keep Classic, and no switch shows there,
  // where it would do nothing. A phone keeps its own layout below 768.
  it("draws three columns only from 1180 px, with Classic and no switch below it", () => {
    expect(view).toContain('const wide3 = useWideAt("(min-width: 1180px)");');
    expect(view).not.toContain("{simpleLayout && wide && (");
    expect(frame).toContain("export function useWideAt(query: string): boolean {");
    expect(frame).toContain('return useWideAt(WIDE);');
    // One subscribe per query, kept: React would resubscribe on every render otherwise.
    expect(frame).toContain("const subscribers = new Map<string, (cb: () => void) => () => void>();");
    expect(frame).toMatch(/useSyncExternalStore\(\s*subscribeTo\(query\),/);
  });

  it("starts on when it is everyone's default, so a load never paints Classic first", () => {
    expect(view).toContain("const [simple, setSimple] = useState<boolean>(() => simpleLayout && HELIOS_SIMPLE_FOR_ALL);");
  });

  it("is admins' until its own switch opens it, and the page is handed the gate", () => {
    expect(config).toContain("export const HELIOS_SIMPLE_FOR_ALL = false;");
    expect(data).toContain("simpleLayout: access.isAdmin || HELIOS_SIMPLE_FOR_ALL,");
    expect(setPage).toContain("simpleLayout={data.simpleLayout}");
    // Models on things keep their own admin-only gate.
    expect(data).toContain("modelsOn: access.isAdmin,");
  });
});

describe("the new layout", () => {
  it("numbers its steps in the bar, and Set's button moves on to Shoot", () => {
    expect(view).toContain("steps={simpleSteps}");
    expect(frame).toContain("data-studio-steps");
    // A phone's bar has room for the names only; the numbers come back from md up.
    expect(frame).toContain('<span className="hidden md:inline">{i + 1} · </span>');
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
    expect(view).toContain("{!viewingShot && !simpleOn && !simplePhoneSet && setupChipsView(false)}");
    expect(view).toContain("insetsRef.current = { left: simpleOn ? 82 : 14, right: 14, top, bottom };");
  });
});

// The conversation in every step (Helios Cut 3, step 13): a reply sent from
// Shoot or Film shows there, not only in Set.
describe("the conversation in every step", () => {
  const panelView = () => fnOf(view, "  function stepPanelView() {", "  function setupChipsView(");

  it("draws the thread under Set, Shoot and Film alike, one branch at a time", () => {
    expect(panelView().split("{chatThread}").length - 1).toBe(3);
    expect(panelView()).toMatch(/\{rigTab && rigPanel\(rigTab\)\}\s*<\/div>\s*\{chatThread\}/);
    expect(panelView()).toMatch(/\{rigPanel\("film"\)\}\s*<\/div>\s*\{chatThread\}/);
  });

  it("scrolls the thread alone in Shoot and Film, so a reply never takes the chips or the beat off the screen", () => {
    // The thread's move to its newest line is a scrollIntoView: in one
    // scroll with the controls it would scroll them away. Split, the
    // controls scroll on their own, and the thread is its own scroll.
    expect(view).toContain('threadEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });');
    expect(panelView()).toContain('const split = !elementCard && (!simpleShooting || simpleStep === "shoot");');
    expect(panelView()).toContain('<div className={split ? "flex min-h-0 flex-1 flex-col" : "min-h-0 flex-1 overflow-y-auto"}');
    expect(panelView()).toContain('<div className="max-h-[60%] flex-none overflow-y-auto" data-step-film>');
    expect(panelView()).toContain('<div className="max-h-[60%] flex-none overflow-y-auto" data-step-shoot-controls>');
    // The thread is its own scroll where it is a flex child.
    expect(view).toMatch(/const chatThread = \(\s*<div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">/);
  });

  it("goes back to the conversation when Film closes in the new layout, and keeps Classic's Film tab", () => {
    expect(view).toContain('setDockTab(simpleOn && !filmOpen ? "astra" : dockTabAfter(dockTab, "shoot", filmOpen, filmOpen));');
    expect(view).not.toContain('setDockTab(simple ? "astra"');
  });

  it("takes ⌘K's camera to Shoot and its conversation to Set", () => {
    expect(view).toMatch(/setRigOpen: \(open\) => \{[\s\S]{0,160}if \(simpleOn && open\) setSimpleStep\("shoot"\);/);
    expect(view).toMatch(/setChatOpen: \(open\) => \{[\s\S]{0,160}if \(simpleOn && open\) setSimpleStep\("set"\);/);
  });
});

// The cast strip's three facts, in the list (Helios Cut 3, step 14): the new
// layout never draws the strip, so its list says which things' photos ride
// the next still and why the others don't, when the character needs the
// person's answer, and what photos are on nothing, with the strip's own
// menu to put them back.
describe("the cast strip's facts in the list", () => {
  const w = en.sets.simple;
  const c = en.sets.cast;
  const person: PanelRow = { key: "__figure", name: "Eva", thumb: null, round: true, state: "person" };
  const car: PanelRow = { key: "car", name: "Car", thumb: null, state: "photos", photos: 2, word: c.stRides, rides: true, title: "sheet 1 of 1" };
  const bike: PanelRow = { key: "bike", name: "Bike", thumb: null, state: "photos", photos: 1, word: c.stOut, rides: false };
  const loose = { loose: [{ refId: "r1", url: "https://example.test/l.jpg" }] as never, targets: [{ key: "car", name: "Car" }], onPutOn: () => {}, onRemoveLoose: () => {} };

  it("says whether a thing's photos ride, in the strip's words and ochre", () => {
    expect(rowLine(car, w, c)).toEqual({ text: `${formatN(w.rowPhotos, 2)} · ${c.stRides}`, tone: "text-[#f0cda6]" });
    expect(rowLine(bike, w, c)).toEqual({ text: `${w.rowOnePhoto} · ${c.stOut}`, tone: "text-[#c6c9d1]" });
    // No photos, no word: the line is what it was.
    expect(rowLine({ key: "box", name: "Box", thumb: null, state: "blocks" }, w, c)).toEqual({ text: w.rowBlocks, tone: "text-[#9aa0ad]" });
    expect(view).toContain("word: chip?.word,");
    expect(view).toContain('rides: chip?.state === "rides",');
    expect(view).toContain("const castChipOf = new Map(castChips.map((ch) => [ch.key, ch]));");
  });

  it("says when the character needs the person's answer", () => {
    expect(rowLine({ ...person, state: "answer" }, w, c)).toEqual({ text: c.needsAnswer, tone: "text-[#e0a468]" });
    expect(rowLine(person, w, c).text).toBe(w.rowPlays);
    expect(view).toContain('state: likenessNeeded(character.id) ? "answer" : "person",');
  });

  it("offers photos on nothing a way home, with the strip's own menu, in the list and on the phone's strip", () => {
    const panelHtml = renderToStaticMarkup(
      createElement(ThingsPanel, { people: [person], things: [car], selected: null, onOpen: () => {}, onPlace: () => {}, placeLine: w.placeText, models: false, loose, w, c }),
    );
    expect(panelHtml).toContain("data-cast-loose");
    expect(panelHtml).toContain(w.loose);
    expect(panelHtml).toContain(c.looseOne);
    expect(panelHtml).toContain('title="sheet 1 of 1"');
    const stripHtml = renderToStaticMarkup(createElement(ThingsStrip, { rows: [person, car], selected: null, onOpen: () => {}, loose, w, c }));
    expect(stripHtml).toContain("data-cast-loose");
    expect(stripHtml).toContain(`${formatN(w.rowPhotos, 2)} · ${c.stRides}`);
    // With nothing loose, nothing is added.
    const none = renderToStaticMarkup(createElement(ThingsStrip, { rows: [person], selected: null, onOpen: () => {}, loose: { ...loose, loose: [] }, w, c }));
    expect(none).not.toContain("data-cast-loose");
    expect(none.startsWith("<nav")).toBe(true);
    // The list scrolls, so its menu opens downward; the strip's opens upward, outside the strip's own scroll.
    expect(panel).toContain("menuClassName={LOOSE_MENU_BELOW}");
    expect(view).toContain("loose={panelLoose}");
    expect(view).toContain("loose: resolved.loose.map((l) => l.photo),");
  });

  it("keeps Classic's strip drawing the same popover, kept in cast-strip.tsx", () => {
    const strip = read("../../components/sets/cast-strip.tsx");
    expect(strip).toContain("export function LoosePhotos(");
    expect(strip).toContain("{loose.length > 0 && <LoosePhotos loose={loose} targets={targets} onPutOn={onPutOn} onRemoveLoose={onRemoveLoose} c={c} />}");
    expect(strip).toContain("buttonClassName = `${CHIP} border-dashed border-[rgba(214,217,224,0.4)] text-[#d6d9e0]`,");
    expect(strip).toContain("menuClassName = MENU,");
  });
});

describe("the new layout on a phone", () => {
  it("keeps the same steps; in Set the list is a strip over the stage's foot and the setup chips step aside", () => {
    expect(view).toContain("const simplePhone = simple && !wide && simpleLayout;");
    expect(view).toContain('const simplePhoneSet = simplePhone && !filmOpen && !cutOpen && simpleStep === "set";');
    expect(view).toContain("const simpleSteps = simpleOn || simplePhone");
    expect(view).toContain("{!viewingShot && !simpleOn && !simplePhoneSet && setupChipsView(false)}");
    expect(view).toMatch(/\{simplePhoneSet \? \([\s\S]{0,200}<ThingsStrip /);
    expect(panel).toContain("data-things-strip");
    // In Shoot the chips already name who is in the still: no cast strip under them.
    expect(view).toContain('castShown && !simplePhone && castStrip("pointer-events-auto relative max-w-full")');
  });

  it("puts the switch at the stage's foot, where the bar has no room for it", () => {
    expect(view).toContain("{simpleLayout && !wide && (");
    expect(view).toContain("data-layout-toggle-phone");
  });
});

describe("the floating tools", () => {
  it("are only the ones that work here: nothing dimmed with a note", () => {
    expect(frame).toContain('const tools = railToolsFor(mode).filter((t) => !compact || t.use !== "off");');
    expect(view).toMatch(/<StudioRail\s+compact/);
  });
});

// Words a paying customer reads in the new layout (Helios Cut 3, step 12):
// a model on a thing is an admin's (modelsOn), so everyone else's list and
// Set panel speak of photos alone, and the bar's steps are named in the
// page's language, not a hard-coded "Steps".
describe("the words where a model cannot be added", () => {
  it("say photos alone, and photos or a model only where models are on", () => {
    expect(panel).toContain("models: boolean;");
    expect(panel).toContain("{models ? w.noThings : w.noThingsPhotos}");
    expect(panel).toContain("{models ? w.thingsHint : w.thingsHintPhotos}");
    expect(view).toContain("models={modelsOn}");
    expect(view).toContain("{modelsOn ? sw.setHint : sw.setHintPhotos}");
    for (const m of [en, es, pt, itMsgs]) {
      for (const key of ["noThingsPhotos", "thingsHintPhotos", "setHintPhotos"] as const) {
        expect(m.sets.simple[key], key).not.toMatch(/model|modelo|modello/i);
      }
    }
  });

  it("name the bar's steps in the page's language", () => {
    expect(frame).toContain("stepsLabel?: string;");
    expect(frame).toContain("<nav aria-label={stepsLabel} className={SEG} data-studio-steps>");
    expect(frame).not.toContain('aria-label="Steps"');
    expect(view).toContain("stepsLabel={sw.stepsLabel}");
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
