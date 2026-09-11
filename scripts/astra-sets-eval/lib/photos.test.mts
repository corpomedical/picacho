import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normaliseSetPhoto, parseSetPhotoDataUri, photoDataUrl } from "../../../src/lib/sets/photo.ts";
import { SET_PHOTO_BAD_SHAPE, SET_PHOTO_TOO_SMALL, SET_PHOTO_UNREADABLE } from "../../../src/lib/sets/messages.ts";
import { SET_PHOTO_MAX_SIDE_PX } from "../../../src/lib/sets/set-config.ts";
import { browserPrepare, PhotoStore, preparePhoto } from "./photos.mts";

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
