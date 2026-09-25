import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { HEX_COLOUR } from "./types";
import { deltaE, paletteFromImage, paletteFromPixels, rgbToLab } from "./palette";

// The card's first-draft colours, read locally with sharp. Every picture
// here is drawn with sharp itself, so the tests say what the palette of a
// known picture is, not what a fixture file happened to contain.

type Rgb = [number, number, number];

/** A w × h picture: a background, and rectangles painted on it. */
async function picture(
  w: number,
  h: number,
  background: Rgb | { r: number; g: number; b: number; alpha: number },
  rects: { x: number; y: number; w: number; h: number; colour: Rgb }[],
): Promise<Buffer> {
  const bg = Array.isArray(background) ? { r: background[0], g: background[1], b: background[2], alpha: 1 } : background;
  const base = sharp({ create: { width: w, height: h, channels: 4, background: bg } });
  const layers = await Promise.all(
    rects.map(async (r) => ({
      input: await sharp({
        create: { width: r.w, height: r.h, channels: 4, background: { r: r.colour[0], g: r.colour[1], b: r.colour[2], alpha: 1 } },
      })
        .png()
        .toBuffer(),
      left: r.x,
      top: r.y,
    })),
  );
  return base.composite(layers).png().toBuffer();
}

const near = (hex: string, [r, g, b]: Rgb) => {
  const got: Rgb = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  return deltaE(rgbToLab(got), rgbToLab([r, g, b])) < 6;
};

const RED: Rgb = [200, 30, 40];
const BLUE: Rgb = [20, 60, 190];
const BLACK: Rgb = [12, 12, 14];
const WHITE: Rgb = [250, 250, 250];
const GOLD: Rgb = [212, 170, 60];

describe("a packshot on white", () => {
  it("gives the product's colours, biggest first, and leaves the white background out", async () => {
    const img = await picture(400, 400, WHITE, [
      { x: 100, y: 60, w: 200, h: 220, colour: RED },
      { x: 100, y: 280, w: 200, h: 60, colour: BLUE },
    ]);
    const palette = await paletteFromImage(img);
    expect(palette.length).toBeGreaterThanOrEqual(2);
    expect(palette.length).toBeLessThanOrEqual(4);
    expect(near(palette[0], RED)).toBe(true);
    expect(near(palette[1], BLUE)).toBe(true);
    expect(palette.some((c) => near(c, WHITE))).toBe(false);
    for (const c of palette) expect(c).toMatch(HEX_COLOUR);
  });

  it("keeps a black product's black: only the background tone is left out", async () => {
    const img = await picture(400, 400, WHITE, [
      { x: 120, y: 40, w: 160, h: 300, colour: BLACK },
      { x: 150, y: 150, w: 100, h: 50, colour: GOLD },
    ]);
    const palette = await paletteFromImage(img);
    expect(near(palette[0], BLACK)).toBe(true);
    expect(palette.some((c) => near(c, GOLD))).toBe(true);
    expect(palette.some((c) => near(c, WHITE))).toBe(false);
  });

  it("a white product on white is still white (leaving the background out would leave nothing)", async () => {
    const img = await picture(300, 300, WHITE, [{ x: 140, y: 140, w: 10, h: 10, colour: [251, 251, 251] }]);
    const palette = await paletteFromImage(img);
    expect(palette).toHaveLength(1);
    expect(near(palette[0], WHITE)).toBe(true);
  });

  it("a white bottle on black keeps its white and leaves the black out", async () => {
    const img = await picture(400, 400, BLACK, [
      { x: 140, y: 40, w: 120, h: 320, colour: WHITE },
      { x: 150, y: 180, w: 100, h: 60, colour: RED },
    ]);
    const palette = await paletteFromImage(img);
    expect(near(palette[0], WHITE)).toBe(true);
    expect(palette.some((c) => near(c, RED))).toBe(true);
    expect(palette.some((c) => near(c, BLACK))).toBe(false);
  });
});

