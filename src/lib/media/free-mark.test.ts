import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { burnFreeMarkImage, freeMarkBox, freeMarkVideoFilter, FREE_MARK } from "./free-mark";

describe("freeMarkBox", () => {
  it("sizes the mark from the short side, so landscape and vertical match", () => {
    const wide = freeMarkBox(1920, 1080, 0.5);
    const tall = freeMarkBox(1080, 1920, 0.5);
    expect(wide.h).toBe(Math.round(1080 * FREE_MARK.height));
    expect(tall.h).toBe(wide.h);
    expect(tall.w).toBe(wide.w);
  });

  it("sits bottom right, inside the frame, with the same gap on both edges", () => {
    const b = freeMarkBox(1280, 720, 0.556);
    const gap = Math.round(720 * FREE_MARK.margin);
    expect(b.x + b.w + gap).toBe(1280);
    expect(b.y + b.h + gap).toBe(720);
  });
});

describe("burnFreeMarkImage", () => {
  it("lightens the bottom-right corner of a black picture and leaves the rest alone", async () => {
    const black = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#000" } })
      .jpeg()
      .toBuffer();
    const out = await burnFreeMarkImage(black);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([800, 600, "jpeg"]);
    const box = freeMarkBox(800, 600, 309 / 490);
    // stats() reads the input, not the crop, so each crop is cut out first.
    const crop = async (left: number, top: number, width: number, height: number) =>
      sharp(await sharp(out).extract({ left, top, width, height }).toBuffer()).stats();
    const corner = await crop(box.x, box.y, box.w, box.h);
    const elsewhere = await crop(0, 0, 200, 200);
    expect(corner.channels[0].max).toBeGreaterThan(100);
    expect(corner.channels[0].max).toBeLessThan(200); // a ghost, not solid white
    expect(elsewhere.channels[0].max).toBeLessThan(10);
  });
});

describe("freeMarkVideoFilter", () => {
  it("draws the mark at the same box a picture of that size gets, faded", () => {
    const b = freeMarkBox(1080, 1920, 0.556);
    const f = freeMarkVideoFilter(1080, 1920, 0.556);
    expect(f).toContain(`scale=${b.w}:${b.h}`);
    expect(f).toContain(`overlay=x=${b.x}:y=${b.y}`);
    expect(f).toContain(`aa=${FREE_MARK.opacity}`);
  });
});
