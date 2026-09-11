import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normaliseSetPhoto, parseSetPhotoDataUri, photoDataUrl } from "../../../src/lib/sets/photo.ts";
import { SET_PHOTO_BAD_SHAPE, SET_PHOTO_TOO_SMALL, SET_PHOTO_UNREADABLE } from "../../../src/lib/sets/messages.ts";
import { SET_PHOTO_MAX_SIDE_PX } from "../../../src/lib/sets/set-config.ts";
import { browserPrepare, outlineSquare, OUTSIDE_SHADE, PhotoStore, preparePhoto } from "./photos.mts";

// A corpus photo goes through the browser's step (sharp standing in for the
// canvas) and then the server's own, unchanged: the bytes Astra would get.
// Pictures are generated here; no real photo is read.

type SharpFn = (typeof import("sharp"))["default"];
let sharp: SharpFn | null = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  sharp = null;
}

const make = (width: number, height: number, channels: 3 | 4 = 3) =>
  (sharp as SharpFn)({ create: { width, height, channels, background: channels === 4 ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 90, g: 120, b: 150 } } });

describe.skipIf(!sharp)("preparePhoto (sharp)", () => {
  it("hands back what the server's own re-encode makes of the browser's JPEG: at most 2048 px, no metadata", async () => {
    const src = await make(3000, 2000).withMetadata({ exif: { IFD0: { Make: "EvalCam" } } }).jpeg().toBuffer();
    const r = await preparePhoto("ph-1", src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.max(r.photo.width, r.photo.height)).toBe(SET_PHOTO_MAX_SIDE_PX);
    expect(r.photo.dataUrl).toBe(photoDataUrl(r.photo.jpeg));
    expect(r.photo.sha256).toBe(createHash("sha256").update(r.photo.jpeg).digest("hex"));
    expect((await (sharp as SharpFn)(r.photo.jpeg).metadata()).exif).toBeUndefined();
    // The same two product steps over the browser's output give the same bytes.
    const browser = await browserPrepare(src);
    if (!browser.ok) throw new Error(browser.error);
    const parsed = parseSetPhotoDataUri(browser.dataUri);
    if (!parsed.ok) throw new Error(parsed.error);
    const server = await normaliseSetPhoto(parsed.bytes);
    expect(server.ok && server.sha256).toBe(r.photo.sha256);
  });

  it("puts a transparent picture on white, as the canvas does", async () => {
    const r = await preparePhoto("ph-2", await make(800, 800, 4).png().toBuffer());
    if (!r.ok) throw new Error(r.error);
    const { data } = await (sharp as SharpFn)(r.photo.jpeg).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(245);
  });

  it("takes a camera frame of any pixel count, as the browser does: only the file size is bounded", async () => {
    // 9000 × 6000 = 54 MP, a flat picture well under the 40 MB file limit.
    const r = await preparePhoto("big", await make(9000, 6000).jpeg().toBuffer());
    if (!r.ok) throw new Error(r.error);
    expect([r.photo.width, r.photo.height]).toEqual([SET_PHOTO_MAX_SIDE_PX, Math.round((SET_PHOTO_MAX_SIDE_PX * 6000) / 9000)]);
  });

  it("outlineSquare: E's sheet copy of a photo keeps its size, keeps the square as sent, outlines it and dims the rest", async () => {
    const pixels = async (jpeg: Buffer) => {
      const { data, info } = await (sharp as SharpFn)(jpeg).raw().toBuffer({ resolveWithObject: true });
      return { info, at: (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)) };
    };
    const near = (a: number[], b: number[], d: number) => a.every((v, i) => Math.abs(v - b[i]) <= d);
    for (const [w, h, square] of [
      [1200, 800, { left: 200, top: 0, size: 800 }],
      [800, 1200, { left: 0, top: 200, size: 800 }],
    ] as const) {
      const jpeg = await make(w, h).jpeg().toBuffer();
      const copy = await pixels(await outlineSquare({ jpeg, width: w, height: h }, square));
      const sent = await pixels(jpeg);
      expect([copy.info.width, copy.info.height, copy.info.channels]).toEqual([w, h, 3]);
      const mid = [square.left + square.size / 2, square.top + square.size / 2];
      expect(near(copy.at(mid[0], mid[1]), sent.at(mid[0], mid[1]), 3)).toBe(true);
      // Outside the square, on both sides: the photo, darker by the shade.
      const outside = w > h ? [[square.left / 2, h / 2], [w - square.left / 2, h / 2]] : [[w / 2, square.top / 2], [w / 2, h - square.top / 2]];
      for (const [x, y] of outside) {
        const was = sent.at(x, y);
        expect(near(copy.at(x, y), was.map((v) => v * (1 - OUTSIDE_SHADE)), 4)).toBe(true);
      }
      // The square's edge: a white line, just inside it.
      expect(copy.at(square.left + 1, mid[1]).every((v) => v > 240)).toBe(true);
      expect(copy.at(square.left + square.size - 2, mid[1]).every((v) => v > 240)).toBe(true);
      expect(copy.at(mid[0], square.top + 1).every((v) => v > 240)).toBe(true);
      expect(copy.at(mid[0], square.top + square.size - 2).every((v) => v > 240)).toBe(true);
    }
  });

  it("refuses what the product refuses at the form: too small, too wide, unreadable", async () => {
    expect(await preparePhoto("s", await make(600, 900).jpeg().toBuffer())).toEqual({ ok: false, error: SET_PHOTO_TOO_SMALL });
    expect(await preparePhoto("w", await make(3000, 1000).jpeg().toBuffer())).toEqual({ ok: false, error: SET_PHOTO_BAD_SHAPE });
    expect(await preparePhoto("u", Buffer.from("not a picture"))).toEqual({ ok: false, error: SET_PHOTO_UNREADABLE });
  });
});

describe("PhotoStore", () => {
  it("hands a build its photo only while the bytes hash to what it first sent", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const sha256 = createHash("sha256").update(jpeg).digest("hex");
    const store = new PhotoStore();
    store.add({ photoId: "ph-1", jpeg, dataUrl: photoDataUrl(jpeg), width: 1536, height: 1024, sha256 });
    expect(store.dataUrlFor({ photoId: "ph-1", notes: "", sha256 })).toBe(photoDataUrl(jpeg));
    expect(() => store.dataUrlFor({ photoId: "ph-1", notes: "", sha256: "0".repeat(64) })).toThrow(/nothing is resent/);
    expect(() => store.dataUrlFor({ photoId: "ph-9", notes: "", sha256 })).toThrow(/not loaded/);
  });
});
