import { describe, expect, it } from "vitest";
import { KELVIN_DAYLIGHT, kelvinToHex, kelvinToRgb, nearestKelvin } from "./light-kelvin";

// Colour temperature (the light department, cut 3): a way of choosing a
// light's colour, and of reading one back.

describe("kelvinToHex", () => {
  it("is white at 6,600 K, warm below it and cool above it", () => {
    expect(kelvinToHex(6600)).toBe("#ffffff");
    const [r, g, b] = kelvinToRgb(2700);
    expect(r).toBe(255);
    expect(g).toBeLessThan(200);
    expect(b).toBeLessThan(120);
    const cool = kelvinToRgb(9000);
    expect(cool[2]).toBe(255);
    expect(cool[0]).toBeLessThan(230);
  });

  it("writes six hex digits", () => {
    for (const k of [1800, 3200, 5600, 10000]) expect(kelvinToHex(k)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("nearestKelvin", () => {
  it("reads a blackbody colour back as its temperature", () => {
    for (const k of [2000, 2700, 3200, 4300, 5600, 8000]) expect(nearestKelvin(kelvinToHex(k))).toBe(k);
  });

  it("reads a colour off the line as its nearest, and junk as daylight", () => {
    expect(nearestKelvin("#7fb6ff")).toBeGreaterThan(7000);
    expect(nearestKelvin("#ffb877")).toBeLessThan(4000);
    expect(nearestKelvin("not a colour")).toBe(KELVIN_DAYLIGHT);
  });
});
