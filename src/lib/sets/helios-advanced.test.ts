import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SET_RIG, NEW_SET_RIG, RIG_FORMAT_ORDER, normaliseSetRig, rigAdvancedInUse } from "./rig";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";

// Advanced (Helios Cut 3, step 15a): the new layout's first screens show
// what a first still needs, and everything else waits one press away in the
// bar. Read as source, like the page's other tests; the rig rule is pure.

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const view = read("../../components/sets/set-view.tsx");

const between = (from: string, to: string) => {
  const a = view.indexOf(from);
  expect(a, from).toBeGreaterThan(-1);
  const b = view.indexOf(to, a + from.length);
  expect(b, to).toBeGreaterThan(a);
  return view.slice(a, b);
};

describe("the state", () => {
  it("is lean only in the new layout with Advanced off: Classic is never lean", () => {
    expect(view).toContain("const lean = (simpleOn || simplePhone) && !advanced;");
    expect(view).toContain("const [advanced, setAdvanced] = useState(false);");
  });

  it("is remembered in this browser, every read and write in a try", () => {
    const write = between("  function setAdvancedOn(on: boolean) {", "\n  }\n");
    expect(write).toContain("setAdvanced(on);");
    expect(write).toMatch(/try \{\s*window\.localStorage\.setItem\("helios\.advanced", on \? "1" : "0"\);\s*\} catch/);
    // Read with the layout, in the same try, and set once the try is done.
    expect(view).toMatch(/try \{[^}]*adv = window\.localStorage\.getItem\("helios\.advanced"\) === "1";\s*\} catch \{[^}]*\}\s*setAdvanced\(adv\);/);
  });

  it("puts the hidden tools down on the way into lean: Select, Lit, no measure, nothing being laid", () => {
    const reset = between("  const [leanWas, setLeanWas] = useState(lean);", "  const eyelineRef");
    for (const line of ['setStageTool("select");', 'setViewMode("lit");', "setMeasurePts([]);", "setLaying(null);", "setRigOpen(false);"]) expect(reset, line).toContain(line);
    expect(reset).toContain("if (lean) {");
  });

  it("keeps the rail's and the view's keys for what is on screen, and C L M turn Advanced on", () => {
    const keys = between("    studioKeysRef.current = {", "\n    };\n");
    expect(keys).toContain("if (!lean) setViewMode(m);");
    expect(keys).toContain('if (lean && (id === "camera" || id === "light" || id === "mark")) setAdvancedOn(true);');
    expect(keys).toContain("if (!lean) setStageTool(id);");
    // And go to Shoot, where the camera department and the mark chip are drawn (review of Cut 3).
    expect(keys).toContain('if ((simpleOn || simplePhone) && (id === "camera" || id === "light" || id === "mark")) setSimpleStep("shoot");');
    // ⌘K's camera department turns it on too.
    expect(view).toMatch(/setRigOpen: \(open\) => \{[\s\S]{0,200}if \(open && lean\) setAdvancedOn\(true\);/);
  });
});

describe("the toggle", () => {
  it("sits in the bar wherever the new layout is drawn, pressed while on, with a dot while a hidden setting rides", () => {
    const toggle = between("{(simpleOn || simplePhone) && (", "</button>");
    expect(toggle).toContain("onClick={() => setAdvancedOn(!advanced)}");
    expect(toggle).toContain("aria-pressed={advanced}");
    expect(toggle).toContain("{sw.advanced}");
    expect(toggle).toContain("{lean && advancedInUse && (");
    expect(toggle).toContain('<span className="sr-only">{sw.advancedInUse}</span>');
    expect(toggle).toContain("h-1.5 w-1.5 rounded-full bg-[#e0a468]");
    // A glyph below 640 px, its word kept for screen readers, so a phone's bar fits with History and Download back (review of Cut 3).
    expect(toggle).toContain('<span className="sr-only sm:not-sr-only">{sw.advanced}</span>');
    expect(toggle).toContain('className="h-4 w-4 sm:hidden" aria-hidden');
    expect(toggle).toContain("title={sw.advanced}");
    // No aria-label, which would drop the dot's words from the button's name.
    expect(toggle).not.toContain("aria-label=");
    // Before History, in the bar's children.
    expect(view.indexOf("{(simpleOn || simplePhone) && (")).toBeLessThan(view.indexOf('onClick={() => toggleMenu("history")}'));
  });

  it("leaves History's number alone on a phone's bar in the new layout, and Classic's as it was", () => {
    const history = between('onClick={() => toggleMenu("history")}', "<Chevron />");
    expect(history).toContain("{simplePhone ? (");
    expect(history).toContain('<span className="tabular-nums sm:hidden">{frameNumber}</span>');
    expect(history).toContain("aria-label={`${s.historyLabel} · ${formatMsg(s.revisionN, { n: frameNumber })}`}");
  });

  it("says a hidden pose, gaze, picked look or rig setting is in force", () => {
    expect(view).toContain('const advancedInUse = pose !== "stand" || gaze !== null || lookPinned || rigAdvancedInUse(rig);');
  });
});

