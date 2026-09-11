import { describe, expect, it } from "vitest";
import { verticalFovDegFrom35mm } from "./exif-fov.mts";
import { fovWithin } from "./pass-bars.mts";

describe("verticalFovDegFrom35mm", () => {
  it("a 3:2 image at 50 mm equivalent is 26.99° tall", () => {
    expect(verticalFovDegFrom35mm(50, 6000, 4000)).toBeCloseTo(26.99, 2);
  });

  it("swaps width and height for a rotated (portrait) orientation", () => {
    const landscape = verticalFovDegFrom35mm(26, 4032, 3024);
    const rotated = verticalFovDegFrom35mm(26, 4032, 3024, 6);
    const portrait = verticalFovDegFrom35mm(26, 3024, 4032);
    expect(rotated).toBeCloseTo(portrait, 10);
    expect(portrait).toBeGreaterThan(landscape);
  });

  it("refuses nonsense", () => {
    expect(() => verticalFovDegFrom35mm(0, 10, 10)).toThrow();
  });
});

describe("fovWithin (±20%)", () => {
  it("includes the edges and excludes past them", () => {
    expect(fovWithin(48, 40)).toBe(true);
    expect(fovWithin(32, 40)).toBe(true);
    expect(fovWithin(48.01, 40)).toBe(false);
    expect(fovWithin(31.99, 40)).toBe(false);
  });
});
