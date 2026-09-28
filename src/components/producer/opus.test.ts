import { describe, expect, it } from "vitest";
import { oggCrc, oggOpus, oggPage, opusHead, opusTags } from "./opus";

// The Ogg Opus packing (2026-09-28, smaller recordings for a weak signal).
function readPages(file: Uint8Array) {
  const pages: { flags: number; granule: number; seq: number; segments: number[]; body: Uint8Array; crcOk: boolean }[] = [];
  let at = 0;
  while (at < file.length) {
    expect(String.fromCharCode(...file.slice(at, at + 4))).toBe("OggS");
    const view = new DataView(file.buffer, file.byteOffset + at);
    const flags = file[at + 5];
    const granule = view.getUint32(6, true) + view.getUint32(10, true) * 2 ** 32;
    const seq = view.getUint32(18, true);
    const crc = view.getUint32(22, true);
    const n = file[at + 26];
    const segments = [...file.slice(at + 27, at + 27 + n)];
    const bodyLen = segments.reduce((a, b) => a + b, 0);
    const page = file.slice(at, at + 27 + n + bodyLen);
    const zeroed = page.slice();
    zeroed.set([0, 0, 0, 0], 22);
    pages.push({ flags, granule, seq, segments, body: page.slice(27 + n), crcOk: oggCrc(zeroed) === crc });
    at += page.length;
  }
  return pages;
}

describe("Ogg Opus", () => {
  it("uses Ogg's own CRC (not zlib's)", () => {
    // The known value for "OggS" with this polynomial (0x04c11db7, no reflection).
    expect(oggCrc(new TextEncoder().encode("123456789"))).toBe(0x89a1897f);
  });

  it("writes the two Opus headers the way RFC 7845 lays them out", () => {
    const head = opusHead(312, 16000);
    expect(String.fromCharCode(...head.slice(0, 8))).toBe("OpusHead");
    expect(head[8]).toBe(1);
    expect(head[9]).toBe(1);
    expect(head[10] | (head[11] << 8)).toBe(312);
    expect(new DataView(head.buffer).getUint32(12, true)).toBe(16000);
    expect(String.fromCharCode(...opusTags().slice(0, 8))).toBe("OpusTags");
  });

  it("laces a packet longer than 255 bytes across segments", () => {
    const page = oggPage([new Uint8Array(600)], 0, 1, 0, 0);
    expect([...page.slice(27, 27 + page[26])]).toEqual([255, 255, 90]);
    const exact = oggPage([new Uint8Array(510)], 0, 1, 0, 0);
    expect([...exact.slice(27, 27 + exact[26])]).toEqual([255, 255, 0]);
  });

  it("packs headers and audio into checksummed pages with a running 48 kHz granule", () => {
    const packets = Array.from({ length: 120 }, (_, i) => ({ data: new Uint8Array(40 + (i % 7)).fill(i), samples48: 960 }));
    const file = oggOpus(packets, { preSkip: 312 });
    const pages = readPages(file);
    expect(pages.every((p) => p.crcOk)).toBe(true);
    expect(pages[0].flags).toBe(2); // first page: the head
    expect(pages[1].granule).toBe(0); // the tags
    expect(pages[pages.length - 1].flags).toBe(4); // last page
    expect(pages[pages.length - 1].granule).toBe(120 * 960);
    expect(pages.map((p) => p.seq)).toEqual(pages.map((_, i) => i));
    // All 120 packets are there, in order.
    const audioPackets = pages.slice(2).reduce((a, p) => a + p.segments.filter((s) => s < 255).length, 0);
    expect(audioPackets).toBe(120);
    // Two seconds of speech come to a few KB, not the ~64 KB of WAV.
    expect(file.length).toBeLessThan(8000);
  });

  it("trims the encoder's padding off the end on the last page only", () => {
    // 2.5 s at 16 kHz = 120,000 samples at 48 kHz; the encoder made 127 packets
    // (121,920 samples) of which 312 are its pre-skip and the rest padding.
    const packets = Array.from({ length: 127 }, () => ({ data: new Uint8Array(40), samples48: 960 }));
    const pages = readPages(oggOpus(packets, { preSkip: 312, length48: 120_000 }));
    expect(pages[pages.length - 1].granule).toBe(312 + 120_000);
    // Pages before the last keep their running count.
    const middle = pages.slice(2, -1).map((p) => p.granule);
    expect(middle.every((g, i) => g === (i + 1) * 50 * 960)).toBe(true);
    // Never lengthened: a stated length past the packets changes nothing.
    const longer = readPages(oggOpus(packets, { preSkip: 312, length48: 200_000 }));
    expect(longer[longer.length - 1].granule).toBe(127 * 960);
  });
});
