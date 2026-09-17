import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The people on the set page (cut D), read as source: the gaze chip beside
// the pose, the eye-line drawn from the eyes, the beat's path laid on the
// ground and walked by the previz, and the words that ride the still and
// the take.

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const seq = readFileSync(join(__dirname, "../../components/sets/sequencer.tsx"), "utf8");
const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
const prompt = readFileSync(join(__dirname, "set-shot-prompt.ts"), "utf8");

describe("the eye-line", () => {
  it("is a chip beside the pose, saved with the arrangement, and a line the loop draws from the eyes", () => {
    expect(view).toContain('toggleMenu("gaze")');
    expect(view.indexOf("data-gaze-chip")).toBeGreaterThan(view.indexOf('toggleMenu("pose")'));
    expect(view).toContain("layoutRef.current = { ...layoutRef.current, gaze };");
    expect(view).toContain("gaze: initialLayout?.gaze ?? null");
    const loop = view.slice(view.indexOf("// The eye-line (cut D): from the eyes to what the figure looks at."), view.indexOf("// The measure line, between the points on the ground."));
    expect(loop).toContain("const eye = project(ptV.set(p.x, eyeY(), p.z));");
    expect(loop).toContain('if (target === "camera") {');
    expect(view).toContain("data-eyeline");
  });

  it("rides the still from the saved arrangement and the take from the beat, in Picacho's words, stripped before the brand check", () => {
    expect(actions).toContain("gaze: layout ? gazeWords(layout.gaze, owned.spec, layout.mark) : \"\",");
    expect(actions).toContain('gaze: gazeWords(normaliseGaze(input.gaze, owned.spec.objects.length), owned.spec, endMark, "take"),');
    expect(view).toContain("gaze: beat.gaze,");
    expect(prompt).toContain("input.gaze ?? \"\",");
    expect(prompt).toContain("(?:By the end of the shot they|They) look ");
  });
});

describe("the path", () => {
  it("is laid on the ground from the Film tab, at most six points, and cleared in one press", () => {
    expect(view).toContain('const laying = layingRef.current;');
    expect(view).toContain('layAddRef.current(laying, { x: Math.round(hit.x * 100) / 100, z: Math.round(hit.z * 100) / 100 });');
    expect(view).toContain("bb.path.length < PATH_MAX_POINTS");
    expect(view).toContain("data-path-row");
    expect(view).toContain("{ ...bb, path: [] }");
    // Escape ends the laying as it clears the measure.
    expect(view).toContain("setMeasurePts([]);\n        setLaying(null);");
  });

  it("is what the previz walks, facing the way it goes, and what the loop draws for the beat in hand", () => {
    expect(view).toContain("const at = alongPath(walkFrom, beat.path, to, e);");
    expect(view).toContain("facingDeg: e >= 0.97 || at.facingDeg === null ? to.facingDeg : at.facingDeg");
    expect(view).toContain("const stops = [f.pathFrom, ...f.pathPoints, f.pathTo];");
    expect(view).toContain("data-path");
  });

  it("is said on the sequencer's figure bar, with the eye-line", () => {
    expect(seq).toContain("figureNote?(index: number): string;");
    expect(seq).toContain("{p.figureNote?.(sp.index) ?? \"\"}");
    expect(view).toContain("figureNote={(i) => {");
    expect(view).toContain("formatMsg(s.studio.pathWalks, { d: pathLength(from, b.path, b.figure), n: b.path.length })");
  });
});
