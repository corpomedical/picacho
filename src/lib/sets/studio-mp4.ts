// Helios Studio · the frame-exact recording (2026-09-30, operator: "Why is she
// walking weird and jumpy?"). The Studio used to record "Video with your
// character" in real time: MediaRecorder on a canvas stream, a frame drawn
// whenever the clock said so. Measured in the harness on the same 5 s walk
// (ffmpeg showinfo on the file): in front, 125 frames 4–46 ms apart; with
// the tab in the background, 23 frames and gaps of 1,001 ms (Chrome runs a
// hidden tab's timers once a second); with a slow machine (CPU ×6), 158
// frames 11–134 ms apart. Kling copies the motion it is given, so a skipped
// or bunched frame became a jump in the take.
//
// Now every frame of the range is drawn in turn at its own time (never the
// clock), encoded by the browser's own H.264 encoder (WebCodecs) and put in
// an MP4 here, at exactly 1/fps each. Pure: no DOM, testable in Node. The
// muxer is ours (a few boxes, ISO/IEC 14496-12 and -15), so no dependency.

/** A frame's timestamp and duration in microseconds, as WebCodecs takes them: frame i at exactly i/fps. */
export function frameTimeUs(i: number, fps: number): { timestamp: number; duration: number } {
  const at = (k: number) => Math.round((k * 1_000_000) / fps);
  return { timestamp: at(i), duration: at(i + 1) - at(i) };
}

/** Encoded samples in decode order: one H.264 access unit each, length-prefixed (WebCodecs' "avc" format). */
export type Mp4Sample = { data: Uint8Array; key: boolean };

// ---------------- boxes ----------------

const enc = new TextEncoder();
function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}
function u16(n: number): Uint8Array {
  return new Uint8Array([(n >>> 8) & 255, n & 255]);
}
function cat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function box(type: string, ...body: Uint8Array[]): Uint8Array {
  const inner = cat(body);
  return cat([u32(inner.length + 8), enc.encode(type), inner]);
}
function full(type: string, version: number, flags: number, ...body: Uint8Array[]): Uint8Array {
  return box(type, new Uint8Array([version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255]), ...body);
}
const zeros = (n: number) => new Uint8Array(n);
const MATRIX = cat([0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32));

/**
 * A playable MP4 (moov first, one video track) from H.264 samples at a
 * constant frame rate: every sample lasts exactly 1/fps (one stts entry).
 * `avcC` is the encoder's decoder configuration (WebCodecs'
 * decoderConfig.description).
 */
export function muxMp4(a: { width: number; height: number; fps: number; avcC: Uint8Array; samples: readonly Mp4Sample[] }): Uint8Array {
  const n = a.samples.length;
  if (!n) throw new Error("no frames");
  if (!Number.isInteger(a.fps) || a.fps <= 0) throw new Error("fps");
  const timescale = a.fps * 1000, delta = 1000;
  const mediaDur = n * delta;
  const movieDur = Math.round((n * 1000) / a.fps);
  const ftyp = box("ftyp", enc.encode("isom"), u32(512), enc.encode("isomiso2avc1mp41"));
  const avc1 = box(
    "avc1",
    zeros(6), u16(1), // reserved, data_reference_index
    zeros(16), // pre_defined, reserved, pre_defined[3]
    u16(a.width), u16(a.height),
    u32(0x00480000), u32(0x00480000), u32(0), u16(1), // 72 dpi, reserved, frame_count
    zeros(32), // compressorname
    u16(0x0018), u16(0xffff),
    box("avcC", a.avcC),
  );
  const keys = a.samples.flatMap((s, i) => (s.key ? [i + 1] : []));
  const stbl = (offset: number) =>
    box(
      "stbl",
      full("stsd", 0, 0, u32(1), avc1),
      full("stts", 0, 0, u32(1), u32(n), u32(delta)),
      full("stss", 0, 0, u32(keys.length), ...keys.map(u32)),
      full("stsc", 0, 0, u32(1), u32(1), u32(n), u32(1)),
      full("stsz", 0, 0, u32(0), u32(n), ...a.samples.map((s) => u32(s.data.length))),
      full("stco", 0, 0, u32(1), u32(offset)),
    );
  const moov = (offset: number) =>
    box(
      "moov",
      full("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(movieDur), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2)),
      box(
        "trak",
        full("tkhd", 0, 3, u32(0), u32(0), u32(1), u32(0), u32(movieDur), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(a.width * 65536), u32(a.height * 65536)),
        box(
          "mdia",
          full("mdhd", 0, 0, u32(0), u32(0), u32(timescale), u32(mediaDur), u16(0x55c4), u16(0)),
          full("hdlr", 0, 0, u32(0), enc.encode("vide"), zeros(12), enc.encode("VideoHandler\0")),
          box("minf", full("vmhd", 0, 1, zeros(8)), box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))), stbl(offset)),
        ),
      ),
    );
  // The moov's size does not depend on the offset's value, so measure once and write it.
  const offset = ftyp.length + moov(0).length + 8;
  return cat([ftyp, moov(offset), u32(8 + a.samples.reduce((s, x) => s + x.data.length, 0)), enc.encode("mdat"), ...a.samples.map((s) => s.data)]);
}

/** H.264 profiles to try, best first: High 4.0 (to 1920 × 1080), High 5.1 (the widest formats), Main 4.0, Baseline 3.1. */
export const STUDIO_AVC_CODECS = ["avc1.640028", "avc1.640033", "avc1.4d0028", "avc1.42001f"] as const;
