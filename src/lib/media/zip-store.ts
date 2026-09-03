// A dependency-free ZIP writer, STORE method only (no compression).
//
// Layers export ("Download all") ships PNGs, which are already deflated —
// compressing them again buys nothing and would cost a library this
// sandbox cannot install. A stored ZIP is the 1989 format every unzip on
// every OS reads: local headers, central directory, end record, CRC-32.
// Pure and synchronous, so it is unit-tested byte for byte.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; bytes: Uint8Array };

/** DOS date/time fields for a fixed, deterministic timestamp — the archive's
 *  bytes then depend only on its contents, which is what makes it testable. */
const DOS_TIME = 0x0000; // 00:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (9 << 5) | 3; // 2026-09-03

export function zipStore(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;

    const local = new Uint8Array(30 + name.length + size);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // flags: UTF-8 names
    lv.setUint16(8, 0, true); // method: store
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra length
    local.set(name, 30);
    local.set(entry.bytes, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory header signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true); // local header offset
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const out = new Uint8Array(offset + centralSize + 22);
  let p = 0;
  for (const l of locals) { out.set(l, p); p += l.length; }
  for (const c of centrals) { out.set(c, p); p += c.length; }
  out.set(end, p);
  return out;
}

// Streaming form of the same archive, for responses that must not be
// buffered: a 2K split is 20–80 MB of PNG and the platform caps a buffered
// function response at 4.5 MB, while a streamed body is exempt. Local
// headers carry the data-descriptor flag (bit 3) so CRC and sizes trail each
// entry — they are not known until its bytes have passed through — and the
// central directory, which records the real values, closes the stream.
// Entries may arrive as an async iterable so storage reads can be pipelined.
export function zipStoreStream(entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const centrals: Uint8Array[] = [];
  let offset = 0;
  let count = 0;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const entry of entries) {
          const name = encoder.encode(entry.name);
          const crc = crc32(entry.bytes);
          const size = entry.bytes.length;
          const localOffset = offset;

          const local = new Uint8Array(30 + name.length);
          const lv = new DataView(local.buffer);
          lv.setUint32(0, 0x04034b50, true);
          lv.setUint16(4, 20, true);
          lv.setUint16(6, 0x0808, true); // UTF-8 names + data descriptor follows
          lv.setUint16(8, 0, true);
          lv.setUint16(10, DOS_TIME, true);
          lv.setUint16(12, DOS_DATE, true);
          // crc/sizes zero here; the descriptor after the data carries them
          lv.setUint16(26, name.length, true);
          local.set(name, 30);
          controller.enqueue(local);
          controller.enqueue(entry.bytes);
          const desc = new Uint8Array(16);
          const dv = new DataView(desc.buffer);
          dv.setUint32(0, 0x08074b50, true);
          dv.setUint32(4, crc, true);
          dv.setUint32(8, size, true);
          dv.setUint32(12, size, true);
          controller.enqueue(desc);
          offset += local.length + size + desc.length;

          const central = new Uint8Array(46 + name.length);
          const cv = new DataView(central.buffer);
          cv.setUint32(0, 0x02014b50, true);
          cv.setUint16(4, 20, true);
          cv.setUint16(6, 20, true);
          cv.setUint16(8, 0x0808, true);
          cv.setUint16(10, 0, true);
          cv.setUint16(12, DOS_TIME, true);
          cv.setUint16(14, DOS_DATE, true);
          cv.setUint32(16, crc, true);
          cv.setUint32(20, size, true);
          cv.setUint32(24, size, true);
          cv.setUint16(28, name.length, true);
          cv.setUint32(42, localOffset, true);
          central.set(name, 46);
          centrals.push(central);
          count++;
        }
        const centralSize = centrals.reduce((n, c) => n + c.length, 0);
        for (const c of centrals) controller.enqueue(c);
        const end = new Uint8Array(22);
        const ev = new DataView(end.buffer);
        ev.setUint32(0, 0x06054b50, true);
        ev.setUint16(8, count, true);
        ev.setUint16(10, count, true);
        ev.setUint32(12, centralSize, true);
        ev.setUint32(16, offset, true);
        controller.enqueue(end);
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
