import { describe, expect, it } from "vitest";
import { frameTimeUs, muxMp4 } from "./studio-mp4";

// The frame-exact recording (2026-09-30, "Why is she walking weird and jumpy?"). Measured on the same 5 s walk in
// the harness (ffmpeg showinfo): the real-time recorder gave 125 frames 4–46 ms apart in front, 23 frames with gaps
// of 1,001 ms in a background tab, 11–134 ms apart on a slow machine; the frame-exact one gives 120 frames exactly
// 1/24 s apart, byte-identical in all three.

/** The boxes of an MP4, walked by their sizes: [type, offset, size]. */
function boxes(b: Uint8Array, from = 0, to = b.length): [string, number, number][] {
  const out: [string, number, number][] = [];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let at = from; at + 8 <= to; ) {
    const size = dv.getUint32(at);
    out.push([String.fromCharCode(...b.subarray(at + 4, at + 8)), at, size]);
    if (size < 8) break;
    at += size;
  }
  return out;
}
function find(b: Uint8Array, path: string[]): [number, number] {
  let from = 0, to = b.length;
  for (const name of path) {
    const hit = boxes(b, from, to).find(([t]) => t === name);
    if (!hit) throw new Error("no " + name);
    const [, at, size] = hit;
    // Containers hold boxes straight after their header; stsd holds its entry after 8 more bytes.
    from = at + 8;
    to = at + size;
  }
  return [from, to];
}
const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at);

describe("frame-exact timing", () => {
  it("frame i at exactly i/fps, every frame the same length (±1 µs of rounding), never from the clock", () => {
    const t = Array.from({ length: 120 }, (_, i) => frameTimeUs(i, 24));
    expect(t[0]).toEqual({ timestamp: 0, duration: 41667 });
    expect(t[119].timestamp + t[119].duration).toBe(5_000_000);
    const gaps = t.slice(1).map((x, i) => x.timestamp - t[i].timestamp);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
    for (let i = 0; i < t.length; i++) expect(t[i].duration).toBe((t[i + 1]?.timestamp ?? 5_000_000) - t[i].timestamp);
  });
});

describe("muxMp4", () => {
  const avcC = new Uint8Array([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80]);
  const samples = Array.from({ length: 120 }, (_, i) => ({ data: new Uint8Array(10 + (i % 7)).fill(i), key: i % 48 === 0 }));
  const mp4 = muxMp4({ width: 1280, height: 720, fps: 24, avcC, samples });

  it("is ftyp, moov, mdat — the index first, so it plays as it streams", () => {
    expect(boxes(mp4).map(([t]) => t)).toEqual(["ftyp", "moov", "mdat"]);
    expect(boxes(mp4).reduce((n, [, , size]) => n + size, 0)).toBe(mp4.length);
  });

  it("every frame lasts exactly 1/24 s: one time-to-sample entry for all 120, the length 5 s", () => {
    const [mdhd] = find(mp4, ["moov", "trak", "mdia", "mdhd"]);
    expect(u32(mp4, mdhd + 12)).toBe(24000); // timescale
    expect(u32(mp4, mdhd + 16)).toBe(120 * 1000); // duration
    const [stts] = find(mp4, ["moov", "trak", "mdia", "minf", "stbl", "stts"]);
    expect([u32(mp4, stts + 4), u32(mp4, stts + 8), u32(mp4, stts + 12)]).toEqual([1, 120, 1000]);
    const [mvhd] = find(mp4, ["moov", "mvhd"]);
    expect([u32(mp4, mvhd + 12), u32(mp4, mvhd + 16)]).toEqual([1000, 5000]);
  });

  it("indexes every sample where it lies, marks the key frames, and carries the encoder's avcC", () => {
    const [stsz] = find(mp4, ["moov", "trak", "mdia", "minf", "stbl", "stsz"]);
    expect(u32(mp4, stsz + 8)).toBe(120);
    expect(Array.from({ length: 120 }, (_, i) => u32(mp4, stsz + 12 + i * 4))).toEqual(samples.map((s) => s.data.length));
    const [stco] = find(mp4, ["moov", "trak", "mdia", "minf", "stbl", "stco"]);
    const first = u32(mp4, stco + 8);
    expect(mp4.subarray(first, first + samples[0].data.length)).toEqual(samples[0].data);
    const last = first + samples.slice(0, 119).reduce((n, s) => n + s.data.length, 0);
    expect(mp4.subarray(last, last + samples[119].data.length)).toEqual(samples[119].data);
    const [stss] = find(mp4, ["moov", "trak", "mdia", "minf", "stbl", "stss"]);
    expect([u32(mp4, stss + 4), u32(mp4, stss + 8), u32(mp4, stss + 12), u32(mp4, stss + 16)]).toEqual([3, 1, 49, 97]);
    const at = Buffer.from(mp4).indexOf(Buffer.from("avcC"));
    expect(mp4.subarray(at + 4, at + 4 + avcC.length)).toEqual(avcC);
  });

  it("refuses to make a file with no frames or a frame rate that isn't whole", () => {
    expect(() => muxMp4({ width: 2, height: 2, fps: 24, avcC, samples: [] })).toThrow();
    expect(() => muxMp4({ width: 2, height: 2, fps: 23.976, avcC, samples })).toThrow();
  });
});
