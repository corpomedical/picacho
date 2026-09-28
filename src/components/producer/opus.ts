// Smaller recordings (2026-09-28, operator: "Fix Aly's listening" — outdoors
// on the app nothing reached the server). A recording used to go up as 16 kHz
// WAV in base64: ~43 KB for every second of speech, ~430 KB for a sentence of
// ten, which a weak outdoor signal can take many seconds to upload, or never.
// Now it goes as Opus in an Ogg file (what voice notes use): ~3 KB a second,
// about a fourteenth of the size, and the transcriber takes it as it is.
//
// The browser's own Opus encoder (WebCodecs AudioEncoder) does the coding;
// this file packs its packets into an Ogg Opus file (RFC 7845) — the part
// that is plain arithmetic, and tested. A browser without the encoder (older
// Safari, an old Android WebView) keeps sending WAV.

// ---------------------------------------------------------------------------
// Ogg (RFC 3533): pages of packets, each page checksummed with Ogg's own CRC.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

export function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
  return crc >>> 0;
}

/** One Ogg page holding whole packets. flags: 2 = first page, 4 = last page. */
export function oggPage(packets: Uint8Array[], granule: number, serial: number, sequence: number, flags: number): Uint8Array {
  const lacing: number[] = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    lacing.push(n);
  }
  if (lacing.length > 255) throw new Error("ogg: too many segments for one page");
  const bodyLength = packets.reduce((a, p) => a + p.length, 0);
  const page = new Uint8Array(27 + lacing.length + bodyLength);
  const view = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  page[4] = 0; // version
  page[5] = flags;
  // The granule position is 64-bit; a recording never needs the top half.
  view.setUint32(6, granule >>> 0, true);
  view.setUint32(10, Math.floor(granule / 2 ** 32), true);
  view.setUint32(14, serial >>> 0, true);
  view.setUint32(18, sequence >>> 0, true);
  view.setUint32(22, 0, true); // the checksum, filled in below
  page[26] = lacing.length;
  page.set(lacing, 27);
  let at = 27 + lacing.length;
  for (const p of packets) {
    page.set(p, at);
    at += p.length;
  }
  view.setUint32(22, oggCrc(page), true);
  return page;
}

/** The Opus identification header (RFC 7845 §5.1). */
export function opusHead(preSkip: number, inputSampleRate: number): Uint8Array {
  const h = new Uint8Array(19);
  const view = new DataView(h.buffer);
  h.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0); // "OpusHead"
  h[8] = 1; // version
  h[9] = 1; // one channel
  view.setUint16(10, preSkip, true);
  view.setUint32(12, inputSampleRate, true);
  view.setInt16(16, 0, true); // output gain
  h[18] = 0; // mapping family 0: mono or stereo
  return h;
}

/** The Opus comment header (RFC 7845 §5.2): a vendor, no comments. */
export function opusTags(vendor = "Picacho"): Uint8Array {
  const v = new TextEncoder().encode(vendor);
  const t = new Uint8Array(8 + 4 + v.length + 4);
  const view = new DataView(t.buffer);
  t.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0); // "OpusTags"
  view.setUint32(8, v.length, true);
  t.set(v, 12);
  view.setUint32(12 + v.length, 0, true);
  return t;
}

export type OpusPacket = { data: Uint8Array; /** Its length in 48 kHz samples (Opus's own clock). */ samples48: number };

/**
 * An Ogg Opus file from encoded packets: the two headers on their own pages,
 * then the audio, about a second of packets a page, each page's granule the
 * 48 kHz sample count up to its last packet. With `length48` (the recording's
 * real length on Opus's clock) the last page trims the encoder's padding off
 * the end, the way RFC 7845 §4.4 allows on the final page.
 */
