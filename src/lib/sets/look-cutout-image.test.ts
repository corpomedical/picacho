import { describe, expect, it } from "vitest";
import {
  LOOK_CROP_MARGIN,
  LOOK_MAX_MASK_SHARE,
  LOOK_MIN_MASK_SHARE,
  composeLookCutout,
  maskExtent,
} from "./look-cutout-image";

// A look's cutout (2026-09-12): SAM 2's answer is the whole still with the
// outside made transparent — not erased. What reaches the image model must
// be only the kept pixels, on grey, cropped to them.

type SharpFn = (typeof import("sharp"))["default"];
let sharp: SharpFn | null = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  sharp = null;
}

const W = 600;
const H = 300;

/**
 * SAM 2's answer, made up: a W × H PNG whose outside is pure red at alpha 0 —
 * the colour a transparent pixel still carries — and whose mask is blue.
 */
async function samAnswer(inMask: (x: number, y: number) => boolean): Promise<Buffer> {
  const raw = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const kept = inMask(x, y);
      raw[i] = kept ? 0 : 255;
      raw[i + 1] = 0;
      raw[i + 2] = kept ? 255 : 0;
      raw[i + 3] = kept ? 255 : 0;
    }
  }
  return sharp!(raw, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

describe("maskExtent", () => {
  it("measures the kept pixels' box and share of the frame", () => {
    const alpha = (i: number) => {
      const x = i % 10;
      const y = Math.floor(i / 10);
      return x >= 2 && x < 5 && y >= 3 && y < 7 ? 255 : 0;
    };
    expect(maskExtent(alpha, 10, 10)).toEqual({ share: 0.12, box: { left: 2, top: 3, right: 5, bottom: 7 } });
    expect(maskExtent(() => 0, 10, 10)).toEqual({ share: 0, box: null });
    // SAM 2's masks are 0 or 255; anything from half up counts as kept.
    expect(maskExtent(() => 127, 4, 4).share).toBe(0);
    expect(maskExtent(() => 128, 4, 4).share).toBe(1);
  });
});

describe.skipIf(!sharp)("composeLookCutout (sharp)", () => {
  // The mask: a 180 × 120 block, 12% of the frame.
  const block = (x: number, y: number) => x >= 180 && x < 360 && y >= 90 && y < 210;

  it("lays the kept pixels on grey, cropped to them with a small margin, as a JPEG", async () => {
    const out = await composeLookCutout(await samAnswer(block));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.share).toBeCloseTo(0.12, 6);
    const margin = Math.round(LOOK_CROP_MARGIN * Math.max(W, H));
    expect(margin).toBe(18);
    expect([out.width, out.height]).toEqual([180 + 2 * margin, 120 + 2 * margin]);
    const meta = await sharp!(out.jpeg).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.hasAlpha).toBe(false);
    expect(meta.exif).toBeUndefined();

    const { data, info } = await sharp!(out.jpeg).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    // The margin is grey, never the red the transparent pixels carried:
    // nowhere reddish, and the ground itself wherever JPEG's 16-pixel blocks
    // (and the decoder's smoothing across their borders) do not also reach
    // the edge of the object — beside it, JPEG rings.
    const clear = (x: number, y: number) => x < 12 || y < 12 || x >= 212 || y >= 148;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (x >= margin && x < info.width - margin && y >= margin && y < info.height - margin) continue;
        const [r, g, b] = px(x, y);
        expect(r - Math.min(g, b), `(${x}, ${y}) = ${[r, g, b]}`).toBeLessThan(40);
        if (clear(x, y)) for (const c of [r, g, b]) expect(Math.abs(c - 128), `(${x}, ${y}) = ${[r, g, b]}`).toBeLessThanOrEqual(3);
      }
    }
    // The object is still itself.
    const [r, g, b] = px(Math.floor(info.width / 2), Math.floor(info.height / 2));
    expect(b).toBeGreaterThan(220);
    expect(r).toBeLessThan(30);
    expect(g).toBeLessThan(30);
  });

  it("keeps the crop inside the frame when the mask touches its edge", async () => {
    const out = await composeLookCutout(await samAnswer((x, y) => x < 120 && y < 90));
    expect(out.ok).toBe(true);
    if (out.ok) expect([out.width, out.height]).toEqual([138, 108]);
  });

  it("is no look when the mask caught next to nothing", async () => {
    // 0.5% of the frame, under the 1% floor; and nothing at all.
    expect(LOOK_MIN_MASK_SHARE).toBe(0.01);
    expect(await composeLookCutout(await samAnswer((x, y) => x < 30 && y < 30))).toEqual({ ok: false, reason: "empty" });
    expect(await composeLookCutout(await samAnswer(() => false))).toEqual({ ok: false, reason: "empty" });
    // Just over the floor is a look.
    expect((await composeLookCutout(await samAnswer((x, y) => x < 61 && y < 30))).ok).toBe(true);
  });

  it("is no look when the mask took most of the frame: that would be the whole still again", async () => {
    expect(LOOK_MAX_MASK_SHARE).toBe(0.75);
    expect(await composeLookCutout(await samAnswer((x) => x < 480))).toEqual({ ok: false, reason: "whole" });
    expect(await composeLookCutout(await samAnswer(() => true))).toEqual({ ok: false, reason: "whole" });
    // Three-quarters exactly is still a look.
    expect((await composeLookCutout(await samAnswer((x) => x < 450))).ok).toBe(true);
  });

  it("is no look, never a throw, for bytes that are not a picture", async () => {
    expect(await composeLookCutout(Buffer.from("not a png"))).toEqual({ ok: false, reason: "unreadable" });
  });
});
