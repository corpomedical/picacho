import { describe, expect, it } from "vitest";
import { mp3DurationSeconds } from "./audio-duration";

// A minimal CBR stream: MPEG1 Layer III headers at 128kbps/44.1kHz are
// 0xFF 0xFB 0x90 0x00 and each frame is floor(144*128000/44100) = 417 bytes.
function cbrStream(frames: number): Uint8Array {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  const out = new Uint8Array(417 * frames);
  for (let i = 0; i < frames; i++) out.set(frame, i * 417);
  return out;
}

describe("mp3DurationSeconds", () => {
  it("reads a CBR stream: bytes × 8 / bitrate", () => {
    const s = cbrStream(100); // 41,700 bytes at 128kbps -> 2.606s
    expect(mp3DurationSeconds(s)).toBeCloseTo((41700 * 8) / 128000, 3);
  });

  it("skips an ID3v2 header without counting it as audio", () => {
    const tagBody = 100;
    const tag = new Uint8Array(10 + tagBody);
    tag.set([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, tagBody]); // syncsafe 100
    const s = cbrStream(100);
    const both = new Uint8Array(tag.length + s.length);
    both.set(tag); both.set(s, tag.length);
    expect(mp3DurationSeconds(both)).toBeCloseTo((41700 * 8) / 128000, 3);
  });

  it("returns null for garbage rather than a guess", () => {
    expect(mp3DurationSeconds(new Uint8Array(5000))).toBeNull();
    expect(mp3DurationSeconds(new Uint8Array([0xff, 0xfb]))).toBeNull();
  });

  it("returns null when the first two frames disagree — VBR is not guessed at", () => {
    const s = cbrStream(2);
    s[417 + 2] = 0xa0; // second frame claims 160kbps
    expect(mp3DurationSeconds(s)).toBeNull();
  });

  it("matches the clip it was written against: 184,782 bytes at 128kbps ≈ 11.55s", () => {
    // The real ElevenLabs long-line probe from 2026-09-04, reduced to its
    // arithmetic: same header, same byte count.
    const s = cbrStream(Math.round(184782 / 417));
    expect(mp3DurationSeconds(s)!).toBeGreaterThan(11.3);
    expect(mp3DurationSeconds(s)!).toBeLessThan(11.8);
  });
});
