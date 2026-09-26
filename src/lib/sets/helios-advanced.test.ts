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
    // Before History, in the bar's children.
    expect(view.indexOf("{(simpleOn || simplePhone) && (")).toBeLessThan(view.indexOf('onClick={() => toggleMenu("history")}'));
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
