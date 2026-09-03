import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { probeImage } from "./image-probe";

function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  b.set([w >>> 24, (w >>> 16) & 255, (w >>> 8) & 255, w & 255], 16);
  b.set([h >>> 24, (h >>> 16) & 255, (h >>> 8) & 255, h & 255], 20);
  return b;
}
function jpeg(w: number, h: number): Uint8Array {
  // SOI, APP0 (len 16), SOF0 (len 17) with height/width.
  const b = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ]);
  return b;
}

describe("probeImage", () => {
  it("reads PNG dimensions from IHDR", () => {
    expect(probeImage(png(1024, 768))).toEqual({ width: 1024, height: 768, mimeType: "image/png" });
  });
  it("reads JPEG dimensions from the first SOF marker", () => {
    expect(probeImage(jpeg(640, 480))).toEqual({ width: 640, height: 480, mimeType: "image/jpeg" });
  });
  it("skips 0xFF fill bytes before a JPEG marker", () => {
    const j = jpeg(800, 600);
    // Insert two fill bytes before APP0 and two before SOF0.
    const padded = new Uint8Array([0xff, 0xd8, 0xff, 0xff, ...j.slice(2, 20), 0xff, 0xff, ...j.slice(20)]);
    expect(probeImage(padded)).toEqual({ width: 800, height: 600, mimeType: "image/jpeg" });
  });
  it("reads a real PNG the repo ships", () => {
    const icon = readFileSync("public/apple-touch-icon.png");
    const p = probeImage(new Uint8Array(icon));
    expect(p?.mimeType).toBe("image/png");
    expect(p?.width).toBeGreaterThan(0);
  });
  it("returns null for junk and for other formats", () => {
    expect(probeImage(new Uint8Array(0))).toBeNull();
    expect(probeImage(new TextEncoder().encode("GIF89a not an image we take"))).toBeNull();
  });
});
