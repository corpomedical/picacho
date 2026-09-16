// Helios's surfaces (the stage, cut 1 of "out of this world", 2026-09-17):
// what each material word draws, how a set written without words gets them,
// and the textures the browser makes for them.
//
// A material is a WORD on the object (set-spec.ts SET_MATERIALS), never a
// texture file: nothing is downloaded, every surface is procedural, made once
// per page from noise in a canvas, and the word is all Astra has to write.
// A set from before the words — every set built before 2026-09-17, and any
// object Astra leaves at null — gets a word inferred from what it already
// says: colour, roughness, metalness, shape and size (inferMaterial). The
// inference is the same one the draft's before/after renders were made
// with (canvas page J), so what the operator approved is what an old set
// gets.
//
// Pure except makeStageTextures (a canvas) and stageMaterial (three.js
// materials), which take three as an argument the way build-scene.ts does,
// so the recipes and the inference run in node tests.

import type * as ThreeNS from "three";
import { SET_MATERIALS, type SetMaterial, type SetObject, type SetSpec } from "./set-spec";

type Three = typeof ThreeNS;

export type TextureName =
  | "asphalt"
  | "concrete"
  | "plaster"
  | "sand"
  | "earth"
  | "grass"
  | "wood"
  | "brick"
  | "cobble"
  | "tile"
  | "brushed"
  | "flake"
  | "waves"
  | "grime"
  | "weave";

export type StageTextures = {
  get(name: TextureName): ThreeNS.Texture;
  dispose(): void;
};

/** What a word draws: the maps it uses and how many metres one repeat of them covers (0 = never repeated by size). */
export type MaterialRecipe = {
  tile: number;
  map: TextureName | null;
  bump: TextureName | null;
  bumpScale: number;
  roughnessMap: TextureName | null;
  /** Fixed physical values; anything absent keeps what the object says. */
  physical: {
    roughness?: number | ((r: number) => number);
    metalness?: number | ((m: number) => number);
    specularIntensity?: number;
    clearcoat?: number;
    clearcoatRoughness?: number;
    envMapIntensity?: number;
    sheen?: number;
    sheenRoughness?: number;
    /** "self" tints the sheen with the object's own colour. */
    sheenColor?: string | "self";
    transmission?: number | "byLightness";
    thickness?: number;
    ior?: number;
    doubleSided?: boolean;
  };
};

