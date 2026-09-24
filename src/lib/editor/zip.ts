// A minimal ZIP writer for the render bundle: STORED entries (no
// compression — the payload is H.264 and AAC, which do not shrink), CRC-32
// from node:zlib. HeyGen's renderer takes a project as one .zip; this avoids
// a dependency for ~60 lines of a format that has not changed since 1993.
//
// Limits it does not lift: no ZIP64, so the archive and every entry stay
// under 4 GiB and 65,535 entries. HeyGen's direct upload stops at 200 MB
// anyway (bundle.ts checks that first).

import { crc32 } from "node:zlib";

export type ZipEntry = { name: string; data: Uint8Array };

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const VERSION = 20;
const UTF8_FLAG = 0x0800;
// 1980-01-01 00:00, the format's epoch: a fixed stamp keeps the bytes
// reproducible (same bundle → same checksum → HeyGen's idempotency holds).
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith("/") || entry.name.split("/").includes("..")) {
      throw new Error(`zip: refusing entry name ${JSON.stringify(entry.name)}`);
    }
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    const crc = crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIG, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, ...centrals, end]));
}
