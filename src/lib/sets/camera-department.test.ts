import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The camera department (canvas page J, cut 2, 2026-09-17), read as source:
// the lens rule on the pages always reads the rig's sensor, and every
// projection the person sees or shoots carries the rig's squeeze. A call
// that forgot the sensor would show a full-frame lens on a Super 35 rig;
// a projection that forgot the squeeze would show a spherical frame on an
// anamorphic one — both quietly, both in the sketch the model is shown.

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const view = read("../../components/sets/set-view.tsx");
const panel = read("../../components/sets/rig-panel.tsx");
const overlay = read("./film-overlay.ts");

/** The argument list of every call of `name(` in `source`, split at depth 0. */
function calls(source: string, name: string): string[][] {
  const out: string[][] = [];
  let from = 0;
  for (;;) {
    const i = source.indexOf(`${name}(`, from);
    if (i < 0) break;
    const before = source[i - 1] ?? "";
    from = i + name.length + 1;
    if (/[\w$.]/.test(before)) continue; // a longer name, or a method
    let depth = 0;
    let arg = "";
    const args: string[] = [];
    for (let j = from; j < source.length; j++) {
      const c = source[j];
      if (c === "(" || c === "[" || c === "{") depth++;
      if (c === ")" || c === "]" || c === "}") {
        if (depth === 0) {
          if (arg.trim()) args.push(arg.trim());
          break;
        }
        depth--;
      }
      if (c === "," && depth === 0) {
        args.push(arg.trim());
        arg = "";
        continue;
      }
      arg += c;
    }
    out.push(args);
  }
  return out;
}

describe("the lens rule on the pages", () => {
  it("always reads the rig's sensor", () => {
    for (const [file, source] of [
      ["set-view.tsx", view],
      ["rig-panel.tsx", panel],
      ["film-overlay.ts", overlay],
      // The timeline and the words reader were outside this scan, and both
      // named another lens than the stage did (2026-09-17).
      ["sequencer.ts", read("sequencer.ts")],
      ["sequencer.tsx", read("../../components/sets/sequencer.tsx")],
      ["shot-words.ts", read("shot-words.ts")],
    ] as const) {
      for (const name of ["nearestLens", "fovForLens", "lensForFov", "focalMm"]) {
        for (const args of calls(source, name)) {
          expect(args.length, `${file}: ${name}(${args.join(", ")})`).toBe(2);
          expect(args[1], `${file}: ${name}(${args.join(", ")})`).toMatch(/sensor/i);
        }
      }
    }
  });

  it("judges sharpness by the sensor's circle wherever the depth of field is worked out", () => {
    for (const [file, source] of [
      ["set-view.tsx", view],
      ["rig-panel.tsx", panel],
    ] as const) {
      const found = calls(source, "depthOfField");
      expect(found.length, file).toBeGreaterThan(0);
      for (const args of found) expect(args[3], `${file}: depthOfField(${args.join(", ")})`).toMatch(/sensorCocMm|coc/);
    }
  });
});

describe("the squeeze on the frame", () => {
  it("widens the negative and the band, and squashes nothing", () => {
    // It used to be a scale on the projection's x: the picture model was
    // handed the negative, squashed, never desqueezed — thin people in a
    // narrow world — while the band, the words and the look cutout knew
    // nothing of it (found reviewing Helios, fixed 2026-09-18).
    expect(view).not.toContain("squeezeProjection");
    expect(read("build-scene.ts")).not.toContain("squeezeProjection");
    // Every frame the page works out is the rig's, squeeze and all.
    for (const args of calls(view, "formatFrame")) {
      expect(args.length, `set-view.tsx: formatFrame(${args.join(", ")})`).toBe(2);
      expect(args[1], `set-view.tsx: formatFrame(${args.join(", ")})`).toMatch(/squeeze/i);
    }
    expect(view).toContain("camera.fov = widenFovDeg(poseFov, (fullH / Math.max(1, renderPx)) * rigRef.current.squeeze);");
    expect(view).toContain("const from = { ...pose, fovDeg: widenFovDeg(pose.fovDeg, rigRef.current.squeeze) };");
    // The snapshot stays spherical: the matcher and the compare read it.
    const from = view.indexOf("snapshot(px, opts) {");
    expect(view.slice(from, view.indexOf("frameFigure() {", from))).not.toContain("squeeze");
    // And the band's share of the pose's field is the frame's own number,
    // never bandH / renderH written out again beside a squeeze it forgot.
    expect(view).not.toMatch(/bandH \/ \w+\.renderH/);
  });

  it("rides to the server, which works the cut out from the two names alone", () => {
    const actions = read("actions.ts");
    const lane = read("../generations/actions.ts");
    expect(actions).toContain("const rigFrame = formatFrame(rig.format, rig.squeeze);");
    expect(actions).toContain('fd.set("set_squeeze", String(rig.squeeze));');
    // And onto the stored camera, or a squeezed still's look boxes are
    // measured with the pose's own lens on a band the squeeze widened.
    expect(actions).toContain("band: rigFrame.bandAspect, squeeze: rigFrame.squeeze }");
    expect(lane).toContain("const setFrame = formatFrame(setFormat, setSqueeze);");
    expect(lane).toContain("isRigSqueeze(squeezeSent) ? squeezeSent : 1");
  });
});
