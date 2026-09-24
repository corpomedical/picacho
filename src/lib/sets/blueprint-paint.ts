// A thing's own drawings painted onto its 3D model (2026-09-24, "The tail
// lights came out different from the image provided and the image
// generated with the 3d model" — "build it, and make it as a permanent fix
// for new renders. It should apply for all objects. We are seeking
// perfection").
//
// TRELLIS.2 builds a model's SHAPE from the photos well — the operator's car
// matched his drawing's proportions to 3–4 % — but it invents the fine
// detail: his full-width tail-light bar came back as two red dots, his
// spoked rims as black discs, his lemon paint as gold. A drawing seen
// straight on (a blueprint sheet's side, top, front, back, or a product shot
// on a plain ground) IS what that side of the thing looks like, so it is
// painted onto the side of the model it shows: projected straight along
// that axis, inside the model's own box. Proved free on his model first: the
// light bar, the four exhausts, the plate, the rims and the yellow all came
// back.
//
// WHICH DRAWING IS WHICH SIDE. Nothing is labelled: each drawing is matched
// against the model itself, seen straight on from its six sides in its own
// paint. A drawing's silhouette must fit a side's silhouette (overlap and
// shape), in one of the eight ways a picture can be turned or mirrored; its
// colours break the ties the silhouette cannot (a car's front and back have
// the same outline, not the same lamps). A drawing that fits no side well —
// an ordinary photo in perspective — paints nothing, and the model keeps
// TRELLIS's own paint there.
//
// Pure and relative-import only: the matching is tested without a browser;
// the stage renders the sides and paints (components/sets/blueprint-stage.ts).

import type { Vec3 } from "./set-spec";

export type PaintDir = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";
type AxisMap = { axis: 0 | 1 | 2; sign: 1 | -1 };

/**
 * The six straight-on views of a model, in its own frame. A camera stands on
 * the `normal` side looking back at the model with `up` as its up; the
 * picture's right is forward × up. `u` and `v` say which of the model's axes
 * runs along the picture's width (left → right) and height (bottom → top),
 * and which way: u = sign > 0 ? q[axis] : 1 − q[axis], q being the point's
 * place in the model's box, 0 to 1.
 */
export const PAINT_DIRS: readonly { dir: PaintDir; normal: Vec3; up: Vec3; u: AxisMap; v: AxisMap }[] = [
  { dir: "+x", normal: [1, 0, 0], up: [0, 1, 0], u: { axis: 2, sign: -1 }, v: { axis: 1, sign: 1 } },
  { dir: "-x", normal: [-1, 0, 0], up: [0, 1, 0], u: { axis: 2, sign: 1 }, v: { axis: 1, sign: 1 } },
  { dir: "+y", normal: [0, 1, 0], up: [0, 0, -1], u: { axis: 0, sign: 1 }, v: { axis: 2, sign: -1 } },
  { dir: "-y", normal: [0, -1, 0], up: [0, 0, 1], u: { axis: 0, sign: 1 }, v: { axis: 2, sign: 1 } },
  { dir: "+z", normal: [0, 0, 1], up: [0, 1, 0], u: { axis: 0, sign: 1 }, v: { axis: 1, sign: 1 } },
  { dir: "-z", normal: [0, 0, -1], up: [0, 1, 0], u: { axis: 0, sign: -1 }, v: { axis: 1, sign: 1 } },
];

/** A picture reduced for matching: `mask` 1 where the thing is, `rgb` its colour (sRGB, 0–255), rows top to bottom. */
export type Grid = { w: number; h: number; mask: Uint8Array; rgb: Uint8Array };

/** The side of the model seen from `dir`, as the picture's width and height, from the model's box size. */
export function sideExtent(dir: PaintDir, size: Vec3): [number, number] {
  const d = PAINT_DIRS.find((x) => x.dir === dir)!;
  return [size[d.u.axis], size[d.v.axis]];
}

