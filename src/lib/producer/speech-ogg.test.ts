import { describe, expect, it } from "vitest";
import { oggOpus } from "../../components/producer/opus";
import { oggOpusSeconds, readSpokenInput } from "./speech";

// The server reads an Ogg Opus recording's length from the file (2026-09-28):
// Opus is a tenth of WAV's size, so the byte cap alone no longer bounds it.
function file(seconds: number): Uint8Array {
  const packets = Array.from({ length: Math.ceil((seconds * 48000 + 312) / 960) }, () => ({ data: new Uint8Array(30), samples48: 960 }));
  return oggOpus(packets, { preSkip: 312, length48: Math.round(seconds * 48000) });
}
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

describe("Ogg Opus length on the server", () => {
  it("reads the real length from the last page, less the pre-skip", () => {
    expect(oggOpusSeconds(file(2.5))).toBeCloseTo(2.5, 5);
    expect(oggOpusSeconds(file(41))).toBeCloseTo(41, 5);
  });

  it("says null for anything that isn't Ogg Opus", () => {
    expect(oggOpusSeconds(new Uint8Array(100))).toBeNull();
    expect(oggOpusSeconds(new TextEncoder().encode("OggS but nothing after it at all, really nothing"))).toBeNull();
  });

  it("uses the file's length, not the client's claim", () => {
    const r = readSpokenInput({ data: b64(file(12)), mime: "audio/ogg", seconds: 1 });
    expect(r && "input" in r ? r.input.seconds : null).toBe(12);
  });

  it("refuses an Ogg recording far over a minute, whatever it claims", () => {
    const r = readSpokenInput({ data: b64(file(300)), mime: "audio/ogg", seconds: 5 });
    expect(r).toEqual({ error: "That was too long. Keep it under a minute." });
  });

  it("still trusts the claim for a format it can't read (WebM)", () => {
    const r = readSpokenInput({ data: b64(new Uint8Array(4000)), mime: "audio/webm", seconds: 7 });
    expect(r && "input" in r ? r.input.seconds : null).toBe(7);
  });
});