export const MATERIAL_RECIPES: Record<SetMaterial, MaterialRecipe> = {
  matte: { tile: 6, map: null, bump: "grime", bumpScale: 0.006, roughnessMap: null, physical: { specularIntensity: 0.35 } },
  plaster: { tile: 3, map: null, bump: "plaster", bumpScale: 0.01, roughnessMap: null, physical: { roughness: (r) => Math.max(0.8, r), specularIntensity: 0.35 } },
  concrete: { tile: 4, map: "concrete", bump: "concrete", bumpScale: 0.03, roughnessMap: null, physical: { roughness: 0.95, specularIntensity: 0.3 } },
  asphalt: { tile: 7, map: "asphalt", bump: "asphalt", bumpScale: 0.02, roughnessMap: null, physical: { roughness: 0.96, metalness: 0, specularIntensity: 0.3 } },
  brick: { tile: 2.4, map: "brick", bump: "brick", bumpScale: 0.06, roughnessMap: null, physical: { roughness: 0.9, metalness: 0, specularIntensity: 0.3 } },
  cobbles: { tile: 1.6, map: "cobble", bump: "cobble", bumpScale: 0.12, roughnessMap: "cobble", physical: { roughness: 0.35, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.25, envMapIntensity: 1.2 } },
  tile: { tile: 5, map: "tile", bump: null, bumpScale: 0, roughnessMap: "tile", physical: { roughness: 0.22, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.15, envMapIntensity: 1.1 } },
  sand: { tile: 3, map: "sand", bump: "sand", bumpScale: 0.05, roughnessMap: null, physical: { roughness: 1, metalness: 0, specularIntensity: 0.2 } },
  earth: { tile: 3, map: "earth", bump: "earth", bumpScale: 0.04, roughnessMap: null, physical: { roughness: 1, metalness: 0, specularIntensity: 0.2 } },
  grass: { tile: 2, map: "grass", bump: "grass", bumpScale: 0.03, roughnessMap: null, physical: { roughness: 1, metalness: 0, specularIntensity: 0.2, sheen: 0.3, sheenColor: "self" } },
  foliage: { tile: 0.5, map: null, bump: "plaster", bumpScale: 0.08, roughnessMap: null, physical: { roughness: 1, metalness: 0, sheen: 0.4, sheenColor: "self" } },
  timber: { tile: 1.2, map: "wood", bump: "wood", bumpScale: 0.012, roughnessMap: null, physical: { roughness: (r) => Math.min(0.85, r + 0.1), metalness: 0, specularIntensity: 0.4 } },
  fabric: { tile: 0.6, map: null, bump: "weave", bumpScale: 0.01, roughnessMap: null, physical: { roughness: 0.9, metalness: 0, sheen: 0.6, sheenRoughness: 0.8, sheenColor: "self", specularIntensity: 0.25 } },
  paint: { tile: 0, map: null, bump: "flake", bumpScale: 0.0006, roughnessMap: null, physical: { roughness: 0.38, metalness: 0.55, clearcoat: 0.7, clearcoatRoughness: 0.08, envMapIntensity: 0.5 } },
  metal: { tile: 6, map: null, bump: "grime", bumpScale: 0.004, roughnessMap: null, physical: { roughness: (r) => Math.max(0.25, r), metalness: (m) => Math.max(0.6, m), clearcoat: 0.3, clearcoatRoughness: 0.2 } },
  chrome: { tile: 0.8, map: null, bump: "brushed", bumpScale: 0.002, roughnessMap: "brushed", physical: { roughness: (r) => Math.max(0.3, r), metalness: 1, envMapIntensity: 0.5 } },
  glass: { tile: 0, map: null, bump: null, bumpScale: 0, roughnessMap: null, physical: { roughness: 0.04, metalness: 0, transmission: "byLightness", thickness: 0.05, ior: 1.5, envMapIntensity: 1.2, clearcoat: 1, clearcoatRoughness: 0.03, doubleSided: true } },
  water: { tile: 8, map: null, bump: "waves", bumpScale: 0.05, roughnessMap: null, physical: { roughness: 0.1, metalness: 0.05, clearcoat: 0.6, envMapIntensity: 1.3 } },
  rubber: { tile: 0, map: null, bump: null, bumpScale: 0, roughnessMap: null, physical: { roughness: 0.9, metalness: 0, sheen: 0.5, sheenRoughness: 0.9, sheenColor: "#333333", specularIntensity: 0.4 } },
};

// --- inference: the word an object would have been given ----------------

type Hsl = { h: number; s: number; l: number };

