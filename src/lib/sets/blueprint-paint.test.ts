import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAINT_DIRS, PAINT_FRAGMENT_BODY, dihedral, dihedralMatrix, matchScore, planPaint, sideExtent, type Grid, type PaintDir } from "./blueprint-paint";


// A thing's own drawings painted onto its model (2026-09-24): which drawing
// paints which side, found by matching each against the model's own sides.
// A made-up car here; the operator's real sheet and model were matched in
// the browser (front, back, both sides and the top — never the floor).

type Paint = (x: number, y: number, w: number, h: number) => [number, number, number] | null;
function grid(w: number, h: number, paint: Paint): Grid {
  const mask = new Uint8Array(w * h);
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = paint(x, y, w, h);
      if (!c) continue;
      const p = y * w + x;
      mask[p] = 1;
      rgb.set(c, p * 3);
    }
  return { w, h, mask, rgb };
}
const YELLOW: [number, number, number] = [240, 200, 40];
const RED: [number, number, number] = [200, 30, 30];
const WHITE: [number, number, number] = [245, 245, 245];
const DARK: [number, number, number] = [40, 40, 40];

// Side, nose on the left: low at the nose, the roof towards the back.
const side = grid(64, 17, (x, y, w, h) => (y >= h - 1 - Math.round(((h - 1) * (0.35 + (0.65 * x) / w)) ) ? YELLOW : null));
// Top: a long rounded plan.
const top = grid(64, 32, (x, y, w, h) => ((x - w / 2) ** 2 / (w / 2) ** 2 + (y - h / 2) ** 2 / (h / 2) ** 2 <= 1.05 ? YELLOW : null));
// Ends: the same box; the back has a red bar, the front two white lamps.
const endShape = (lamps: (x: number, y: number, w: number, h: number) => boolean, lamp: [number, number, number]) =>
  grid(40, 21, (x, y, w, h) => (y < 3 && (x < 6 || x > w - 7) ? null : lamps(x, y, w, h) ? lamp : YELLOW));
const back = endShape((x, y, w, h) => y > h * 0.35 && y < h * 0.5 && x > 4 && x < w - 5, RED);
const front = endShape((x, y, w, h) => y > h * 0.35 && y < h * 0.55 && (x < 12 || x > w - 13) && x > 3 && x < w - 4, WHITE);

// The model's own sides, as the stage renders them: the drawings turned the way each side is seen.
const renders = new Map<PaintDir, Grid>([
  ["+x", side],
  ["-x", dihedral(side, 2)],
  ["+y", dihedral(top, 1)],
  ["-y", { ...dihedral(top, 1), rgb: dihedral(top, 1).rgb.map((_, i) => DARK[i % 3]) }],
  ["+z", front],
  ["-z", dihedral(back, 2)],
]);

describe("which drawing paints which side", () => {
  it("puts the side view on both sides, the top on the top only, the front on the front and the back on the back", () => {
    const plan = planPaint([top, side, front, back], renders);
    const at = Object.fromEntries(plan.map((p) => [p.dir, p.drawing]));
    expect(at).toEqual({ "+x": 1, "-x": 1, "+y": 0, "+z": 2, "-z": 3 });
    // Never the floor: the top's outline fits it, its colours do not.
    expect(at["-y"]).toBeUndefined();
  });

  it("tells the front from the back by colour when the outlines are the same", () => {
    const plan = planPaint([back, front], new Map([["+z", front], ["-z", dihedral(back, 2)]] as [PaintDir, Grid][]));
    expect(plan.find((p) => p.dir === "+z")?.drawing).toBe(1);
    expect(plan.find((p) => p.dir === "-z")?.drawing).toBe(0);
  });

  it("paints nothing from a picture that fits no side — an ordinary photo in perspective", () => {
    const photo = grid(64, 48, (x, y) => ((x * 7 + y * 13) % 5 === 0 ? DARK : null));
    expect(planPaint([photo], renders)).toEqual([]);
  });

  it("finds the drawing turned the way the side is seen", () => {
    const m = matchScore(top, renders.get("+y")!);
    expect(m?.iou).toBeGreaterThan(0.95);
    expect(dihedral(top, m!.t).w).toBe(renders.get("+y")!.w);
  });
});

describe("the canvas turns a drawing exactly as the matcher did", () => {
  it("maps every corner of the picture where dihedral() puts it", () => {
    const w = 5;
    const h = 3;
    for (let t = 0; t < 8; t++) {
      const m = dihedralMatrix(t, w, h);
      const g = dihedral({ w, h, mask: new Uint8Array(w * h), rgb: new Uint8Array(w * h * 3) }, t);
      expect([m.w, m.h]).toEqual([g.w, g.h]);
      for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
        // A pixel's middle through the canvas transform lands in the middle of the pixel dihedral() writes.
        const cx = m.a * (x + 0.5) + m.c * (y + 0.5) + m.e;
        const cy = m.b * (x + 0.5) + m.d * (y + 0.5) + m.f;
        const one = { w, h, mask: new Uint8Array(w * h), rgb: new Uint8Array(w * h * 3) };
        one.mask[y * w + x] = 1;
        const moved = dihedral(one, t);
        const at = moved.mask.indexOf(1);
        expect([Math.floor(cx), Math.floor(cy)], `t=${t} (${x},${y})`).toEqual([at % moved.w, Math.floor(at / moved.w)]);
      }
    }
  });
});

describe("the six sides", () => {
  it("each read the model's box along its own two axes, the picture's right being forward × up", () => {
    for (const d of PAINT_DIRS) {
      const f = d.normal.map((v) => -v);
      const right = [f[1] * d.up[2] - f[2] * d.up[1], f[2] * d.up[0] - f[0] * d.up[2], f[0] * d.up[1] - f[1] * d.up[0]];
      expect(right[d.u.axis], d.dir).toBe(d.u.sign);
      expect(d.up[d.v.axis], d.dir).toBe(d.v.sign);
    }
    expect(sideExtent("+x", [0.5, 0.27, 1])).toEqual([1, 0.27]);
    expect(sideExtent("+y", [0.5, 0.27, 1])).toEqual([0.5, 1]);
  });

  it("keep the model's own paint wherever no drawing covers it", () => {
    expect(PAINT_FRAGMENT_BODY).toContain("diffuseColor.rgb = (acc + (total - cover) * own) / total;");
    expect(PAINT_FRAGMENT_BODY.match(/uPaintHave\[\d\]/g)).toHaveLength(6);
  });
});

describe("the stage", () => {
  const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
  const stage = readFileSync(join(__dirname, "../../components/sets/blueprint-stage.ts"), "utf8");

  it("paints every model from its thing's photos, the stage's paint and the sketch's both", () => {
    expect(view).toContain("painted = await paintFromDrawings(THREE, renderer, model, m.drawings);");
    expect(view).toContain("drawings: drawingsFor(key)");
    expect(stage).toContain('const sketch = mesh.userData[sketchKey] as ThreeNS.Material | undefined;');
    expect(stage).toContain("if (sketch) mesh.userData[sketchKey] = teach(sketch, toModel);");
    // A new photo repaints the model.
    expect(view).toContain("drawingsOf(w) !== skin.drawings");
  });

  it("never sends the browser to sharp: the finding rules come from their own module", () => {
    expect(stage).toContain('from "@/lib/sets/thing-views-find"');
    expect(readFileSync(join(__dirname, "thing-views-find.ts"), "utf8")).not.toMatch(/import\(\s*"sharp"|from "sharp"/);
  });
});