/** Longest side of a matching grid, pixels. */
export const GRID_PX = 64;
/** A drawing paints a side only this well matched: its silhouette overlaps the side's this much… */
export const PAINT_MIN_IOU = 0.72;
/** …and its proportions are this close (|ln| of the aspect ratios: 0.15 ≈ 16 %). */
export const PAINT_MAX_ASPECT = 0.15;
/** One drawing painting both of an axis's sides (a car's left and right) only when it fits the second nearly as well… */
export const PAINT_REUSE_MARGIN = 0.08;
/**
 * …and its colours agree there as well as they do on its own side. A top
 * view fits a car's underside in outline, not in colour (measured on the
 * operator's car, 2026-09-24: top 0.810, underside 0.664; left 0.789, right
 * 0.790), and must not paint windows under the floor.
 */
export const PAINT_REUSE_COLOUR = 0.05;

/**
 * One of the eight ways to turn or mirror a picture: bit 1 swaps its axes,
 * bit 2 mirrors it left–right, bit 4 top–bottom, in that order. The canvas
 * that paints the model applies the same (blueprint-stage.ts dihedralMatrix).
 */
export function dihedral(g: Grid, t: number): Grid {
  const swap = (t & 1) !== 0;
  const fx = (t & 2) !== 0;
  const fy = (t & 4) !== 0;
  const w = swap ? g.h : g.w;
  const h = swap ? g.w : g.h;
  const mask = new Uint8Array(w * h);
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      let x1 = swap ? y : x;
      let y1 = swap ? x : y;
      if (fx) x1 = w - 1 - x1;
      if (fy) y1 = h - 1 - y1;
      const i = y * g.w + x;
      const o = y1 * w + x1;
      mask[o] = g.mask[i];
      rgb[o * 3] = g.rgb[i * 3];
      rgb[o * 3 + 1] = g.rgb[i * 3 + 1];
      rgb[o * 3 + 2] = g.rgb[i * 3 + 2];
    }
  }
  return { w, h, mask, rgb };
}

/** Nearest-pixel resize. */
export function resample(g: Grid, w: number, h: number): Grid {
  const mask = new Uint8Array(w * h);
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(g.h - 1, Math.floor(((y + 0.5) * g.h) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(g.w - 1, Math.floor(((x + 0.5) * g.w) / w));
      const i = sy * g.w + sx;
      const o = y * w + x;
      mask[o] = g.mask[i];
      rgb[o * 3] = g.rgb[i * 3];
      rgb[o * 3 + 1] = g.rgb[i * 3 + 1];
      rgb[o * 3 + 2] = g.rgb[i * 3 + 2];
    }
  }
  return { w, h, mask, rgb };
}

/** The canvas transform that turns a w × h picture the way blueprint-paint.ts dihedral() turns a grid. */
export function dihedralMatrix(t: number, w: number, h: number): { a: number; b: number; c: number; d: number; e: number; f: number; w: number; h: number } {
  const swap = (t & 1) !== 0;
  const W = swap ? h : w;
  const H = swap ? w : h;
  let [a, b, c, d, e, f] = swap ? [0, 1, 1, 0, 0, 0] : [1, 0, 0, 1, 0, 0];
  if (t & 2) [a, c, e] = [-a, -c, W - e];
  if (t & 4) [b, d, f] = [-b, -d, H - f];
  return { a, b, c, d, e, f, w: W, h: H };
}

export type Match = { t: number; iou: number; aspect: number; colour: number; total: number };

/**
 * How well a drawing is the side a render shows, turned the best of the
 * eight ways: the silhouettes' overlap once the drawing is brought to the
 * render's size, less how far its proportions are off, plus how alike the
 * colours are where both are the thing (breaking a silhouette's ties).
 */
