// Real-looking scenery in Helios Studio (2026-09-30, operator: "The scenery
// must look real."). Until now the Studio drew every block in a flat colour.
//
// Surfaces: each block gets the set page's own physical material for its word
// (stage-materials.ts: asphalt, grass, concrete, brick, rubber, glass…), the
// word the set wrote, else one read from the thing's name (the keyword table
// below), else the stage's own inference from its colour, shape and size. The
// textures are the stage's procedural ones — made in the browser from noise,
// nothing downloaded, the rule stage-materials.ts was built on — mapped at
// WORLD scale (a box projection by the face's direction, so a 120 m road's
// asphalt is the same grain as a 3 m kerb's), with a normal map made from the
// same height so the path tracer sees the relief too (it ignores bump maps).
// The block's own colour stays its colour: a red kerb stays red.
//
// A photographed sky: a CC0 HDRI (Poly Haven, CC0 — "You can use our assets
// for any purpose, including commercial work", polyhaven.com/license, read
// 2026-09-30) at public/studio/sky/sky.hdr lights the viewport and the path
// tracer, turned so its sun stands where the Studio's hour puts the sun. The
// file is added by hand (its source in public/studio/sky/NOTICE.md); until it
// is there, the choice isn't offered.
//
// Pure and relative-import only: the tests and the engine share it.

import type { SetMaterial, SetObject } from "./set-spec";
import { inferMaterial } from "./stage-materials";
import { studioPlaceIndoor } from "./studio-recast";

/** Words in a thing's name → the material it is made of. First match wins; the set's own word always comes first. */
export const REAL_NAME_WORDS: readonly (readonly [RegExp, SetMaterial])[] = [
  [/\b(tyre|tire|tyres|tires|rubber)\b/i, "rubber"],
  [/\b(glass|window|windscreen|windshield|pane)\b/i, "glass"],
  [/\b(water|pool|pond|lake|sea|river|puddle)\b/i, "water"],
  [/\b(asphalt|tarmac|road|track|runway|street)\b/i, "asphalt"],
  [/\b(grass|lawn|turf|verge|field)\b/i, "grass"],
  [/\b(sand|dune|beach)\b/i, "sand"],
  [/\b(dirt|soil|earth|mud|gravel)\b/i, "earth"],
  [/\b(brick|bricks)\b/i, "brick"],
  [/\b(cobble|cobbles|cobblestone|paving|pavement|sidewalk|kerb|curb)\b/i, "concrete"],
  [/\b(wood|wooden|timber|plank|crate|bench|pallet)\b/i, "timber"],
  [/\b(fence|railing|rail|pole|post|pipe|steel|metal|gantry|truss)\b/i, "metal"],
  [/\b(concrete|wall|barrier|building|pit|garage|tower|stand|grandstand|bridge|block)\b/i, "concrete"],
  [/\b(tree|bush|hedge|foliage|shrub)\b/i, "foliage"],
  [/\b(flag|banner|awning|tent|canvas|cloth)\b/i, "fabric"],
];

/** The material a block is drawn in: the set's word, else its name's, else the stage's own inference. */
export function realWord(o: Pick<SetObject, "material" | "name" | "shape" | "size" | "color" | "roughness" | "metalness">): SetMaterial {
  if (o.material) return o.material;
  const name = typeof o.name === "string" ? o.name : "";
  for (const [re, word] of REAL_NAME_WORDS) if (name && re.test(name)) return word;
  return inferMaterial(o);
}

/**
 * World-scale texture coordinates for one vertex (a box projection): the face
 * is mapped on the two axes it spans, in metres of the thing's real size,
 * divided by the material's tile (the metres one repeat covers).
 */
export function worldUv(normal: readonly [number, number, number], pos: readonly [number, number, number], tile: number): [number, number] {
  const t = tile > 0 ? tile : 1;
  const [ax, ay, az] = normal.map(Math.abs);
  if (ax >= ay && ax >= az) return [pos[2] / t, pos[1] / t];
  if (ay >= az) return [pos[0] / t, pos[2] / t];
  return [pos[0] / t, pos[1] / t];
}

/**
 * A tangent-space normal map (RGBA, 0–255) from a grey height map of the same
 * size that tiles: central differences with wrap-around, `strength` the
 * relief. Flat is (128, 128, 255).
 */
export function normalFromHeight(grey: ArrayLike<number>, size: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const h = (x: number, y: number) => grey[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      out[o] = Math.round((-dx / len) * 127.5 + 127.5);
      out[o + 1] = Math.round((dy / len) * 127.5 + 127.5);
      out[o + 2] = Math.round((1 / len) * 127.5 + 127.5);
      out[o + 3] = 255;
    }
  }
  return out;
}

/** How strong a word's relief is drawn as a normal map, from its bump height in metres. */
export function normalStrength(bumpScale: number): number {
  return Math.min(6, Math.max(0.6, bumpScale * 60));
}

/** The sky a set opens with: the physical sky outdoors, even studio light for a place under a roof. */
export function studioDefaultSky(title: string, description: string): "physical" | "studio" {
  return studioPlaceIndoor(title, description) ? "studio" : "physical";
}

// ---------------------------------------------------------------------------
// The photographed sky
// ---------------------------------------------------------------------------

/** Where the photographed sky is served from (public/studio/sky/, its source in NOTICE.md there). */
export const STUDIO_SKY_URL = "/studio/sky/sky.hdr";

/**
 * The longitude (radians, three's equirectangular convention: a column at u
 * looks along (cos φ, ·, sin φ) with φ = (u − ½)·2π) of the sun in a sky
 * photo: the brightest column of its upper half, by luminance.
 */
export function hdriSunLongitude(rgba: ArrayLike<number>, width: number, height: number): number {
  let best = -1;
  let bx = 0;
  for (let y = 0; y < Math.floor(height / 2); y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const l = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
      if (l > best) {
        best = l;
        bx = x;
      }
    }
  }
  return ((bx + 0.5) / width - 0.5) * 2 * Math.PI;
}

/** The longitude of a direction (x, z) in the same convention. */
export function longitudeOf(x: number, z: number): number {
  return Math.atan2(z, x);
}

/**
 * An equirectangular picture turned about the upright by `turn` radians:
 * what was at longitude φ is at φ + turn. Rows kept; columns moved (with the
 * nearest column, as a sky needs no more). RGBA floats.
 */
export function turnEquirect(rgba: ArrayLike<number>, width: number, height: number, turn: number): Float32Array {
  const out = new Float32Array(width * height * 4);
  const shift = Math.round((turn / (2 * Math.PI)) * width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = (((x - shift) % width) + width) % width;
      const o = (y * width + x) * 4;
      const i = (y * width + sx) * 4;
      out[o] = rgba[i];
      out[o + 1] = rgba[i + 1];
      out[o + 2] = rgba[i + 2];
      out[o + 3] = 1;
    }
  }
  return out;
}

/** The same picture at another size (nearest pixel): the path tracer's dome is ENV_W × ENV_H. */
export function resizeEquirect(rgba: ArrayLike<number>, width: number, height: number, toW: number, toH: number): Float32Array {
  const out = new Float32Array(toW * toH * 4);
  for (let y = 0; y < toH; y++) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) / toH) * height));
    for (let x = 0; x < toW; x++) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) / toW) * width));
      const i = (sy * width + sx) * 4;
      const o = (y * toW + x) * 4;
      out[o] = rgba[i];
      out[o + 1] = rgba[i + 1];
      out[o + 2] = rgba[i + 2];
      out[o + 3] = 1;
    }
  }
  return out;
}