describe("what lean hides", () => {
  it("hides the bar's view modes, Find, History and Download; ⌘K and the viewer's Download stay", () => {
    expect(view).toContain("view={lean ? null : { mode: viewMode,");
    expect(view).toContain("find={lean ? null : { label: s.studio.find,");
    expect(view).toMatch(/\{!lean && \(\s*<div className="relative">\s*<button\s+type="button"\s+onClick=\{\(\) => toggleMenu\("history"\)\}/);
    expect(view).toMatch(/\{!lean && \(\s*<button\s+type="button"\s+onClick=\{viewingFile && viewingShot \?/);
    expect(view).toContain("data-shot-download");
  });

  it("hides the floating rail, the readout, the status bar", () => {
    expect(view).toContain("{simpleOn && advanced && !viewingShot && (");
    expect(view).toMatch(/\{!lean && \(\s*<div className="absolute -top-\[18px\]/);
    expect(view).toContain("{wide && !(simpleOn && !advanced) && (");
    // The status bar stays in the source for Classic and Advanced.
    expect(view).toContain("<StudioStatus>");
  });

  it("hides the sun, the gizmo and the scale by their class, never unmounting what the stage was handed", () => {
    expect(view).toContain('active:cursor-grabbing ${viewingShot || lean ? "hidden" : ""}');
    expect(view).toContain('md:flex ${viewingShot || lean ? "md:hidden" : ""}');
    // Still one element each, always rendered, handed to the stage once.
    for (const ref of ["ref={sunRef}", "ref={scaleRef}", "ref={gizmoRef}"]) expect(view.split(ref).length - 1, ref).toBe(1);
    const furniture = between("apiRef.current?.setFurniture({", "return () => apiRef.current?.setFurniture(null);");
    expect(furniture).toContain("sun: sunRef.current,");
    expect(furniture).toContain("gizmo: gizmoRef.current,");
  });

  it("shows the layout switch in the new layout only while Advanced is on, and in Classic to everyone offered it", () => {
    expect(view).toContain("{simpleLayout && wide3 && (!simple || advanced) && (");
    expect(view).toContain("{simpleLayout && !wide && (!simple || advanced) && (");
    // Its ochre look is its own, unchanged.
    expect(view).toContain(
      'className="flex h-8 flex-none cursor-pointer items-center whitespace-nowrap rounded-[6px] border border-[rgba(240,196,142,0.45)] px-2 text-xs font-semibold text-[#f0cda6] hover:bg-[rgba(224,164,104,0.1)] md:px-2.5"',
    );
  });

  it("moves the frame and the stage's banners clear of the rail only while it floats", () => {
    expect(view).toContain("insetsRef.current = { left: simpleOn && advanced ? 82 : 14, right: 14, top, bottom };");
    expect(view).toContain('const bannerLeft = simpleOn && advanced ? "left-[82px]" : "left-3.5";');
    // The take's banner, the scale warning, Match and the laying hint.
    expect(view.split("absolute ${bannerLeft} top-16").length - 1).toBe(3);
    expect(view).toContain("absolute ${bannerLeft} top-[116px]");
  });
});

// The controls Advanced hides, and one Shoot (Helios Cut 3, step 15b).
describe("the first Shoot screen", () => {
  const chips = () => between("  function setupChipsView(inPanel: boolean) {", "\n  const chatHeader = (");

  it("shows who and which camera in Shoot, and Undo after a move; Film's chips are unchanged", () => {
    expect(chips()).toContain('const leanChips = lean && studioMode === "shoot";');
    // The Who and Camera chips are drawn whatever the state.
    const who = chips().indexOf('onClick={() => toggleMenu("who")}');
    const camera = chips().indexOf('onClick={() => toggleMenu("camera")}');
    expect(who).toBeGreaterThan(-1);
    expect(camera).toBeGreaterThan(-1);
    // Look, then Rig through "Frame the figure", then Match and Compare, each behind the lean test.
    expect(chips()).toMatch(/\{!leanChips && \(\s*<div className=\{chipAnchor\}>\s*<button\s+type="button"\s+onClick=\{\(\) => toggleMenu\("look"\)\}/);
    const restAt = chips().indexOf("{!leanChips && (\n        <>");
    const restEnd = chips().indexOf("\n        </>\n        )}", restAt);
    expect(restAt).toBeGreaterThan(-1);
    expect(restEnd).toBeGreaterThan(restAt);
    const rest = chips().slice(restAt, restEnd);
    for (const hidden of ["{rigChipLabel}", 'toggleMenu("figure")', 'toggleMenu("pose")', 'toggleMenu("gaze")', "turn(-TURN_STEP)", "turn(TURN_STEP)", "{s.frameFigure}"]) {
      expect(rest, hidden).toContain(hidden);
    }
    expect(rest).not.toContain('toggleMenu("camera")');
    expect(chips()).toContain("{matchOn && !leanChips && (");
    expect(chips()).toContain("{sourcePhotoUrl && !leanChips && (");
    // Undo stays outside.
    expect(chips().indexOf("{stageUndoCount > 0 && (")).toBeGreaterThan(restEnd);
  });

  it("keeps the camera department in the Shoot panel for Advanced", () => {
    const panel = between("  function stepPanelView() {", "  function setupChipsView(");
    expect(panel).toMatch(/\{advanced && rigTab && \(\s*<div className="[^"]*" data-step-shoot-rig>\s*\{rigPanel\(rigTab\)\}/);
  });

  it("names the engine as text where its pill steps aside", () => {
    const panel = between("  function stepPanelView() {", "  function setupChipsView(");
    expect(panel).toContain("const engineLine = lean ? (");
    // With the next press's price, which the pill carried: a typed message that asks to shoot spends it.
    expect(panel).toContain("{formatMsg(s.panelMeta, { engine: stillEngineName })} · {nextPressPrice}");
    expect(panel.split("{engineLine}").length - 1).toBe(2);
    // A phone's conversation header says it too, lean only.
    expect(between("  const chatHeader = (", "  const chatThread = (")).toContain("{lean ? ` · ${nextPressPrice}` : null}");
    expect(view).toContain("{!justTalk && !lean && (");
    // The pill and its price stay in the source for Classic and Advanced.
    expect(view).toContain("{stillEngineName} · {credits}");
  });

  it("never hides the mode while a message can spend: only \"Ask before shooting\" steps aside", () => {
    expect(view).toContain("{!(lean && askFirst && !justTalk) && (");
    const mode = between("{!(lean && askFirst && !justTalk) && (", "</button>");
    expect(mode).toContain('onClick={() => toggleMenu("mode")}');
    expect(mode).toContain("{justTalk ? s.justTalking : askFirst ? s.askBeforeShooting : s.shootWithoutAsking}");
    // The @ chip is the Who chip's twin: lean, the Who chip is Shoot's.
    expect(view).toMatch(/\{!lean && \(\s*<button\s+type="button"\s+onClick=\{\(\) => setMentionForced/);
  });

  it("draws one Shoot: the priced send; the frame card keeps its facts, and the bar keeps Next: Shoot and Film's Render", () => {
    // The frame card's Shoot and Another angle.
    expect(view).toMatch(/\{!lean && \(\s*<div className="flex flex-wrap items-center gap-2 pt-1">\s*<button\s+type="button"\s+onClick=\{\(\) => void \(takeStart \? take\(\) : shoot\(\)\)\}/);
    // Its Cost row is outside the gate.
    const card = between("{rowLabel(s.rowWho, \"who\")}", "{!lean && (\n                        <div className=\"flex flex-wrap items-center gap-2 pt-1\">");
    expect(card).toContain('{lean && genericPress.kind === "take" ? nextPressPrice : formatMsg(s.costLine, { credits })}');
    // The bar: Film's Render and Set's Next: Shoot come first, then nothing while lean in Set or Shoot.
    const bar = view.slice(view.indexOf("        primary={"), view.indexOf("        }\n      >"));
    expect(bar.indexOf("simpleOn && filmOpen && !cutOpen ? (")).toBeLessThan(bar.indexOf(") : lean && simpleShooting ? null : ("));
    expect(bar.indexOf("simpleOn && simpleShooting && simpleStep === \"set\" && !takeStart ? (")).toBeLessThan(bar.indexOf(") : lean && simpleShooting ? null : ("));
    // The send refuses when the bar's Shoot would have.
    expect(view).toContain("(!draft.trim() && (justTalk || !canShootNow))");
  });

  it("waits for the first still before drawing the filmstrip, and the frame lines follow it", () => {
    expect(view).toContain("const stripShown = !filmOpen && !(lean && shots.length === 0);");
    expect(view).toContain("{stripShown && (\n          <div\n            ref={stripRef}");
    expect(view).toContain("simpleOn, simplePhoneSet, advanced, stripShown]);");
  });

  // Review of Cut 3 (money lens): lean, the bar and the frame card draw no
  // Take, and a typed message runs the person's armed take (pressShoot), so
  // every price on screen is the next press's, never a still's under a take.
  it("names the armed take's price wherever a lean page names a price", () => {
    expect(view).toContain(
      'const nextPressPrice = genericPress.kind === "take" ? formatMsg(s.takeButton, { n: genericPress.credits }) : credits;',
    );
    // The same answer the empty send's label and pressShoot read.
    expect(view.indexOf("const genericPress = pressFor(\"shoot\"")).toBeLessThan(view.indexOf("const nextPressPrice ="));
    // The take banner, lean only.
    expect(view).toMatch(/\{formatMsg\(s\.takeBanner, \{ n: takeStart\.n \}\)\}\s*\{lean && genericPress\.kind === "take" \? ` · \$\{nextPressPrice\}` : ""\}/);
    // The frame card's Cost row, lean only; Classic's card keeps its own Take button beside it.
    expect(view).toContain('{lean && genericPress.kind === "take" ? nextPressPrice : formatMsg(s.costLine, { credits })}');
    // No lean line is left saying the still's price by itself.
    expect(view).not.toContain("{lean ? ` · ${credits}` : null}");
  });

  it("says only what the Shoot step always shows", () => {
    for (const m of [en, es, pt, itMsgs]) {
      expect(m.sets.simple.shotHint).not.toMatch(/look|aspecto|visual|stile|where they stand|dónde está|onde está|dove sta/i);
    }
  });
});

describe("the rig in use", () => {
  it("is off on the default rig and a new set's, in every frame shape", () => {
    expect(rigAdvancedInUse(DEFAULT_SET_RIG)).toBe(false);
    expect(rigAdvancedInUse(NEW_SET_RIG)).toBe(false);
    for (const format of RIG_FORMAT_ORDER) expect(rigAdvancedInUse({ ...DEFAULT_SET_RIG, format }), format).toBe(false);
    // A stored rig with nothing set, or a new set's as stored, through the one door.
    expect(rigAdvancedInUse(normaliseSetRig(null))).toBe(false);
    expect(rigAdvancedInUse(normaliseSetRig({ format: "wide" }))).toBe(false);
  });

  it("is on for any other field set away from the default", () => {
    const d = DEFAULT_SET_RIG;
    const patches: Partial<typeof d>[] = [
      { lens: "anamorphic" },
      { stop: 2.8 },
      { stock: "film35" },
      { palette: "amber-hour" },
      { genre: "noir" },
      { era: "2000s" },
      { light: { scheme: "contre-jour", azimuthDeg: 30, elevationDeg: 20 } },
      { time: 17.5 },
      { ev: 1 },
      { iso: 800 },
      { squeeze: 2 },
      { gradeStage: false },
      { overlays: { ...d.overlays, thirds: true } },
    ];
    for (const patch of patches) {
      expect(rigAdvancedInUse({ ...d, ...patch }), JSON.stringify(patch)).toBe(true);
    }
  });

  it("stands on the default rig's light being none, which makes any light count", () => {
    expect(DEFAULT_SET_RIG.light).toBeNull();
  });
});

describe("the words", () => {
  it("are in all four languages", () => {
    for (const m of [en, es, pt, itMsgs]) {
      expect(m.sets.simple.advanced).toBeTruthy();
      expect(m.sets.simple.advancedInUse).toBeTruthy();
    }
    expect(en.sets.simple.advanced).toBe("Advanced");
  });
});
