import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hdriSunLongitude, longitudeOf, normalFromHeight, realWord, resizeEquirect, studioDefaultSky, turnEquirect, worldUv } from "./studio-realism";

// "The scenery must look real." (2026-09-30): the material each block is drawn in, textures at world scale, the
// normal map the path tracer reads, the sky a set opens with, and the photographed sky turned to the hour.

const obj = (o: Partial<Parameters<typeof realWord>[0]>) => ({ material: null, name: undefined, shape: "box" as const, size: [1, 1, 1] as [number, number, number], color: "#808080", roughness: 0.6, metalness: 0, ...o });
const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

describe("what a block is made of", () => {
  it("is the set's own word first, then its name's, then the stage's inference", () => {
    expect(realWord(obj({ material: "brick", name: "tyre stack" }))).toBe("brick");
    expect(realWord(obj({ name: "Tyre stack" }))).toBe("rubber");
    expect(realWord(obj({ name: "pit wall" }))).toBe("concrete");
    expect(realWord(obj({ name: "catch fence" }))).toBe("metal");
    expect(realWord(obj({ name: "grass verge" }))).toBe("grass");
    expect(realWord(obj({ name: "main straight road" }))).toBe("asphalt");
    expect(realWord(obj({ name: "kerb" }))).toBe("concrete");
    expect(realWord(obj({ name: "pit window" }))).toBe("glass");
    // No name: the stage's own inference, as the set page draws it (a dark rough cylinder is a tyre).
    expect(realWord(obj({ shape: "cylinder", color: "#141518", roughness: 0.95 }))).toBe("rubber");
  });
});

describe("textures at the thing's real size", () => {
  it("map each face on the two axes it spans, in metres over the material's tile", () => {
    // The top of a 120 m road (asphalt tiles every 7 m): 120 m along z is ~17 repeats, not one stretched one.
    expect(worldUv([0, 1, 0], [12.5, 0, 60], 7)).toEqual([12.5 / 7, 60 / 7]);
    expect(worldUv([1, 0, 0], [0.45, 0.05, -60], 2)).toEqual([-30, 0.025]);
    expect(worldUv([0, 0, -1], [3, 2, 0], 1)).toEqual([3, 2]);
  });
  it("and the relief is a normal map: flat stays flat, a slope leans", () => {
    const flat = normalFromHeight(new Uint8ClampedArray(4 * 4 * 4).fill(128), 4, 2);
    expect([...flat.slice(0, 4)]).toEqual([128, 128, 255, 255]);
    const ramp = new Uint8ClampedArray(4 * 4 * 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) ramp[(y * 4 + x) * 4] = x === 1 ? 100 : x === 2 ? 200 : 150;
    const n = normalFromHeight(ramp, 4, 2);
    expect(n[(1 * 4 + 1) * 4]).toBeLessThan(128); // rising to the right: leans left
  });
  it("are on by default and switch in the World tab; the tracer keeps them (source)", () => {
    const engine = read("../../components/studio/studio-engine.ts");
    expect(engine).toContain("let realOn = true");
    expect(engine).toContain("Realistic materials");
    expect(engine).toContain("setTimeout(() => { if (stopped) return; if (realOn) setReal(true, true); void checkSkyPhoto(); }, 30);");
    // Coat off and glass thin-walled for the tracer (three-gpu-pathtracer draws both black).
    expect(engine).toContain("if (c.transmission > 0) c.thickness = 0;");
  });
});

describe("the sky", () => {
  it("opens as the physical sky outdoors and studio light under a roof", () => {
    expect(studioDefaultSky("Race track", "A sunny circuit")).toBe("physical");
    expect(studioDefaultSky("Midnight showroom", "")).toBe("studio");
    expect(studioDefaultSky("Somewhere", "")).toBe("physical");
  });

  it("finds the photo's sun and turns the photo so it stands where the hour's sun is", () => {
    const W = 16, H = 8, sky = new Float32Array(W * H * 4).fill(0.2);
    const at = (x: number, y: number, v: number) => sky.set([v, v, v, 1], (y * W + x) * 4);
    at(4, 2, 50); // the sun, in the upper half
    at(12, 6, 90); // a bright spot below the horizon is not the sun
    const lon = hdriSunLongitude(sky, W, H);
    expect(lon).toBeCloseTo(((4.5 / W) - 0.5) * 2 * Math.PI, 6);
    // Our sun towards +x (longitude 0): the photo turns so its sun column lands there.
    const want = longitudeOf(1, 0);
    const turned = turnEquirect(sky, W, H, want - lon);
    expect(hdriSunLongitude(turned, W, H)).toBeCloseTo(((8.5 / W) - 0.5) * 2 * Math.PI, 6);
    expect(Math.abs(hdriSunLongitude(turned, W, H) - want)).toBeLessThan((2 * Math.PI) / W);
    const small = resizeEquirect(turned, W, H, 8, 4);
    expect(small.length).toBe(8 * 4 * 4);
  });
});
