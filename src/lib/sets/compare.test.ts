import { describe, expect, it } from "vitest";
import { compareCrop, compareOutputSize, widenFovDeg } from "./compare";

// Camera 1's view at the photo's shape (2026-09-11). three.js's field of
// view is vertical, so a crop shorter than the canvas needs a wider camera
// for the crop to span camera 1's own field of view.

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

describe("compareCrop", () => {
  it("takes a band of a square canvas for a landscape photo, and widens the camera to match", () => {
    const c = compareCrop(1000, 1000, 1.5);
    expect(c.sw).toBe(1000);
    expect(c.sh).toBeCloseTo(666.667, 2);
    expect(c.sx).toBe(0);
    expect(c.sy).toBeCloseTo(166.667, 2);
    expect(c.fovScale).toBeCloseTo(1.5, 9);
  });

  it("takes the full height for a photo no wider than the canvas: camera 1's field of view as it is", () => {
    const c = compareCrop(1600, 900, 0.75);
    expect(c.sh).toBe(900);
    expect(c.sw).toBeCloseTo(675, 6);
    expect(c.sx).toBeCloseTo((1600 - 675) / 2, 6);
    expect(c.fovScale).toBe(1);
    // A photo exactly the canvas's shape is the whole canvas.
    expect(compareCrop(1600, 900, 16 / 9)).toMatchObject({ sx: 0, sy: 0, fovScale: 1 });
  });

  it("falls back to the whole canvas on a shape it cannot use", () => {
    expect(compareCrop(800, 600, 0)).toEqual({ sx: 0, sy: 0, sw: 800, sh: 600, fovScale: 1 });
    expect(compareCrop(800, 600, Number.NaN)).toEqual({ sx: 0, sy: 0, sw: 800, sh: 600, fovScale: 1 });
  });
});

describe("widenFovDeg", () => {
  it("widens 40° to about 57.3° for a band two thirds of the height", () => {
    expect(widenFovDeg(40, 1.5)).toBeCloseTo(57.29, 1);
  });

  it("makes the cropped band span exactly the camera's field of view", () => {
    for (const [fov, scale] of [
      [40, 1.5],
      [25, 2.4],
      [70, 1.2],
    ]) {
      const wide = widenFovDeg(fov, scale);
      // The central 1/scale of the height, seen through the widened camera.
      const band = 2 * deg(Math.atan(Math.tan(rad(wide) / 2) / scale));
      expect(band).toBeCloseTo(fov, 9);
    }
  });

  it("is the identity at scale 1, and ignores a scale it cannot use", () => {
    expect(widenFovDeg(40, 1)).toBe(40);
    expect(widenFovDeg(40, 0)).toBe(40);
    expect(widenFovDeg(40, Number.NaN)).toBe(40);
  });
});

describe("compareOutputSize", () => {
  it("puts the long side at px", () => {
    expect(compareOutputSize(1000, 666.667, 1024)).toEqual({ width: 1024, height: 683 });
    expect(compareOutputSize(675, 900, 1024)).toEqual({ width: 768, height: 1024 });
  });
});
