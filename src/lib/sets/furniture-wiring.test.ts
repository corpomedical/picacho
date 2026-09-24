import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The viewport's furniture and the Cut mode on the set page (cut C), read
// as source: the sun, the bracket, the gizmo, the scale and the measure
// line are elements the loop moves; a dragged sun sets the rig's hour;
// Measure works on both pages; the Cut mode lays the clips under the
// viewport; the rack rides into the take's words.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const editor = readFileSync(join(__dirname, "../../components/sets/set-editor.tsx"), "utf8");
const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
const panel = readFileSync(join(__dirname, "../../components/sets/rig-panel.tsx"), "utf8");

describe("the viewport's furniture", () => {
  it("draws the sun where it stands, from the rig's hour or the set's own sun, and hides it below the horizon", () => {
    const loop = view.slice(view.indexOf("// The viewport's furniture (cut C, furniture.ts): moved every other frame."), view.indexOf("// One lift for the whole set"));
    expect(loop).toContain("if (hour !== null) dir = sunDirection(hour);");
    expect(loop).toContain('const sunL = spec.lights.find((l) => l.kind === "sun");');
    expect(loop).toContain("if (!dir || dir[1] <= 0) f.sun.hidden = true;");
    // Out of the frame it sits at the edge, still in hand; behind the camera it is not drawn.
    expect(loop).toContain("const off = sp.behind;");
    expect(loop).toContain("const x = Math.min(lastW - 28, Math.max(28, sp.x));");
    expect(loop).toContain("f.sunWords(hour, el)");
  });

  it("sets the rig's hour from a dragged sun, through the ray under the pointer", () => {
    expect(view).toContain("sunHourAt(clientX, clientY) {");
    expect(view).toContain("return hourFromAzimuth(azimuthOf(d.x, d.z));");
    expect(view).toContain("setRig((r) => (r.time === h ? r : { ...r, time: h }))");
    expect(view).toContain("e.currentTarget.setPointerCapture(e.pointerId);");
  });

  it("brackets the eyes only with a stop set, sizes the scale to the figure's depth, and turns the gizmo with the camera", () => {
    const loop = view.slice(view.indexOf("// The viewport's furniture (cut C, furniture.ts): moved every other frame."), view.indexOf("// One lift for the whole set"));
    expect(loop).toContain("if (depthStop === null) f.bracket.hidden = true;");
    expect(loop).toContain("const pxPerMetre = lastH / (2 * dist * Math.tan((camera.fov * Math.PI) / 360));");
    expect(loop).toContain("const bar = scaleBar(pxPerMetre);");
    expect(loop).toContain("axisV.set(ax, ay, az).applyQuaternion(q);");
    for (const marker of ["data-sun", "data-bracket", "data-measure", "data-gizmo", "data-scale"]) expect(view).toContain(marker);
  });

  it("measures on both pages: a press on the ground is a point, two make the line, Escape clears it", () => {
    expect(view).toContain('if (tool === "measure") {');
    expect(view).toContain("measureAddRef.current({ x: Math.round(hit.x * 100) / 100, z: Math.round(hit.z * 100) / 100 });");
    expect(view).toContain("escape: () => {\n        setMeasurePts([]);");
    expect(editor).toContain('if (toolRef.current === "measure") {');
    expect(editor).toContain("measureAddRef.current({ x: Math.round(groundHit.x * 100) / 100, z: Math.round(groundHit.z * 100) / 100 });");
    expect(editor).toContain("setMeasurePts([]);");
    expect(editor).toContain('nextTool === "select" || nextTool === "measure"');
    expect(editor).toContain("drawMeasure();");
  });
});

describe("the Cut mode", () => {
  it("is the fourth mode, lays the clips under the viewport and plays a rendered one from its tile", () => {
    expect(view).toContain('const studioMode: StudioMode = cutOpen ? "cut" : filmOpen ? "film" : "shoot";');
    expect(view).toContain("{cutOpen && (\n          <div data-cut");
    // A measuring press never orbits: the controls sit it out and the pointer is held.
    expect(view).toContain("measuring = true;");
    expect(view).toContain("if (controlsRef) controlsRef.enabled = false;");
    expect(view).toContain('data-cut-clip={done ? "done" : clip ? clip.status : "missing"}');
    expect(view).toContain("initialCutOpen");
    expect(readFileSync(join(__dirname, "../../app/app/sets/[id]/page.tsx"), "utf8")).toContain('initialCutOpen={first(query.cut) === "1"}');
  });
});

describe("the blades and the rack", () => {
  it("offer the blades in the Camera tab's Focus section, with a stop set", () => {
    const focus = panel.slice(panel.indexOf('title={r.focus} hidden={!show("focus")}'), panel.indexOf('title={r.exposure} hidden={!show("exposure")}'));
    expect(focus).toContain("{RIG_BLADES.map((n) => (");
    expect(focus).toContain('set({ blades: n })');
    expect(focus.indexOf("RIG_BLADES")).toBeGreaterThan(focus.indexOf("<DofBar"));
  });

  it("carry a beat's rack into the take's words, read against the set on the server", () => {
    expect(view).toContain("rack: beat.rack,");
    // Against the set as the beat ENDS: a thing that drove away stands somewhere else (movers.ts).
    expect(actions).toContain("rack: rackWords(normaliseRack(input.rack, owned.spec.objects.length), endShown),");
    const film = view.slice(view.indexOf("  function filmBeatView() {"), view.indexOf("  /**\n   * The new layout's right-hand panel, one per step"));
    expect(film).toContain('<option value="figure">{s.studio.rackFigure}</option>');
    expect(film).toContain("{names.objectName(o)}");
  });
});
