import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { hasC2paManifest, mp4TopLevelBoxes } from "./c2pa-probe";

// A minimal MP4: a real ftyp, then a uuid box carrying the JUMBF label the way
// fal's marked deliveries do, then moov.
function box(type: string, payload: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length + 8);
  return Buffer.concat([size, Buffer.from(type, "latin1"), payload]);
}

const marked = Buffer.concat([
  box("ftyp", Buffer.from("isomiso2avc1mp41", "latin1")),
  box("uuid", Buffer.from("  jumdc2pa urn:c2pa:test", "latin1")),
  box("moov", Buffer.alloc(16)),
]);

const bare = Buffer.concat([
  box("ftyp", Buffer.from("isomiso2avc1mp41", "latin1")),
  box("moov", Buffer.alloc(16)),
  box("mdat", Buffer.alloc(32)),
]);

describe("hasC2paManifest", () => {
  it("finds the manifest in a marked file", () => {
    expect(hasC2paManifest(marked)).toBe(true);
  });

  it("reports an unmarked file as unmarked", () => {
    expect(hasC2paManifest(bare)).toBe(false);
  });

  it("is honest about our own shipped marketing renders, which lost theirs to x264", () => {
    // Real Picacho output, re-encoded for the website — and the re-encode
    // stripped the provenance. Pinned as a regression test for the day someone
    // adds a re-encode step to the pipeline and wonders where the marks went.
    const clip = readFileSync("public/hero-band-3.mp4");
    expect(hasC2paManifest(clip)).toBe(false);
    expect(mp4TopLevelBoxes(clip)).not.toContain("uuid");
  });

  it("never throws on junk", () => {
    expect(hasC2paManifest(Buffer.alloc(0))).toBe(false);
    expect(hasC2paManifest(Buffer.from("not a video at all"))).toBe(false);
    expect(mp4TopLevelBoxes(Buffer.from([1, 2, 3]))).toEqual([]);
  });
});

describe("mp4TopLevelBoxes", () => {
  it("reads the box order, so a missing uuid is visible", () => {
    expect(mp4TopLevelBoxes(marked)).toEqual(["ftyp", "uuid", "moov"]);
    expect(mp4TopLevelBoxes(bare)).toEqual(["ftyp", "moov", "mdat"]);
  });
});
