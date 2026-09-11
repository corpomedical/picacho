import { describe, expect, it } from "vitest";
import { aspectHeld, EXIF_TAGS, mergeExif, readExifFocal, uprightSize, verticalFovDegFrom35mm } from "./exif-fov.mts";
import { photoTruth } from "./match-truth.mts";
import { preparePhoto } from "./photos.mts";
import { fovWithin } from "./pass-bars.mts";

describe("verticalFovDegFrom35mm", () => {
  it("a 3:2 image at 50 mm equivalent is 26.99° tall", () => {
    expect(verticalFovDegFrom35mm(50, 6000, 4000)).toBeCloseTo(26.99, 2);
  });

  it("swaps width and height for a rotated (portrait) orientation", () => {
    const landscape = verticalFovDegFrom35mm(26, 4032, 3024);
    const rotated = verticalFovDegFrom35mm(26, 4032, 3024, 6);
    const portrait = verticalFovDegFrom35mm(26, 3024, 4032);
    expect(rotated).toBeCloseTo(portrait, 10);
    expect(portrait).toBeGreaterThan(landscape);
    expect(uprightSize(4032, 3024, 6)).toEqual({ width: 3024, height: 4032 });
    expect(uprightSize(4032, 3024, 3)).toEqual({ width: 4032, height: 3024 });
  });

  it("refuses nonsense", () => {
    expect(() => verticalFovDegFrom35mm(0, 10, 10)).toThrow();
  });
});

describe("fovWithin (±20%)", () => {
  it("includes the edges and excludes past them", () => {
    expect(fovWithin(48, 40)).toBe(true);
    expect(fovWithin(32, 40)).toBe(true);
    expect(fovWithin(48.01, 40)).toBe(false);
    expect(fovWithin(31.99, 40)).toBe(false);
  });
});

// A synthetic EXIF block, written by hand: a TIFF header, IFD0 (the
// orientation and the Exif IFD's offset), the Exif IFD (the 35 mm focal
// length and the focal length), and the focal length's RATIONAL after it.
type Blob = { le: boolean; header?: boolean; orientation?: number; f35?: number; f35Type?: 3 | 4; focal?: [number, number] };
function exifBlob(o: Blob): Uint8Array {
  const ifd0: [number, number, number][] = [];
  if (o.orientation !== undefined) ifd0.push([EXIF_TAGS.orientation, 3, o.orientation]);
  const exif: [number, number, number][] = [];
  if (o.f35 !== undefined) exif.push([EXIF_TAGS.focal35mm, o.f35Type ?? 3, o.f35]);
  const ifd0At = 8;
  const n0 = ifd0.length + 1;
  const exifAt = ifd0At + 2 + n0 * 12 + 4;
  const n1 = exif.length + (o.focal ? 1 : 0);
  const ratAt = exifAt + 2 + n1 * 12 + 4;
  const size = ratAt + 8;
  const view = new DataView(new ArrayBuffer(size));
  view.setUint16(0, o.le ? 0x4949 : 0x4d4d, false);
  view.setUint16(2, 42, o.le);
  view.setUint32(4, ifd0At, o.le);
  const entry = (at: number, tag: number, type: number, value: number) => {
    view.setUint16(at, tag, o.le);
    view.setUint16(at + 2, type, o.le);
    view.setUint32(at + 4, 1, o.le);
    // A SHORT sits left-justified in the value field.
    if (type === 3) view.setUint16(at + 8, value, o.le);
    else view.setUint32(at + 8, value, o.le);
  };
  view.setUint16(ifd0At, n0, o.le);
  ifd0.forEach(([t, ty, v], i) => entry(ifd0At + 2 + i * 12, t, ty, v));
  entry(ifd0At + 2 + ifd0.length * 12, EXIF_TAGS.exifIfd, 4, exifAt);
  view.setUint16(exifAt, n1, o.le);
  exif.forEach(([t, ty, v], i) => entry(exifAt + 2 + i * 12, t, ty, v));
  if (o.focal) {
    entry(exifAt + 2 + exif.length * 12, EXIF_TAGS.focalLength, 5, ratAt);
    view.setUint32(ratAt, o.focal[0], o.le);
    view.setUint32(ratAt + 4, o.focal[1], o.le);
  }
  const tiff = new Uint8Array(view.buffer);
  if (!o.header) return tiff;
  const out = new Uint8Array(6 + tiff.length);
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0]);
  out.set(tiff, 6);
  return out;
}

