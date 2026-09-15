import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { bandRect, cutToBand } from "./frame-cut";

// The frame lines are the picture: a rig-format still is cut to its band on
// the server before it is stored.

describe("bandRect", () => {
  it("cuts a wide band across the middle, and a narrow one down it", () => {
    expect(bandRect(1536, 1024, 2.39)).toEqual({ left: 0, top: 190, width: 1536, height: 643 });
    expect(bandRect(1536, 1024, 4 / 3)).toEqual({ left: 85, top: 0, width: 1365, height: 1024 });
    expect(bandRect(1024, 1536, 9 / 16)).toEqual({ left: 80, top: 0, width: 864, height: 1536 });
    expect(bandRect(1024, 1024, 1)).toEqual({ left: 0, top: 0, width: 1024, height: 1024 });
  });
});

describe("cutToBand", () => {
  it("returns a PNG of the band", async () => {
    const png = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: "#806040" } }).png().toBuffer();
    const out = Buffer.from(await cutToBand(png.toString("base64"), 2.39), "base64");
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1536, 643, "png"]);
  });

  it("leaves a picture already the band's shape as it was", async () => {
    const png = (await sharp({ create: { width: 64, height: 64, channels: 3, background: "#000" } }).png().toBuffer()).toString("base64");
    expect(await cutToBand(png, 1)).toBe(png);
  });
});
