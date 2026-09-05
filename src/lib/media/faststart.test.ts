import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { faststartRemux, moovAtTail } from "./faststart";

// Fixtures (committed, ~6.8KB each): the SAME half-second testsrc+sine
// encode run twice through ffmpeg 6.0, once plain and once with
// `-movflags +faststart`:
//
//   ffmpeg -f lavfi -i "testsrc=duration=0.5:size=64x64:rate=12" \
//          -f lavfi -i "sine=frequency=440:duration=0.5" \
//          -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p \
//          -c:a aac -b:a 24k -shortest [-movflags +faststart] <out>
//
// Two tracks, so two stco tables — the multi-track patch path is exercised,
// not just the single-table one. Because both files are the same encode,
// ffmpeg's faststart output is ground truth for OUR remux of the tail-moov
// file: ffmpeg's own faststart pass is the same algorithm (slide moov in
// front of mdat, add moov's size to every chunk offset), so the sample
// tables must come out identical.
//
// What the ground-truth test compares, and why not whole-file bytes: ffmpeg
// parks its 8-byte `free` placeholder AFTER the moved moov (ftyp moov free
// mdat) while we keep pre-mdat atoms where they were (ftyp free moov mdat).
// Same total bytes ahead of mdat either way, so mdat lands at the same
// offset and the stco entries agree exactly — but a whole-file compare
// would trip over the free atom's position, which no player cares about.
// So: atom type sequence with free/skip filtered out, plus the full
// chunk-offset tables. That is exactly the set of things a decoder reads.

const tailMoov = readFileSync(new URL("./__fixtures__/tail-moov.mp4", import.meta.url));
const ffmpegFaststart = readFileSync(new URL("./__fixtures__/tail-moov.faststart.mp4", import.meta.url));

// -- Independent MP4 readers for verification -------------------------------
// Deliberately NOT the module's own parser: faststart.ts finds stco by a
// validated fourcc scan, these walk the real container hierarchy
// (moov → trak → mdia → minf → stbl). Two different routes agreeing on the
// same tables is the point.

type DevAtom = { type: string; start: number; size: number; hdr: number };

function atoms(buf: Uint8Array, start: number, end: number): DevAtom[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: DevAtom[] = [];
  let o = start;
  while (o + 8 <= end) {
    let size = view.getUint32(o);
    const type = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]);
    let hdr = 8;
    if (size === 1) {
      size = Number(view.getBigUint64(o + 8));
      hdr = 16;
    } else if (size === 0) {
      size = end - o;
    }
    if (size < hdr || o + size > end) break;
    out.push({ type, start: o, size, hdr });
    o += size;
  }
  return out;
}

function topLevelTypes(buf: Uint8Array): string[] {
  return atoms(buf, 0, buf.length).map((a) => a.type);
}

/** All stco/co64 tables under moov, entries as bigints for uniform compare. */
function chunkTables(buf: Uint8Array): { kind: string; entries: bigint[] }[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const containers = new Set(["moov", "trak", "mdia", "minf", "stbl"]);
  const tables: { kind: string; entries: bigint[] }[] = [];
  const walk = (start: number, end: number) => {
    for (const a of atoms(buf, start, end)) {
      if (containers.has(a.type)) {
        walk(a.start + a.hdr, a.start + a.size);
      } else if (a.type === "stco" || a.type === "co64") {
        const count = view.getUint32(a.start + 12);
        const width = a.type === "stco" ? 4 : 8;
        const entries: bigint[] = [];
        for (let n = 0; n < count; n++) {
          const at = a.start + 16 + n * width;
          entries.push(width === 4 ? BigInt(view.getUint32(at)) : view.getBigUint64(at));
        }
        tables.push({ kind: a.type, entries });
      }
    }
  };
  const moov = atoms(buf, 0, buf.length).find((a) => a.type === "moov");
  if (moov) walk(moov.start + moov.hdr, moov.start + moov.size);
  return tables;
}

const withoutFree = (types: string[]) => types.filter((t) => t !== "free" && t !== "skip");

describe("moovAtTail", () => {
  it("spots the tail moov in the raw encode", () => {
    expect(moovAtTail(tailMoov)).toBe(true);
  });

  it("is false for ffmpeg's faststarted twin", () => {
    expect(moovAtTail(ffmpegFaststart)).toBe(false);
  });

  it("is false for garbage", () => {
    expect(moovAtTail(new TextEncoder().encode("RIFF....WEBPVP8 not a video at all"))).toBe(false);
    expect(moovAtTail(new Uint8Array(4))).toBe(false);
    expect(moovAtTail(new Uint8Array(0))).toBe(false);
  });
});

describe("faststartRemux", () => {
  it("moves moov ahead of mdat without changing the length", () => {
    const out = faststartRemux(tailMoov);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(tailMoov.length);
    expect(moovAtTail(out!)).toBe(false);
    const types = topLevelTypes(out!);
    expect(types[0]).toBe("ftyp");
    expect(types.indexOf("moov")).toBeLessThan(types.indexOf("mdat"));
  });

  it("matches ffmpeg's own +faststart output where a decoder looks", () => {
    const out = faststartRemux(tailMoov)!;
    // Atom order modulo free padding (see header comment for why the free
    // atom sits on different sides of moov)...
    expect(withoutFree(topLevelTypes(out))).toEqual(withoutFree(topLevelTypes(ffmpegFaststart)));
    // ...and the chunk-offset tables byte-for-value: both tracks, every
    // entry. Same encode + same algorithm means exact equality, no slack.
    const mine = chunkTables(out);
    const theirs = chunkTables(ffmpegFaststart);
    expect(mine.length).toBeGreaterThanOrEqual(2); // video + audio track
    expect(mine).toEqual(theirs);
  });

  it("returns null for a file that is already faststarted", () => {
    expect(faststartRemux(ffmpegFaststart)).toBeNull();
    // And its own output, round-tripped, needs no further fixing.
    expect(faststartRemux(faststartRemux(tailMoov)!)).toBeNull();
  });

  it("returns null for garbage rather than throwing", () => {
    expect(faststartRemux(new TextEncoder().encode("RIFF....WEBPVP8 not a video at all"))).toBeNull();
    expect(faststartRemux(new Uint8Array(4))).toBeNull();
    expect(faststartRemux(new Uint8Array(0))).toBeNull();
    // A truncated MP4: valid start, then a size that runs past the end.
    expect(faststartRemux(tailMoov.subarray(0, tailMoov.length - 100))).toBeNull();
  });
});