export function oggOpus(
  packets: OpusPacket[],
  opts: { preSkip?: number; inputSampleRate?: number; serial?: number; length48?: number } = {},
): Uint8Array {
  const serial = opts.serial ?? 0x5049_4341; // "PICA"
  const preSkip = opts.preSkip ?? 312;
  const pages: Uint8Array[] = [];
  let seq = 0;
  pages.push(oggPage([opusHead(preSkip, opts.inputSampleRate ?? 16000)], 0, serial, seq++, 2));
  pages.push(oggPage([opusTags()], 0, serial, seq++, 0));
  let granule = 0;
  let group: Uint8Array[] = [];
  let groupSegments = 0;
  const flush = (last: boolean) => {
    if (group.length === 0 && !last) return;
    pages.push(oggPage(group, granule, serial, seq++, last ? 4 : 0));
    group = [];
    groupSegments = 0;
  };
  packets.forEach((p, i) => {
    const segs = Math.floor(p.data.length / 255) + 1;
    if (groupSegments + segs > 255 || group.length >= 50) flush(false);
    group.push(p.data);
    groupSegments += segs;
    granule += p.samples48;
    if (i === packets.length - 1) {
      if (opts.length48 !== undefined) granule = Math.min(granule, preSkip + opts.length48);
      flush(true);
    }
  });
  if (packets.length === 0) flush(true);
  const total = pages.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of pages) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The browser's encoder.

type EncoderCtor = {
  new (init: { output: (chunk: { byteLength: number; duration?: number | null; copyTo(dst: Uint8Array): void }, meta?: { decoderConfig?: { description?: ArrayBufferView | ArrayBuffer } }) => void; error: (e: unknown) => void }): {
    configure(c: Record<string, unknown>): void;
    encode(d: unknown): void;
    flush(): Promise<void>;
    close(): void;
  };
  isConfigSupported(c: Record<string, unknown>): Promise<{ supported?: boolean }>;
};
type AudioDataCtor = new (init: Record<string, unknown>) => { close(): void };

const CONFIG = { codec: "opus", sampleRate: 16000, numberOfChannels: 1, bitrate: 24000 };
let support: Promise<boolean> | null = null;

/** Whether this browser can make Opus (asked once). */
export function canEncodeOpus(): Promise<boolean> {
  if (support) return support;
  const g = globalThis as unknown as { AudioEncoder?: EncoderCtor; AudioData?: AudioDataCtor };
  if (!g.AudioEncoder || !g.AudioData) return (support = Promise.resolve(false));
  support = g.AudioEncoder.isConfigSupported(CONFIG)
    .then((r) => r.supported === true)
    .catch(() => false);
  return support;
}

/** 16 kHz mono samples → an Ogg Opus file, or null when the browser can't (the caller sends WAV). */
export async function encodeOggOpus(samples: Float32Array): Promise<Uint8Array | null> {
  if (!(await canEncodeOpus())) return null;
  const g = globalThis as unknown as { AudioEncoder: EncoderCtor; AudioData: AudioDataCtor };
  const packets: OpusPacket[] = [];
  let preSkip = 312;
  let failed = false;
  const encoder = new g.AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      // Duration in microseconds → Opus's 48 kHz clock (a 20 ms packet is 960).
      const samples48 = Math.round(((chunk.duration ?? 20000) * 48000) / 1_000_000);
      packets.push({ data, samples48 });
      const desc = meta?.decoderConfig?.description;
      if (desc) {
        const bytes = desc instanceof ArrayBuffer ? new Uint8Array(desc) : new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength);
        // An OpusHead from the encoder carries its real pre-skip.
        if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 8)) === "OpusHead") preSkip = bytes[10] | (bytes[11] << 8);
      }
    },
    error: () => {
      failed = true;
    },
  });
  try {
    encoder.configure(CONFIG);
    const FRAME = 16000; // a second at a time; the encoder cuts its own packets
    for (let at = 0; at < samples.length; at += FRAME) {
      const part = samples.subarray(at, Math.min(samples.length, at + FRAME));
      const data = new g.AudioData({
        format: "f32",
        sampleRate: 16000,
        numberOfFrames: part.length,
        numberOfChannels: 1,
        timestamp: Math.round((at / 16000) * 1_000_000),
        data: part.slice(),
      });
      encoder.encode(data);
      data.close();
    }
    await encoder.flush();
  } catch {
    failed = true;
  } finally {
    try {
      encoder.close();
    } catch {}
  }
  if (failed || packets.length === 0) return null;
  return oggOpus(packets, { preSkip, inputSampleRate: 16000, length48: samples.length * 3 });
}
