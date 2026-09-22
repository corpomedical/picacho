import { describe, expect, it } from "vitest";
import {
  LOOK_CROP_MARGIN,
  LOOK_MAX_MASK_SHARE,
  LOOK_MIN_MASK_SHARE,
  clearRegion,
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
    const out = await composeLookCutout(await samAnswer(block), []);
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
    // the edge of the object — beside it, JPEG rings. Every margin pixel is
    // compared plainly and a failing one is written down: an expect call for
    // each, message and all, took 0.3–1.2 s alone and up to 7.1 s with three
    // full suites running at once (2026-09-22); now 20–40 ms alone.
    const clear = (x: number, y: number) => x < 12 || y < 12 || x >= 212 || y >= 148;
    const wrong: string[] = [];
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (x >= margin && x < info.width - margin && y >= margin && y < info.height - margin) continue;
        const [r, g, b] = px(x, y);
        if (!(r - Math.min(g, b) < 40)) wrong.push(`(${x}, ${y}) = ${[r, g, b]}: reddish`);
        if (clear(x, y) && [r, g, b].some((c) => !(Math.abs(c - 128) <= 3))) wrong.push(`(${x}, ${y}) = ${[r, g, b]}: not the ground`);
      }
    }
    expect(wrong.slice(0, 5), `${wrong.length} pixels`).toEqual([]);
    // The object is still itself.
    const [r, g, b] = px(Math.floor(info.width / 2), Math.floor(info.height / 2));
    expect(b).toBeGreaterThan(220);
    expect(r).toBeLessThan(30);
    expect(g).toBeLessThan(30);
  });

  it("lays several answers of the same still together: a pixel kept by any is kept, and the crop spans them all", async () => {
    // Two objects, cut in two requests: a 120 × 120 block each, 8% of the frame.
    const left = (x: number, y: number) => x >= 60 && x < 180 && y >= 90 && y < 210;
    const right = (x: number, y: number) => x >= 420 && x < 540 && y >= 30 && y < 150;
    const out = await composeLookCutout([await samAnswer(left), await samAnswer(right)], []);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.share).toBeCloseTo(0.16, 6);
    const margin = Math.round(LOOK_CROP_MARGIN * Math.max(W, H));
    expect([out.width, out.height]).toEqual([540 - 60 + 2 * margin, 210 - 30 + 2 * margin]);
    // Both blocks are blue in it, and the gap between them grey.
    const { data, info } = await sharp!(out.jpeg).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const i = ((y - 30 + margin) * info.width + (x - 60 + margin)) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    for (const [x, y] of [[120, 150], [480, 90]]) {
      const [r, , b] = at(x, y);
      expect(b - r, `${x},${y}`).toBeGreaterThan(150);
    }
    const [r, g, b] = at(300, 120);
    expect(Math.max(Math.abs(r - 128), Math.abs(g - 128), Math.abs(b - 128)), "the gap").toBeLessThan(12);
    // One answer alone keeps its own block only.
    const one = await composeLookCutout([await samAnswer(left)], []);
    expect(one.ok && one.share).toBeCloseTo(0.08, 6);
  });

  it("answers that are not the same size are no look, and no answer at all is no look", async () => {
    const small = await sharp!({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).png().toBuffer();
    expect(await composeLookCutout([await samAnswer(block), small], [])).toEqual({ ok: false, reason: "unreadable" });
    expect(await composeLookCutout([], [])).toEqual({ ok: false, reason: "unreadable" });
  });

  it("keeps the crop inside the frame when the mask touches its edge", async () => {
    const out = await composeLookCutout(await samAnswer((x, y) => x < 120 && y < 90), []);
    expect(out.ok).toBe(true);
    if (out.ok) expect([out.width, out.height]).toEqual([138, 108]);
  });

  it("is no look when the mask caught next to nothing", async () => {
    // 0.5% of the frame, under the 1% floor; and nothing at all.
    expect(LOOK_MIN_MASK_SHARE).toBe(0.01);
    expect(await composeLookCutout(await samAnswer((x, y) => x < 30 && y < 30), [])).toEqual({ ok: false, reason: "empty" });
    expect(await composeLookCutout(await samAnswer(() => false), [])).toEqual({ ok: false, reason: "empty" });
    // Just over the floor is a look.
    expect((await composeLookCutout(await samAnswer((x, y) => x < 61 && y < 30), [])).ok).toBe(true);
  });

  it("is no look when the mask took most of the frame: that would be the whole still again", async () => {
    expect(LOOK_MAX_MASK_SHARE).toBe(0.75);
    expect(await composeLookCutout(await samAnswer((x) => x < 480), [])).toEqual({ ok: false, reason: "whole" });
    expect(await composeLookCutout(await samAnswer(() => true), [])).toEqual({ ok: false, reason: "whole" });
    // Three-quarters exactly is still a look.
    expect((await composeLookCutout(await samAnswer((x) => x < 450), [])).ok).toBe(true);
  });

  it("is no look, never a throw, for bytes that are not a picture", async () => {
    expect(await composeLookCutout(Buffer.from("not a png"), [])).toEqual({ ok: false, reason: "unreadable" });
  });
});

