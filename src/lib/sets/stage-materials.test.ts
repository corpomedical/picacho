import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SET_MATERIALS, normaliseSetSpec, type SetMaterial, type SetObject } from "./set-spec";
import { SET_BUILDER_INSTRUCTIONS, SET_SPEC_JSON_SCHEMA } from "./set-builder-prompt";
import { SET_EDITOR_INSTRUCTIONS } from "./set-edit-prompt";
import {
  FULL_STAGE_EMISSIVE_GAIN,
  MATERIAL_RECIPES,
  TEXTURE_FIELDS,
  fitRepeat,
  groundMaterialOf,
  inferGroundMaterial,
  inferMaterial,
  materialOf,
  stageMaterial,
  withMaterials,
  type StageTextures,
  type TextureName,
} from "./stage-materials";
import raceTrack from "./fixtures-race-track.json";
import beach from "./fixtures-beach.json";
import showroom from "./fixtures-showroom-open.json";
import market from "./fixtures-rainy-market.json";

// The stage's surfaces (canvas page J, cut 1, 2026-09-17): a word per
// thing, a recipe per word, and the words an old set is given.

const load = (raw: unknown) => {
  const r = normaliseSetSpec(raw);
  if (!r.ok) throw new Error("fixture");
  return r.spec;
};
const track = load(raceTrack);
const shore = load(beach);
const room = load(showroom);
const night = load(market);

const find = (objects: SetObject[], where: (o: SetObject) => boolean): SetObject => {
  const o = objects.find(where);
  if (!o) throw new Error("no such object in the fixture");
  return o;
};

describe("the vocabulary", () => {
  it("has a recipe for every word, and every recipe's maps exist", () => {
    for (const word of SET_MATERIALS) {
      const r = MATERIAL_RECIPES[word];
      expect(r, word).toBeDefined();
      expect(r.tile).toBeGreaterThanOrEqual(0);
      for (const m of [r.map, r.bump, r.roughnessMap]) if (m) expect(TEXTURE_FIELDS[m], `${word}: ${m}`).toBeDefined();
      if (r.bump) expect(r.bumpScale).toBeGreaterThan(0);
    }
  });

  it("is what Astra is offered, on objects and on the ground, and what the instructions list", () => {
    const objects = SET_SPEC_JSON_SCHEMA.properties.objects.items.properties.material.enum;
    const ground = SET_SPEC_JSON_SCHEMA.properties.ground.properties.material.enum;
    expect([...objects]).toEqual([...SET_MATERIALS]);
    expect([...ground]).toEqual([...SET_MATERIALS]);
    expect(SET_SPEC_JSON_SCHEMA.properties.objects.items.required).toContain("material");
    expect(SET_SPEC_JSON_SCHEMA.properties.ground.required).toContain("material");
    for (const word of SET_MATERIALS) expect(SET_BUILDER_INSTRUCTIONS, word).toContain(word);
    expect(SET_BUILDER_INSTRUCTIONS).toContain("The ground has a material too.");
    expect(SET_EDITOR_INSTRUCTIONS).toContain("carry a material word; keep them");
  });
});