export function matchScore(drawing: Grid, render: Grid): Match | null {
  let best: Match | null = null;
  const renderAspect = render.w / render.h;
  for (let t = 0; t < 8; t++) {
    const turned = dihedral(drawing, t);
    const aspect = Math.abs(Math.log(turned.w / turned.h / renderAspect));
    if (aspect > PAINT_MAX_ASPECT * 2) continue;
    const d = resample(turned, render.w, render.h);
    let both = 0;
    let either = 0;
    let diff = 0;
    for (let p = 0; p < d.mask.length; p++) {
      const a = d.mask[p];
      const b = render.mask[p];
      if (a || b) either++;
      if (a && b) {
        both++;
        diff +=
          (Math.abs(d.rgb[p * 3] - render.rgb[p * 3]) + Math.abs(d.rgb[p * 3 + 1] - render.rgb[p * 3 + 1]) + Math.abs(d.rgb[p * 3 + 2] - render.rgb[p * 3 + 2])) /
          (3 * 255);
      }
    }
    if (!either) continue;
    const iou = both / either;
    const colour = both ? 1 - diff / both : 0;
    const total = iou - aspect + 0.3 * colour;
    if (!best || total > best.total) best = { t, iou, aspect, colour, total };
  }
  return best;
}

export type PaintPlan = { dir: PaintDir; drawing: number; t: number; total: number }[];

const accepted = (m: Match | null): m is Match => m !== null && m.iou >= PAINT_MIN_IOU && m.aspect <= PAINT_MAX_ASPECT;
const axisOf = (dir: PaintDir) => dir[1] as "x" | "y" | "z";
const opposite = (dir: PaintDir): PaintDir => ((dir[0] === "+" ? "-" : "+") + dir[1]) as PaintDir;

/**
 * Which drawing paints which side. Each drawing belongs to the axis of the
 * side it fits best, so a top view never paints a door. Along one axis, two
 * drawings that both fit are paired the way that fits best together (a
 * front and a back, told apart by their colours); one drawing alone paints
 * the side it fits, and the opposite side too only when it fits that one
 * nearly as well, colours and all — a car's left and right, not its front
 * and back, nor its top and its floor.
 */
export function planPaint(drawings: readonly Grid[], renders: ReadonlyMap<PaintDir, Grid>): PaintPlan {
  const scores = drawings.map((g) => new Map<PaintDir, Match>([...renders].flatMap(([dir, r]) => {
    const m = matchScore(g, r);
    return accepted(m) ? [[dir, m] as [PaintDir, Match]] : [];
  })));
  const home = scores.map((s) => {
    let best: PaintDir | null = null;
    for (const [dir, m] of s) if (!best || m.total > s.get(best)!.total) best = dir;
    return best;
  });
  const plan: PaintPlan = [];
  for (const axis of ["x", "y", "z"] as const) {
    const pos = `+${axis}` as PaintDir;
    const neg = `-${axis}` as PaintDir;
    const mine = drawings.map((_, i) => i).filter((i) => home[i] !== null && axisOf(home[i]!) === axis);
    if (mine.length === 0) continue;
    // Two or more: the best pairing of two different drawings, one to each side.
    let pair: { a: number; b: number; sum: number } | null = null;
    for (const a of mine) {
      for (const b of mine) {
        if (a === b) continue;
        const ma = scores[a].get(pos);
        const mb = scores[b].get(neg);
        if (!ma || !mb) continue;
        const sum = ma.total + mb.total;
        if (!pair || sum > pair.sum) pair = { a, b, sum };
      }
    }
    if (pair) {
      plan.push({ dir: pos, drawing: pair.a, t: scores[pair.a].get(pos)!.t, total: scores[pair.a].get(pos)!.total });
      plan.push({ dir: neg, drawing: pair.b, t: scores[pair.b].get(neg)!.t, total: scores[pair.b].get(neg)!.total });
      continue;
    }
    // One: the best-fitting drawing on its side, and on the opposite side only when it fits that as well.
    const one = mine.reduce((a, b) => (scores[b].get(home[b]!)!.total > scores[a].get(home[a]!)!.total ? b : a));
    const side = home[one]!;
    const m = scores[one].get(side)!;
    plan.push({ dir: side, drawing: one, t: m.t, total: m.total });
    const other = scores[one].get(opposite(side));
    if (other && other.total >= m.total - PAINT_REUSE_MARGIN && other.colour >= m.colour - PAINT_REUSE_COLOUR) plan.push({ dir: opposite(side), drawing: one, t: other.t, total: other.total });
  }
  return plan;
}

