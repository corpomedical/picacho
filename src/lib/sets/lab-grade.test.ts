import { describe, expect, it } from "vitest";
import { fromBytes, labGrade, toBytes, type LabLooks, type Picture } from "./lab-grade";

// The lab (Helios, 2026-09-15): each look does what it says on the
// picture, the same every time, and leaves the input alone. A synthetic
// 96 × 40 frame: a mid-grey gradient with one small bright light and one
// dark corner, enough for every look to show its hand.

const W = 96;
const H = 40;
const LIGHT = { x: 48, y: 20 };

function frame(): Picture {
  const bytes = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const base = 60 + Math.round((x / (W - 1)) * 100);
      const lit = Math.hypot(x - LIGHT.x, y - LIGHT.y) <= 1.5;
      bytes[i] = lit ? 255 : base;
      bytes[i + 1] = lit ? 255 : base - 10;
      bytes[i + 2] = lit ? 255 : base - 20;
    }
  }
  return fromBytes(W, H, bytes);
}

const at = (p: Picture, x: number, y: number) => {
  const i = (y * p.width + x) * 3;
  return [p.rgb[i], p.rgb[i + 1], p.rgb[i + 2]];
};
const meanLuma = (p: Picture) => {
  let sum = 0;
  for (let i = 0; i < p.rgb.length; i += 3) sum += 0.2126 * p.rgb[i] + 0.7152 * p.rgb[i + 1] + 0.0722 * p.rgb[i + 2];
  return sum / (p.rgb.length / 3);
};
const grade = (looks: LabLooks) => labGrade(frame(), looks);

describe("the lab", () => {
  it("does nothing for the model's own clean render: digital, the clean prime, or nothing asked", () => {
    const before = toBytes(frame());
    for (const looks of [{}, { stock: "digital" }, { lens: "clean" }, { stock: "digital", lens: "clean", silver: false }] as LabLooks[]) {
      expect(toBytes(grade(looks))).toEqual(before);
    }
  });

  it("never touches the picture it is handed, and keeps its size", () => {
    const input = frame();
    const copy = new Float32Array(input.rgb);
    const out = labGrade(input, { stock: "film16", lens: "vintage", silver: true });
    expect(input.rgb).toEqual(copy);
    expect([out.width, out.height, out.rgb.length]).toEqual([W, H, W * H * 3]);
  });

  it("is the same every time: the grain is a fixed seed", () => {
    for (const stock of ["film35", "film16", "homevideo"] as const) {
      expect(toBytes(grade({ stock }))).toEqual(toBytes(grade({ stock })));
    }
  });

  it("prints Silver Print in true black and white", () => {
    const out = toBytes(grade({ silver: true }));
    for (let i = 0; i < out.length; i += 3) {
      // Grey, give or take the faint cool cast in the highlights (up to 4 of 255 at white).
      expect(Math.abs(out[i] - out[i + 1])).toBeLessThanOrEqual(5);
      expect(Math.abs(out[i + 2] - out[i + 1])).toBeLessThanOrEqual(5);
    }
  });

  it("grains 35 mm film without moving the picture's brightness", () => {
    const before = frame();
    const out = grade({ stock: "film35" });
    expect(Math.abs(meanLuma(out) - meanLuma(before))).toBeLessThan(0.03);
    // Neighbours on a smooth ramp stop agreeing: that is grain.
    let jumps = 0;
    for (let x = 1; x < W; x++) if (Math.abs(at(out, x, 5)[1] - at(out, x - 1, 5)[1]) > 0.012) jumps++;
    expect(jumps).toBeGreaterThan(W / 4);
  });

  it("lifts 16 mm's blacks: its darkest point is lighter than the frame's", () => {
    const min = (p: Picture) => Math.min(...Array.from(p.rgb));
    expect(min(grade({ stock: "film16" }))).toBeGreaterThan(min(frame()));
  });

  it("draws home video's scanlines: every third row darker than the one below it", () => {
    const out = grade({ stock: "homevideo" });
    let darker = 0;
    for (let y = 3; y < H - 1; y += 3) if (at(out, 10, y)[1] < at(out, 10, y + 1)[1]) darker++;
    expect(darker).toBeGreaterThanOrEqual(Math.floor((H - 4) / 3) - 1);
  });

  it("blooms halation red-orange round the bright light, not blue", () => {
    const before = frame();
    const out = grade({ lens: "halation" });
    const [r0, , b0] = at(before, LIGHT.x + 4, LIGHT.y);
    const [r1, , b1] = at(out, LIGHT.x + 4, LIGHT.y);
    expect(r1 - r0).toBeGreaterThan(0.02);
    expect(r1 - r0).toBeGreaterThan(b1 - b0);
  });

  it("streaks an anamorphic flare sideways from the light, blue, and not up or down", () => {
    const before = frame();
    const out = grade({ lens: "anamorphic" });
    const lift = (x: number, y: number) => at(out, x, y)[2] - at(before, x, y)[2];
    expect(lift(LIGHT.x + 12, LIGHT.y)).toBeGreaterThan(0.02);
    expect(lift(LIGHT.x + 12, LIGHT.y)).toBeGreaterThan(lift(LIGHT.x, LIGHT.y + 12) * 3);
  });

  it("darkens a vintage lens's corners more than its middle", () => {
    const before = frame();
    const out = grade({ lens: "vintage" });
    const drop = (x: number, y: number) => at(before, x, y)[1] - at(out, x, y)[1];
    expect(drop(W - 1, 0)).toBeGreaterThan(drop(W / 2, H / 2) + 0.05);
  });
});
