import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { CROP_MIN_EDGE, FRAME_EDGE, boxFromMask, boxFromReading, boxToPixels, coverageOf, cropFrame, padBox, prepareFrame } from "./crop";
import { MOMENTS_PER_PACKSHOT, MOMENTS_PER_SHOT, momentTimes } from "./sampling";
import { frameArgs } from "./frames";

vi.setConfig({ testTimeout: 30_000 });

// T0's local half (crop.ts), the moments a shot is read at (sampling.ts)
// and the ffmpeg call that takes them (frames.ts).

describe("boxes as the reader draws them: [ymin, xmin, ymax, xmax] on 0–1000", () => {
  it("become shares of the frame", () => {
    expect(boxFromReading([100, 200, 600, 700])).toEqual({ x: 0.2, y: 0.1, w: 0.5, h: 0.5 });
  });

  it("are clamped to the frame", () => {
    expect(boxFromReading([-50, 0, 1200, 500])).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
  });

  it("anything that is not a box is null", () => {
    expect(boxFromReading(null)).toBeNull();
    expect(boxFromReading([1, 2, 3])).toBeNull();
    expect(boxFromReading([500, 500, 400, 600])).toBeNull();
    expect(boxFromReading(["a", 0, 10, 10])).toBeNull();
  });

  it("coverage is the box's share of the frame", () => {
    expect(coverageOf({ x: 0, y: 0, w: 0.5, h: 0.2 })).toBeCloseTo(0.1);
    expect(coverageOf(null)).toBeNull();
  });

  it("padding grows the box but keeps it inside the frame", () => {
    const b = padBox({ x: 0, y: 0.5, w: 0.5, h: 0.5 }, 0.1);
    expect(b.x).toBe(0);
    expect(b.y).toBeCloseTo(0.45);
    expect(b.x + b.w).toBeCloseTo(0.55);
    expect(b.y + b.h).toBeLessThanOrEqual(1);
  });

  it("pixels are whole, at least 1 × 1 and inside the picture", () => {
    expect(boxToPixels({ x: 0.999, y: 0.999, w: 0.0001, h: 0.0001 }, 100, 100)).toEqual({ left: 99, top: 99, width: 1, height: 1 });
    expect(boxToPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 200, 100)).toEqual({ left: 50, top: 50, width: 100, height: 50 });
  });
});

describe("pictures", () => {
  it("a frame is made upright JPEG no bigger than FRAME_EDGE", async () => {
    const big = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#123456" } }).png().toBuffer();
    const f = (await prepareFrame(big))!;
    expect(Math.max(f.width, f.height)).toBe(FRAME_EDGE);
    expect(f.bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it("an unreadable picture is null, never a throw", async () => {
    expect(await prepareFrame(Buffer.from("not a picture"))).toBeNull();
  });

  it("a small product is cropped and enlarged so its words can be read", async () => {
    const frame = (await prepareFrame(await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#fff" } }).jpeg().toBuffer()))!;
    const crop = (await cropFrame(frame, { x: 0.4, y: 0.4, w: 0.1, h: 0.2 }))!;
    expect(Math.max(crop.width, crop.height)).toBe(CROP_MIN_EDGE);
  });

  it("the SAM fallback's mask is read back as the tight box round what it kept", async () => {
    // 100 × 50, opaque only in x 20..39, y 10..29.
    const alpha = Buffer.alloc(100 * 50 * 4);
    for (let y = 10; y < 30; y++) for (let x = 20; x < 40; x++) alpha[(y * 100 + x) * 4 + 3] = 255;
    const png = await sharp(alpha, { raw: { width: 100, height: 50, channels: 4 } }).png().toBuffer();
    const box = (await boxFromMask(png))!;
    expect(box.x).toBeCloseTo(0.2);
    expect(box.y).toBeCloseTo(0.2);
    expect(box.w).toBeCloseTo(0.2);
    expect(box.h).toBeCloseTo(0.4);
    const empty = await sharp(Buffer.alloc(10 * 10 * 4), { raw: { width: 10, height: 10, channels: 4 } }).png().toBuffer();
    expect(await boxFromMask(empty)).toBeNull();
  });
});

describe("the moments a shot is read at (S1: 'Checked at 3 moments per shot')", () => {
  it("a 5 s shot: 0.4 s in, the middle, 0.4 s before the end", () => {
    expect(momentTimes(5)).toEqual([0.4, 2.5, 4.6]);
    expect(momentTimes(5)).toHaveLength(MOMENTS_PER_SHOT);
  });

  it("t = 0 is never read (on a frame lane it IS the approved still)", () => {
    expect(momentTimes(5).every((t) => t > 0)).toBe(true);
  });

  it("a packshot gets one moment more, spread evenly", () => {
    expect(momentTimes(5, { packshot: true })).toEqual([0.4, 1.8, 3.2, 4.6]);
    expect(momentTimes(5, { packshot: true })).toHaveLength(MOMENTS_PER_PACKSHOT);
  });

  it("a clip too short for the edges is read once in its middle; no length, no moments", () => {
    expect(momentTimes(0.8)).toEqual([0.4]);
    expect(momentTimes(0)).toEqual([]);
    expect(momentTimes(Number.NaN)).toEqual([]);
  });
});

describe("ffmpeg's arguments for one moment", () => {
  it("seek, one frame, scaled down only, JPEG", () => {
    const args = frameArgs("/tmp/in.mp4", "/tmp/out.jpg", 2.5);
    expect(args.slice(0, 7)).toEqual(["-y", "-v", "error", "-ss", "2.50", "-i", "/tmp/in.mp4"]);
    expect(args).toContain("-frames:v");
    expect(args.join(" ")).toContain("scale=w='min(1536,iw)'");
    expect(args.at(-1)).toBe("/tmp/out.jpg");
  });

  it("never seeks before the start", () => {
    expect(frameArgs("a", "b", -3)[4]).toBe("0.00");
  });
});