/** Tiles in the paint atlas: three across, two down, one per side in PAINT_DIRS order. */
export const ATLAS_COLS = 3;
export const ATLAS_ROWS = 2;
/** One tile's side, pixels: 768 keeps a car's lamps sharp and six tiles within a phone's texture budget. */
export const ATLAS_TILE = 768;

/** The shader lines that paint a model from the atlas (blueprint-stage.ts patches them into its materials). */
export const PAINT_VERTEX_HEAD = "uniform mat4 uPaintToModel;\nvarying vec3 vPaintPos;\nvarying vec3 vPaintN;";
export const PAINT_VERTEX_BODY = "vPaintPos = (uPaintToModel * vec4(transformed, 1.0)).xyz;\nvPaintN = normalize(mat3(uPaintToModel) * objectNormal);";

function sideUv(d: (typeof PAINT_DIRS)[number]): string {
  const c = ["q.x", "q.y", "q.z"];
  const along = (m: AxisMap) => (m.sign > 0 ? c[m.axis] : `1.0 - ${c[m.axis]}`);
  return `vec2(${along(d.u)}, ${along(d.v)})`;
}

export const PAINT_FRAGMENT_HEAD = [
  "uniform sampler2D uPaintAtlas;",
  "uniform vec3 uPaintMin;",
  "uniform vec3 uPaintMax;",
  "uniform float uPaintHave[6];",
  "varying vec3 vPaintPos;",
  "varying vec3 vPaintN;",
  // A side's own point in the atlas: tile i at column i % 3, row i / 3, rows counted from the top.
  `vec4 paintTile(int i, vec2 uv) {`,
  `  float col = mod(float(i), ${ATLAS_COLS}.0);`,
  `  float row = floor(float(i) / ${ATLAS_COLS}.0);`,
  `  uv = clamp(uv, 0.002, 0.998);`,
  `  return texture2D(uPaintAtlas, vec2((col + uv.x) / ${ATLAS_COLS}.0, 1.0 - (row + 1.0 - uv.y) / ${ATLAS_ROWS}.0));`,
  `}`,
].join("\n");

/**
 * After the model's own paint is read: every side facing this point adds its
 * drawing where the drawing shows the thing, weighted by how squarely the
 * surface faces that side; whatever is left keeps the model's own paint.
 */
export const PAINT_FRAGMENT_BODY = [
  "{",
  "  vec3 q = clamp((vPaintPos - uPaintMin) / max(uPaintMax - uPaintMin, vec3(1e-5)), 0.0, 1.0);",
  "  vec3 n = normalize(vPaintN);",
  "  vec3 own = diffuseColor.rgb;",
  "  vec3 acc = vec3(0.0);",
  "  float cover = 0.0;",
  "  float total = 0.0;",
  "  float w; vec4 c;",
  ...PAINT_DIRS.map((d, i) =>
    [
      `  w = pow(max(dot(n, vec3(${d.normal.map((v) => v.toFixed(1)).join(", ")})), 0.0), 3.0);`,
      "  total += w;",
      `  if (uPaintHave[${i}] > 0.5 && w > 0.0) { c = paintTile(${i}, ${sideUv(d)}); acc += w * c.a * c.rgb; cover += w * c.a; }`,
    ].join("\n"),
  ),
  "  if (total > 0.0) diffuseColor.rgb = (acc + (total - cover) * own) / total;",
  "}",
].join("\n");