describe("readExifFocal (a TIFF-IFD walk over a synthetic EXIF block)", () => {
  it("reads the 35 mm focal length, the focal length and the orientation, in either byte order, with or without the Exif header", () => {
    for (const le of [true, false]) {
      for (const header of [true, false]) {
        expect(readExifFocal(exifBlob({ le, header, orientation: 6, f35: 26, focal: [57, 10] }))).toEqual({ focal35mm: 26, focalMm: 5.7, orientation: 6 });
      }
    }
  });

  it("takes a 35 mm focal length written as a LONG, and a block that holds only some of the tags", () => {
    expect(readExifFocal(exifBlob({ le: true, f35: 50, f35Type: 4 }))).toEqual({ focal35mm: 50, focalMm: null, orientation: null });
    expect(readExifFocal(exifBlob({ le: false, focal: [4500, 1000] }))).toEqual({ focal35mm: null, focalMm: 4.5, orientation: null });
  });

  it("a 35 mm focal length of 0 is unknown, and so is a focal length over 0", () => {
    expect(readExifFocal(exifBlob({ le: true, f35: 0, focal: [5, 0] }))).toEqual({ focal35mm: null, focalMm: null, orientation: null });
  });

  it("never throws: nothing, junk, a truncated block, the wrong byte order or an offset past the end read as nothing", () => {
    const none = { focal35mm: null, focalMm: null, orientation: null };
    expect(readExifFocal(null)).toEqual(none);
    expect(readExifFocal(new Uint8Array([1, 2, 3]))).toEqual(none);
    expect(readExifFocal(new TextEncoder().encode("Exif\0\0not a tiff header at all"))).toEqual(none);
    const whole = exifBlob({ le: true, header: true, orientation: 1, f35: 26, focal: [57, 10] });
    for (let cut = 0; cut < whole.length; cut += 3) expect(() => readExifFocal(whole.subarray(0, cut))).not.toThrow();
    expect(readExifFocal(whole.subarray(0, 30)).focal35mm).toBeNull();
    const wrongOrder = whole.slice();
    wrongOrder[6] = 0x41;
    expect(readExifFocal(wrongOrder)).toEqual(none);
    // The Exif IFD's offset pointing past the end.
    const far = exifBlob({ le: true, f35: 26 });
    new DataView(far.buffer).setUint32(8 + 2 + 8, 60_000, true);
    expect(readExifFocal(far)).toEqual(none);
  });

  it("reads a block that sits at an offset inside a larger buffer", () => {
    const blob = exifBlob({ le: true, header: true, f35: 35 });
    const big = new Uint8Array(blob.length + 11);
    big.set(blob, 11);
    expect(readExifFocal(big.subarray(11)).focal35mm).toBe(35);
  });
});

describe("mergeExif: match.json's EXIF against the file's own", () => {
  const file = { focal35mm: 26, focalMm: 5.7, orientation: 1 };

  it("match.json wins where it gives a figure; the file fills what it leaves out, field by field", () => {
    expect(mergeExif(null, file, 1)).toEqual({ focal35mm: 26, focalMm: 5.7, source: "file", disagreements: [] });
    expect(mergeExif({ focal35mm: 26, focalMm: null, orientation: null }, file, 1)).toEqual({ focal35mm: 26, focalMm: 5.7, source: "match.json", disagreements: [] });
    expect(mergeExif({ focal35mm: null, focalMm: 5.7, orientation: 1 }, { focal35mm: null, focalMm: null, orientation: null }, 1)).toEqual({ focal35mm: null, focalMm: 5.7, source: null, disagreements: [] });
  });

  it("reports every field both give that differs, and uses match.json's", () => {
    const m = mergeExif({ focal35mm: 28, focalMm: 6.0, orientation: 6 }, file, 1);
    expect(m.focal35mm).toBe(28);
    expect(m.source).toBe("match.json");
    expect(m.disagreements).toEqual(["35 mm focal length: match.json 28 mm, the file 26 mm", "focal length: match.json 6 mm, the file 5.7 mm", "orientation: match.json 6, the file 1"]);
    // Within what EXIF stores (whole millimetres) and 0.05 mm: no disagreement.
    expect(mergeExif({ focal35mm: 26.2, focalMm: 5.74, orientation: 1 }, file, 1).disagreements).toEqual([]);
  });
});

