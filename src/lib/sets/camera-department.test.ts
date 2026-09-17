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

describe("the squeeze on the projection", () => {
  it("follows every projection the person sees or shoots, and never the snapshot the matcher reads", () => {
    // Each updateProjectionMatrix() on the live camera, the frame's camera
    // and the rebuilt camera is followed by squeezeProjection(); the
    // snapshot's clone is the one projection left spherical, on purpose.
    const lines = view.split("\n");
    const updates = lines.map((l, i) => [l, i] as const).filter(([l]) => /\b(camera|cam)\.updateProjectionMatrix\(\)/.test(l));
    expect(updates.length).toBe(4);
    let squeezed = 0;
    let spherical = 0;
    for (const [, i] of updates) {
      // Within the next few lines: a comment may sit between the two.
      const next = lines.slice(i + 1, i + 7).join("\n");
      if (/squeezeProjection\(/.test(next)) squeezed += 1;
      else spherical += 1;
    }
    expect(squeezed).toBe(3);
    expect(spherical).toBe(1);
    const snapshotStart = view.indexOf("snapshot(px, opts) {");
    const snapshotEnd = view.indexOf("frameFigure() {", snapshotStart);
    expect(view.slice(snapshotStart, snapshotEnd)).not.toContain("squeezeProjection(");
  });
});