describe.skipIf(!sharp)("never the person (sharp)", () => {
  // A car (x 60–330, y 90–240) and, beside it, a person SAM 2 took in with
  // it (x 380–460, y 30–280), both in the one mask. The person's region, as
  // look-cutout.ts gives it: x 360–480 of 600, y 15–294 of 300.
  const car = (x: number, y: number) => x >= 60 && x < 330 && y >= 90 && y < 240;
  const person = (x: number, y: number) => x >= 380 && x < 460 && y >= 30 && y < 280;
  const region = { u0: 360 / W, v0: 15 / H, u1: 480 / W, v1: 294 / H };

  async function pixels(jpeg: Buffer) {
    const { data, info } = await sharp!(jpeg).raw().toBuffer({ resolveWithObject: true });
    return { info, at: (x: number, y: number) => [0, 1, 2].map((c) => data[(y * info.width + x) * info.channels + c]) };
  }

  it("clears the person's region whatever the mask kept there: the crop is the car's alone", async () => {
    const out = await composeLookCutout(await samAnswer((x, y) => car(x, y) || person(x, y)), [region]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Measured and cropped without the person: the car and its 18 px margin.
    expect(out.share).toBeCloseTo((270 * 150) / (W * H), 6);
    expect([out.width, out.height]).toEqual([270 + 36, 150 + 36]);
    // Without the region, the same mask crops round both.
    const both = await composeLookCutout(await samAnswer((x, y) => car(x, y) || person(x, y)), []);
    expect(both.ok && [both.width, both.height]).toEqual([400 + 36, 250 + 36]);
  });

  it("keeps the part of an object outside the region, and lays the part inside it on grey", async () => {
    // The person stands in front of the car's right end: the region takes
    // the car from x 300 on.
    const inFront = { u0: 300 / W, v0: 0, u1: 420 / W, v1: 1 };
    const out = await composeLookCutout(await samAnswer(car), [inFront]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect([out.width, out.height]).toEqual([240 + 36, 150 + 36]);
    const { at } = await pixels(out.jpeg);
    // The car is still blue well inside what is left of it.
    const [r, g, b] = at(100, 90);
    expect(b).toBeGreaterThan(220);
    expect(r + g).toBeLessThan(60);
    // Its end past x 300 is gone: the margin beyond it is ground, not car.
    for (const [cr, cg, cb] of [at(out.width - 4, 90), at(out.width - 4, 40), at(out.width - 4, 140)]) {
      for (const c of [cr, cg, cb]) expect(Math.abs(c - 128)).toBeLessThanOrEqual(3);
    }
  });

  it("is no look when all the mask kept was the person", async () => {
    expect(await composeLookCutout(await samAnswer(person), [region])).toEqual({ ok: false, reason: "empty" });
  });
});

describe("clearRegion", () => {
  it("makes the region transparent, rounded outward to whole pixels, and touches nothing else", () => {
    const w = 10;
    const h = 4;
    const data = Buffer.alloc(w * h * 4, 255);
    clearRegion(data, w, h, 4, { u0: 0.25, v0: 0.3, u1: 0.51, v1: 0.5 });
    const cleared: string[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] === 0) cleared.push(`${x},${y}`);
    // x from floor(2.5) = 2 to ceil(5.1) = 6, y from floor(1.2) = 1 to ceil(2) = 2.
    expect(cleared).toEqual(["2,1", "3,1", "4,1", "5,1"]);
    // Colour is left as it was; only alpha goes.
    expect(data[(1 * w + 2) * 4]).toBe(255);
  });
});