describe("aspectHeld: preparing a photo only scales it", () => {
  it("holds within a pixel for the product's own fits, either way up", () => {
    expect(aspectHeld({ width: 4032, height: 3024 }, { width: 2048, height: 1536 })).toBe(true);
    expect(aspectHeld({ width: 3024, height: 4032 }, { width: 1536, height: 2048 })).toBe(true);
    // 2400 × 1000 → 2048 × 853 (853.33 rounded): a third of a pixel.
    expect(aspectHeld({ width: 2400, height: 1000 }, { width: 2048, height: 853 })).toBe(true);
    expect(aspectHeld({ width: 1000, height: 1000 }, { width: 1000, height: 1000 })).toBe(true);
  });

  it("fails for a crop, a stretch, or a photo turned the other way", () => {
    expect(aspectHeld({ width: 4032, height: 3024 }, { width: 2048, height: 1530 })).toBe(false);
    expect(aspectHeld({ width: 4032, height: 3024 }, { width: 1536, height: 2048 })).toBe(false);
    expect(aspectHeld({ width: 3000, height: 2000 }, { width: 0, height: 0 })).toBe(false);
  });
});

type SharpFn = (typeof import("sharp"))["default"];
let sharp: SharpFn | null = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  sharp = null;
}

describe.skipIf(!sharp)("a real file's EXIF (sharp writes it, the reader reads it back)", () => {
  const picture = (w: number, h: number) => (sharp as SharpFn)({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 110, b: 100 } } });

  it("reads the lens from sharp's own EXIF block, and the truth from the file's stored size", async () => {
    const file = await picture(1536, 1024).withExif({ IFD2: { FocalLengthIn35mmFilm: "26", FocalLength: "57/10" } }).jpeg().toBuffer();
    const meta = await (sharp as SharpFn)(file).metadata();
    expect(readExifFocal(meta.exif)).toMatchObject({ focal35mm: 26, focalMm: 5.7 });
    const t = await photoTruth("mt-1", file, null);
    expect(t).toMatchObject({ source: "file", focal35mm: 26, orientation: 1, stored: { width: 1536, height: 1024 }, disagreements: [] });
    expect(t.exifFovDeg).toBeCloseTo(verticalFovDegFrom35mm(26, 1536, 1024), 12);
  });

  it("a phone's portrait (stored landscape, orientation 6) is measured upright, and sent upright at the same shape, with no EXIF", async () => {
    const file = await picture(1600, 1200).withMetadata({ orientation: 6 }).withExif({ IFD2: { FocalLengthIn35mmFilm: "50", FocalLength: "50/1" } }).jpeg().toBuffer();
    const t = await photoTruth("mt-2", file, { focal35mm: null, focalMm: null, orientation: 1 });
    expect(t.orientation).toBe(6);
    expect(t.upright).toEqual({ width: 1200, height: 1600 });
    // Portrait: a taller field of view than the same lens held landscape.
    expect(t.exifFovDeg).toBeCloseTo(verticalFovDegFrom35mm(50, 1200, 1600), 12);
    expect(t.disagreements).toEqual(["orientation: match.json 1, the file 6"]);
    const prepared = await preparePhoto("mt-2", file);
    if (!prepared.ok) throw new Error(prepared.error);
    expect([prepared.photo.width, prepared.photo.height]).toEqual([1200, 1600]);
    expect(aspectHeld(t.upright, prepared.photo)).toBe(true);
    expect((await (sharp as SharpFn)(prepared.photo.jpeg).metadata()).exif).toBeUndefined();
  });

  it("match.json's figure is used, and the difference with the file reported", async () => {
    const file = await picture(1200, 800).withExif({ IFD2: { FocalLengthIn35mmFilm: "24" } }).jpeg().toBuffer();
    const t = await photoTruth("mt-3", file, { focal35mm: 35, focalMm: null, orientation: null });
    expect(t.focal35mm).toBe(35);
    expect(t.disagreements).toEqual(["35 mm focal length: match.json 35 mm, the file 24 mm"]);
    expect(t.exifFovDeg).toBeCloseTo(verticalFovDegFrom35mm(35, 1200, 800), 12);
  });

  it("a file with no EXIF and nothing declared has no truth: outside the FOV bar", async () => {
    const t = await photoTruth("mt-4", await picture(1200, 800).png().toBuffer(), null);
    expect(t.exifFovDeg).toBeNull();
    expect(t.source).toBeNull();
  });
});