describe("the word an old set is given", () => {
  it("reads the operator's race track the way the draft did", () => {
    expect(inferGroundMaterial(track.ground)).toBe("asphalt");
    const body = find(track.objects, (o) => o.color === "#c91420");
    expect(inferMaterial(body)).toBe("paint");
    const tyre = find(track.objects, (o) => o.shape === "cylinder" && o.color === "#141518");
    expect(inferMaterial(tyre)).toBe("rubber");
    const hub = find(track.objects, (o) => o.shape === "cylinder" && o.metalness >= 0.9);
    expect(inferMaterial(hub)).toBe("chrome");
    const stand = find(track.objects, (o) => o.size[0] === 30 && o.size[1] === 4);
    expect(inferMaterial(stand)).toBe("concrete");
  });

  it("reads glass, timber, water, brick, sand and cobbles from the other fixtures", () => {
    const pane = find(room.objects, (o) => o.color === "#a5bdc8");
    expect(inferMaterial(pane)).toBe("glass");
    expect(inferGroundMaterial(room.ground)).toBe("tile");
    const post = find(shore.objects, (o) => o.color === "#85735d");
    expect(inferMaterial(post)).toBe("timber");
    const sea = find(shore.objects, (o) => o.color === "#657f89");
    expect(inferMaterial(sea)).toBe("water");
    expect(inferGroundMaterial(shore.ground)).toBe("sand");
    const wall = find(night.objects, (o) => o.color === "#493a37");
    expect(inferMaterial(wall)).toBe("brick");
    const puddle = find(night.objects, (o) => o.shape === "plane" && o.roughness <= 0.06);
    expect(inferMaterial(puddle)).toBe("water");
    expect(inferGroundMaterial(night.ground)).toBe("cobbles");
  });

  it("reads a lawn as grass and bare ground as earth", () => {
    expect(inferGroundMaterial({ color: "#4f7a3a", roughness: 0.95 })).toBe("grass");
    expect(inferGroundMaterial({ color: "#6b4f35", roughness: 0.95 })).toBe("earth");
  });

  it("is only used where nothing was said", () => {
    const said: SetObject = { ...track.objects[0], material: "fabric" };
    expect(materialOf(said)).toBe("fabric");
    expect(materialOf({ ...said, material: null })).toBe(inferMaterial(said));
    expect(groundMaterialOf({ ...track.ground, material: "grass" })).toBe("grass");
  });

  it("fills a set for an edit without touching a word already there", () => {
    const filled = withMaterials(track);
    expect(filled.objects).toHaveLength(track.objects.length);
    for (const o of filled.objects) expect(SET_MATERIALS).toContain(o.material);
    expect(filled.ground.material).toBe("asphalt");
    const kept = withMaterials({ ...track, objects: [{ ...track.objects[0], material: "fabric" }], ground: { ...track.ground, material: "grass" } });
    expect(kept.objects[0].material).toBe("fabric");
    expect(kept.ground.material).toBe("grass");
    expect(withMaterials(filled)).toEqual(filled);
    // Every fixture is drawn with a word on everything.
    for (const spec of [track, shore, room, night]) for (const o of spec.objects) expect(o.material).toBeNull();
  });
});

describe("the textures", () => {
  it("tile: the value at the far edge is the value at the near edge", () => {
    for (const name of Object.keys(TEXTURE_FIELDS) as TextureName[]) {
      const { at } = TEXTURE_FIELDS[name];
      for (const t of [0.05, 0.37, 0.5, 0.71, 0.93]) {
        expect(at(0, t), `${name} u`).toBeCloseTo(at(1, t), 6);
        expect(at(t, 0), `${name} v`).toBeCloseTo(at(t, 1), 6);
      }
    }
  });

  it("stay grey values between 0 and 1", () => {
    for (const name of Object.keys(TEXTURE_FIELDS) as TextureName[]) {
      const { at } = TEXTURE_FIELDS[name];
      for (let i = 0; i < 200; i++) {
        const v = at((i * 0.618) % 1, (i * 0.382) % 1);
        expect(v, name).toBeGreaterThanOrEqual(0);
        expect(v, name).toBeLessThanOrEqual(1.0001);
      }
    }
  });
});

/** Stand-in textures: one plain texture per name, so the maps can be checked without a canvas. */
const fakeTextures = (): StageTextures & { made: TextureName[] } => {
  const made: TextureName[] = [];
  const cache = new Map<TextureName, THREE.Texture>();
  return {
    made,
    get(name) {
      let t = cache.get(name);
      if (!t) {
        t = new THREE.Texture();
        cache.set(name, t);
        made.push(name);
      }
      return t;
    },
    dispose() {
      cache.clear();
    },
  };
};