describe("a cut-out (a matte)", () => {
  it("counts every opaque pixel, white included, and never the transparent ones", async () => {
    const img = await picture(300, 300, { r: 0, g: 0, b: 0, alpha: 0 }, [
      { x: 50, y: 50, w: 200, h: 140, colour: WHITE },
      { x: 50, y: 190, w: 200, h: 60, colour: BLUE },
    ]);
    const palette = await paletteFromImage(img);
    expect(near(palette[0], WHITE)).toBe(true);
    expect(near(palette[1], BLUE)).toBe(true);
    expect(palette.some((c) => near(c, BLACK))).toBe(false);
  });
});

describe("shading, boxes and bounds", () => {
  it("shades of one surface are one colour; a different hue is another", async () => {
    const img = await picture(400, 200, WHITE, [
      { x: 20, y: 20, w: 120, h: 160, colour: [200, 30, 40] },
      { x: 140, y: 20, w: 120, h: 160, colour: [190, 35, 45] },
      { x: 260, y: 20, w: 120, h: 160, colour: [240, 140, 20] },
    ]);
    const palette = await paletteFromImage(img);
    expect(palette).toHaveLength(2);
    expect(near(palette[0], [195, 32, 42])).toBe(true);
    expect(near(palette[1], [240, 140, 20])).toBe(true);
  });

  it("reads only the box when one is given (the logo box)", async () => {
    const img = await picture(400, 400, WHITE, [
      { x: 0, y: 0, w: 200, h: 400, colour: RED },
      { x: 200, y: 0, w: 200, h: 400, colour: BLUE },
    ]);
    const left = await paletteFromImage(img, { box: { x: 0, y: 0, w: 0.5, h: 1 } });
    expect(left).toHaveLength(1);
    expect(near(left[0], RED)).toBe(true);
    const right = await paletteFromImage(img, { box: { x: 0.5, y: 0, w: 0.5, h: 1 } });
    expect(near(right[0], BLUE)).toBe(true);
    // A box outside the picture is ignored, not trusted.
    const whole = await paletteFromImage(img, { box: { x: 0.8, y: 0, w: 0.5, h: 1 } });
    expect(whole).toHaveLength(2);
  });

  it("never more than 4, and `max` lowers it", async () => {
    const colours: Rgb[] = [RED, BLUE, GOLD, [30, 160, 60], [150, 40, 170], [30, 190, 200]];
    const img = await picture(600, 100, WHITE, colours.map((colour, i) => ({ x: i * 100, y: 0, w: 100, h: 100, colour })));
    expect(await paletteFromImage(img)).toHaveLength(4);
    expect(await paletteFromImage(img, { max: 2 })).toHaveLength(2);
  });

  it("is the same every time for the same picture", async () => {
    const img = await picture(300, 300, WHITE, [
      { x: 30, y: 30, w: 120, h: 240, colour: GOLD },
      { x: 150, y: 30, w: 120, h: 240, colour: BLUE },
    ]);
    expect(await paletteFromImage(img)).toEqual(await paletteFromImage(img));
  });

  it("answers [] for bytes that are not a picture, and for a pixel flood", async () => {
    expect(await paletteFromImage(Buffer.from("not a picture"))).toEqual([]);
    expect(await paletteFromImage(Buffer.alloc(0))).toEqual([]);
    const big = await picture(500, 500, WHITE, [{ x: 0, y: 0, w: 250, h: 250, colour: RED }]);
    expect(await paletteFromImage(big, { maxInputPixels: 1000 })).toEqual([]);
  });

  it("paletteFromPixels: a fully transparent buffer has no colours", () => {
    expect(paletteFromPixels(new Uint8Array(4 * 16), 4, 4, { matte: true })).toEqual([]);
    expect(paletteFromPixels(new Uint8Array(0), 0, 0, { matte: false })).toEqual([]);
  });
});