/** Hue 0–360, saturation and lightness 0–1 of "#rrggbb" (three's own HSL, without three). */
export function hslOf(hex: string): Hsl {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/**
 * The material an object without a word gets, read from what it already
 * says. The rules, in order, are the draft's (canvas page J, 2026-09-16):
 * a flat sheet with no roughness is water; a saturated smooth metal is
 * paint; anything else near-mirror is chrome; a pale smooth metal is glass; a dark
 * rough cylinder is rubber (a tyre); a brown rough thing is timber; a big
 * rough reddish thing is brick, a big rough thing concrete; a rough sphere
 * is sand (a dune), a rough cone foliage (a tree); the rest plaster or matte.
 */
export function inferMaterial(o: Pick<SetObject, "shape" | "size" | "color" | "roughness" | "metalness">): SetMaterial {
  const { h, s, l } = hslOf(o.color);
  const big = Math.max(o.size[0], o.size[1], o.size[2]) >= 12;
  const plane = o.shape === "plane";
  if (plane && o.roughness <= 0.12) return "water";
  if (plane && big && o.metalness >= 0.1 && o.roughness < 0.4) return "water";
  // A saturated, smooth metal is painted bodywork before it is chrome: a
  // crimson coupe at metalness 0.75 is paint, a grey hub at 0.9 is chrome.
  if (o.metalness >= 0.45 && o.roughness <= 0.26 && s > 0.35) return "paint";
  if (o.metalness >= 0.75) return "chrome";
  if (o.metalness >= 0.4 && o.roughness <= 0.2 && l > 0.5 && s < 0.3) return "glass";
  if (o.metalness >= 0.4 && o.roughness <= 0.3 && l < 0.3 && s > 0.15) return "glass";
  if (o.metalness >= 0.4) return "metal";
  if (o.shape === "cylinder" && o.roughness >= 0.85 && l < 0.22) return "rubber";
  // Browns are quiet colours: weathered timber sits around 15–18 % saturation.
  if (h >= 15 && h <= 45 && s >= 0.15 && o.roughness >= 0.5 && l < 0.6) return "timber";
  if (big && o.roughness >= 0.7 && h >= 5 && h <= 25 && s >= 0.1) return "brick";
  if (big && o.roughness >= 0.7) return "concrete";
  if (o.shape === "sphere" && o.roughness >= 0.9) return "sand";
  if (o.shape === "cone" && o.roughness >= 0.9) return "foliage";
  if (o.roughness >= 0.75) return "plaster";
  return "matte";
}

/** The ground's word, from its colour and roughness: wet cobbles, asphalt, sand, earth, grass, polished tile, or concrete. */
export function inferGroundMaterial(ground: Pick<SetSpec["ground"], "color" | "roughness">): SetMaterial {
  const { h, s, l } = hslOf(ground.color);
  if (l < 0.25 && ground.roughness < 0.4) return "cobbles";
  if (l < 0.42 && s < 0.12) return "asphalt";
  if (h >= 70 && h <= 160 && s > 0.2) return "grass";
  if (h >= 25 && h <= 50 && s > 0.2 && l >= 0.55) return "sand";
  if (h >= 15 && h <= 50 && s > 0.15 && ground.roughness >= 0.8 && l < 0.55) return "earth";
  if (h >= 25 && h <= 50 && s > 0.2) return "sand";
  if (l > 0.55 && ground.roughness < 0.45) return "tile";
  return "concrete";
}

/** The object's own word, or the one it would be given. */
export function materialOf(o: SetObject): SetMaterial {
  return o.material ?? inferMaterial(o);
}

export function groundMaterialOf(ground: SetSpec["ground"]): SetMaterial {
  return ground.material ?? inferGroundMaterial(ground);
}

/**
 * The spec with every missing word filled in — what an Astra edit is
 * handed, so a set from before the words keeps the surfaces it has been
 * drawn with instead of having the model guess them anew.
 */
export function withMaterials(spec: SetSpec): SetSpec {
  const objects = spec.objects.map((o) => (o.material ? o : { ...o, material: inferMaterial(o) }));
  const ground = spec.ground.material ? spec.ground : { ...spec.ground, material: inferGroundMaterial(spec.ground) };
  return { ...spec, objects, ground };
}

export function isMaterial(x: unknown): x is SetMaterial {
  return typeof x === "string" && (SET_MATERIALS as readonly string[]).includes(x);
}

// --- the textures: noise in a canvas, once per page ---------------------

const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const wrap = (i: number, period: number) => ((i % period) + period) % period;
/** Value noise over a lattice `px` by `py` cells that repeats past its edges. */
function vnoise(x: number, y: number, px: number, py: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const x0 = wrap(xi, px);
  const x1 = wrap(xi + 1, px);
  const y0 = wrap(yi, py);
  const y1 = wrap(yi + 1, py);
  return lerp(lerp(hash(x0, y0), hash(x1, y0), fx), lerp(hash(x0, y1), hash(x1, y1), fx), fy);
}
/**
 * Fractal value noise, 0–1, of (u, v) in 0–1 at `fx` by `fy` cells per
 * repeat; each octave doubles the cells, so the whole thing tiles: the
 * value at u = 1 is the value at u = 0.
 */
export function fbm(u: number, v: number, fx: number, fy: number, octaves = 4): number {
  let a = 0;
  let s = 0;
  let amp = 1;
  let px = fx;
  let py = fy;
  for (let i = 0; i < octaves; i++) {
    a += vnoise(u * px + i * 7.1, v * py + i * 3.7, px, py) * amp;
    s += amp;
    px *= 2;
    py *= 2;
    amp *= 0.5;
  }
  return a / s;
}
const TAU = Math.PI * 2;

/** Each texture as a grey value 0–1 at (u, v) in 0–1. Every one tiles: the noise repeats and every wave has a whole number of periods. */
export const TEXTURE_FIELDS: Record<TextureName, { size: number; at: (u: number, v: number) => number }> = {
  asphalt: { size: 1024, at: (u, v) => 0.45 + 0.33 * fbm(u, v, 60, 60, 5) + 0.15 * (hash(Math.floor(u * 1024) % 1024, Math.floor(v * 1024) % 1024) - 0.5) },
  concrete: { size: 1024, at: (u, v) => 0.62 + 0.38 * fbm(u, v, 9, 9, 5) - 0.12 * Math.pow(fbm(u, v, 40, 3, 3), 3) },
  plaster: { size: 512, at: (u, v) => 0.7 + 0.3 * fbm(u, v, 24, 24, 4) },
  sand: { size: 1024, at: (u, v) => 0.55 + 0.25 * Math.sin((v * 34 + fbm(u, v, 6, 6, 3) * 2.2) * TAU) + 0.2 * fbm(u, v, 80, 80, 3) },
  earth: { size: 1024, at: (u, v) => 0.5 + 0.3 * fbm(u, v, 14, 14, 5) + 0.2 * fbm(u, v, 90, 90, 2) },
  grass: { size: 1024, at: (u, v) => 0.6 + 0.25 * fbm(u, v, 120, 120, 3) + 0.15 * fbm(u, v, 8, 8, 3) },
  wood: {
    size: 512,
    at: (u, v) => {
      const g = v * 9 + fbm(u, v, 3, 2, 3) * 1.6;
      return 0.5 + 0.35 * Math.sin(g * TAU) * (0.6 + 0.4 * fbm(u, v, 50, 8, 2)) + 0.15 * fbm(u, v, 120, 4, 2);
    },
  },
  brick: {
    size: 1024,
    at: (u, v) => {
      const row = Math.floor(v * 12);
      const off = (row % 2) * 0.5;
      const bx = (u * 6 + off) % 1;
      const by = (v * 12) % 1;
      const mortar = bx < 0.06 || by < 0.12 ? 0.25 : 1;
      return mortar * (0.62 + 0.38 * fbm(u, v, 60, 60, 3));
    },
  },
  cobble: {
    size: 1024,
    at: (u, v) => {
      const n = 14;
      const cx = Math.floor(u * n);
      const cy = Math.floor(v * n);
      const fx = ((u * n) % 1) - 0.5;
      const fy = ((v * n) % 1) - 0.5;
      const jx = (hash(cx % n, cy % n) - 0.5) * 0.25;
      const jy = (hash(cy % n, cx % n) - 0.5) * 0.25;
      const d = Math.sqrt((fx - jx) ** 2 + (fy - jy) ** 2);
      const dome = Math.max(0, 1 - Math.pow(d / 0.5, 2));
      return 0.15 + 0.85 * dome * (0.8 + 0.2 * fbm(u, v, 90, 90, 2));
    },
  },
  tile: {
    size: 1024,
    at: (u, v) => 0.55 + 0.45 * fbm(u, v, 4, 4, 5) - 0.1 * (Math.abs(((u * 6) % 1) - 0.5) < 0.006 || Math.abs(((v * 5) % 1) - 0.5) < 0.006 ? 1 : 0),
  },
  brushed: { size: 512, at: (u, v) => 0.5 + 0.5 * fbm(u, v, 2, 200, 3) },
  flake: { size: 256, at: (u, v) => hash(Math.floor(u * 256) % 256, Math.floor(v * 256) % 256) },
  waves: { size: 1024, at: (u, v) => 0.5 + 0.2 * Math.sin((v * 9 + fbm(u, v, 8, 2, 3) * 1.5) * TAU) + 0.12 * fbm(u, v, 60, 60, 3) + 0.1 * Math.sin((u * 13 + v * 3) * TAU) },
  grime: { size: 512, at: (u, v) => 0.75 + 0.25 * fbm(u, v, 5, 5, 4) },
  weave: { size: 256, at: (u, v) => 0.6 + 0.2 * Math.sin(u * 64 * TAU) * Math.sin(v * 64 * TAU) + 0.2 * fbm(u, v, 30, 30, 2) },
};

/**
 * The page's textures, made on first use and kept for the page. Browser
 * only (a canvas); build-scene.ts draws the words without textures where
 * there are none, so nothing here runs in node.
 */
export function makeStageTextures(THREE: Three): StageTextures {
  const made = new Map<TextureName, ThreeNS.Texture>();
  return {
    get(name) {
      const hit = made.get(name);
      if (hit) return hit;
      const { size, at } = TEXTURE_FIELDS[name];
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const ctx = c.getContext("2d");
      if (ctx) {
        const img = ctx.createImageData(size, size);
        const d = img.data;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const g = Math.max(0, Math.min(255, at(x / size, y / size) * 255));
            const o = (y * size + x) * 4;
            d[o] = g;
            d[o + 1] = g;
            d[o + 2] = g;
            d[o + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      // Grey values, used as multipliers and as heights: never colour-managed.
      t.colorSpace = THREE.NoColorSpace;
      made.set(name, t);
      return t;
    },
    dispose() {
      for (const t of made.values()) t.dispose();
      made.clear();
    },
  };
}

// --- the materials ----------------------------------------------------------

export type SurfaceInput = {
  color: string;
  roughness: number;
  metalness: number;
  emissive?: string | null;
  emissiveIntensity?: number;
  /** A flat sheet is drawn from both sides. */
  doubleSided?: boolean;
};

/** How much brighter a glowing thing is drawn on the full stage, where the bloom picks it up. */
export const FULL_STAGE_EMISSIVE_GAIN = 2.5;

/** Whether a word's maps are repeated by the thing's size (fitRepeat) — words with a tile. */
export function tileOf(word: SetMaterial): number {
  return MATERIAL_RECIPES[word].tile;
}

/**
 * A physical material for a word. With `textures` null (node, a page still
 * making them) the recipe's numbers apply without its maps.
 */
export function stageMaterial(THREE: Three, word: SetMaterial, s: SurfaceInput, textures: StageTextures | null): ThreeNS.MeshPhysicalMaterial {
  const r = MATERIAL_RECIPES[word];
  const p = r.physical;
  const color = new THREE.Color(s.color);
  const { l } = hslOf(s.color);
  const num = (v: number | ((x: number) => number) | undefined, own: number) => (v === undefined ? own : typeof v === "function" ? v(own) : v);
  const m = new THREE.MeshPhysicalMaterial({
    color,
    roughness: num(p.roughness, s.roughness),
    metalness: num(p.metalness, s.metalness),
    emissive: new THREE.Color(s.emissive ?? "#000000"),
    emissiveIntensity: s.emissive ? (s.emissiveIntensity ?? 1) * FULL_STAGE_EMISSIVE_GAIN : 0,
    side: s.doubleSided || p.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (p.specularIntensity !== undefined) m.specularIntensity = p.specularIntensity;
  if (p.clearcoat !== undefined) m.clearcoat = p.clearcoat;
  if (p.clearcoatRoughness !== undefined) m.clearcoatRoughness = p.clearcoatRoughness;
  if (p.envMapIntensity !== undefined) m.envMapIntensity = p.envMapIntensity;
  if (p.sheen !== undefined) m.sheen = p.sheen;
  if (p.sheenRoughness !== undefined) m.sheenRoughness = p.sheenRoughness;
  if (p.sheenColor !== undefined) m.sheenColor = p.sheenColor === "self" ? color.clone() : new THREE.Color(p.sheenColor);
  if (p.transmission !== undefined) {
    // Pale glass lets the light through; dark glass is a tinted, mirroring pane.
    m.transmission = p.transmission === "byLightness" ? (l > 0.45 ? 0.9 : 0.2) : p.transmission;
    m.transparent = true;
  }
  if (p.thickness !== undefined) m.thickness = p.thickness;
  if (p.ior !== undefined) m.ior = p.ior;
  if (textures) {
    if (r.map) m.map = textures.get(r.map);
    if (r.bump) {
      m.bumpMap = textures.get(r.bump);
      m.bumpScale = r.bumpScale;
    }
    if (r.roughnessMap) m.roughnessMap = textures.get(r.roughnessMap);
  }
  m.userData.material = word;
  return m;
}

/**
 * The maps repeated by the mesh's world size, so a 120 m barrier and a
 * 0.4 m post read at the same scale: a copy of the material with its maps
 * cloned at the right repeat. Only for a mesh over `minSpan` metres — the
 * small things share their material as built. A sheet maps x and z; a
 * solid maps its longer horizontal side and its height.
 */
export function fitRepeat(
  mesh: { scale: { x: number; y: number; z: number }; material: ThreeNS.Material | ThreeNS.Material[] },
  isPlane: boolean,
  minSpan = 3,
): ThreeNS.MeshPhysicalMaterial | null {
  const mat = mesh.material as ThreeNS.MeshPhysicalMaterial;
  const word = mat.userData?.material as SetMaterial | undefined;
  if (!word || !mat.isMeshPhysicalMaterial) return null;
  const tile = tileOf(word);
  if (!mat.map && !mat.bumpMap && !mat.roughnessMap) return null;
  const sx = Math.abs(mesh.scale.x) || 1;
  const sy = Math.abs(mesh.scale.y) || 1;
  const sz = Math.abs(mesh.scale.z) || 1;
  if (tile <= 0 || Math.max(sx, sy, sz) <= minSpan) return null;
  const a = isPlane ? sx : Math.max(sx, sz);
  const b = isPlane ? sz : sy;
  const rx = Math.max(0.25, a / tile);
  const ry = Math.max(0.25, b / tile);
  const copy = mat.clone();
  copy.userData.material = word;
  for (const k of ["map", "bumpMap", "roughnessMap"] as const) {
    const t = copy[k];
    if (!t) continue;
    const c = t.clone();
    c.repeat.set(rx, ry);
    c.needsUpdate = true;
    copy[k] = c;
  }
  return copy;
}