describe("a word's material", () => {
  const plain = { color: "#808080", roughness: 0.8, metalness: 0 };

  it("is physical, carries its word, and follows its recipe", () => {
    for (const word of SET_MATERIALS) {
      const m = stageMaterial(THREE, word, plain, null);
      expect(m.isMeshPhysicalMaterial, word).toBe(true);
      expect(m.userData.material).toBe(word);
      expect(m.map).toBeNull();
    }
    expect(stageMaterial(THREE, "paint", plain, null).clearcoat).toBe(0.7);
    expect(stageMaterial(THREE, "chrome", plain, null).metalness).toBe(1);
    expect(stageMaterial(THREE, "asphalt", plain, null).roughness).toBe(0.96);
    expect(stageMaterial(THREE, "rubber", plain, null).sheen).toBe(0.5);
  });

  it("lets light through pale glass and mirrors in dark glass", () => {
    expect(stageMaterial(THREE, "glass", { ...plain, color: "#cfe0ea" }, null).transmission).toBe(0.9);
    expect(stageMaterial(THREE, "glass", { ...plain, color: "#1b2933" }, null).transmission).toBe(0.2);
  });

  it("draws a glow brighter, so the bloom picks it up", () => {
    const lamp = stageMaterial(THREE, "matte", { ...plain, emissive: "#ffd092", emissiveIntensity: 2 }, null);
    expect(lamp.emissiveIntensity).toBe(2 * FULL_STAGE_EMISSIVE_GAIN);
    expect(stageMaterial(THREE, "matte", plain, null).emissiveIntensity).toBe(0);
  });

  it("takes its maps from the page's textures", () => {
    const tex = fakeTextures();
    const m = stageMaterial(THREE, "brick", plain, tex);
    expect(m.map).toBe(tex.get("brick"));
    expect(m.bumpMap).toBe(tex.get("brick"));
    expect(tex.made).toEqual(["brick"]);
  });
});

describe("fitting the maps to a thing's size", () => {
  const big = { scale: { x: 30, y: 4, z: 120 } };
  const small = { scale: { x: 0.4, y: 1.2, z: 0.4 } };

  it("repeats a big thing's maps by the metres one tile covers, and leaves a small thing's alone", () => {
    const tex = fakeTextures();
    const wall = stageMaterial(THREE, "concrete", { color: "#808080", roughness: 0.85, metalness: 0 }, tex);
    const fitted = fitRepeat({ ...big, material: wall }, false);
    expect(fitted).not.toBeNull();
    expect(fitted).not.toBe(wall);
    // A solid maps its longer horizontal side and its height: 120 / 4 by 4 / 4.
    expect(fitted?.map?.repeat.toArray()).toEqual([30, 1]);
    expect(fitted?.map).not.toBe(wall.map);
    expect(fitted?.userData.material).toBe("concrete");
    expect(fitRepeat({ ...small, material: wall }, false)).toBeNull();
  });

  it("maps a sheet by its own two sides", () => {
    const tex = fakeTextures();
    const road = stageMaterial(THREE, "asphalt", { color: "#34363b", roughness: 0.95, metalness: 0 }, tex);
    const fitted = fitRepeat({ scale: { x: 25, y: 1, z: 120 }, material: road }, true);
    expect(fitted?.map?.repeat.toArray().map((v) => +v.toFixed(3))).toEqual([+(25 / 7).toFixed(3), +(120 / 7).toFixed(3)]);
  });

  it("has nothing to fit for a word without maps, or a material without textures", () => {
    const tex = fakeTextures();
    const paint = stageMaterial(THREE, "paint", { color: "#c91420", roughness: 0.2, metalness: 0.55 }, tex);
    expect(fitRepeat({ ...big, material: paint }, false)).toBeNull();
    const bare = stageMaterial(THREE, "concrete", { color: "#808080", roughness: 0.85, metalness: 0 }, null);
    expect(fitRepeat({ ...big, material: bare }, false)).toBeNull();
    const standard = new THREE.MeshStandardMaterial();
    expect(fitRepeat({ ...big, material: standard }, false)).toBeNull();
  });
});

describe("the recipes' words", () => {
  it("never leave a word undrawn", () => {
    const words = Object.keys(MATERIAL_RECIPES) as SetMaterial[];
    expect(words.sort()).toEqual([...SET_MATERIALS].sort());
  });
});
