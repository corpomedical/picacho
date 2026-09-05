// MP4 "faststart" remuxer: move the moov atom (the index) in front of the
// mdat atom (the samples), so a player can start decoding as soon as the
// head of the file arrives instead of needing the tail first.
//
// Why this exists: encoders that stream their output — phone cameras, most
// things writing mdat as they go — only know the sample table once the last
// frame is written, so they park moov at the end. A browser handed such a
// file over one plain fetch cannot show a first frame until the whole file
// (or a range request for the tail) has landed. Reordering the container so
// moov leads fixes that with a byte shuffle: no re-encode, no codec
// knowledge, output is byte-for-byte the same length.
//
// The stco/co64 patch IS the whole trick. Chunk offsets in the sample
// tables are ABSOLUTE file positions pointing into mdat; sliding moov in
// front of mdat pushes mdat down by exactly moov's size, so every entry in
// every table (one stco/co64 per track) must grow by that same delta — or
// the index points at the wrong bytes and the video decodes as garbage.
//
// The failure contract is "return null, leave the file as it is". A file we
// decline to remux still plays, just with the extra round-trip; a file we
// remux wrongly is silently corrupt. So every ambiguity bails: malformed
// atoms, sizes that do not line up, a compressed moov (cmov — the tables we
// would need to patch are deflated), a 32-bit stco entry that would
// overflow past 0xFFFFFFFF after the shift, chunk offsets that do not point
// into the region that actually moves, anything after moov besides free
// space. Neither function ever throws.

type Atom = {
  type: string;
  /** Absolute offset of the atom header. */
  start: number;
  /** Total size including the header. */
  size: number;
};

/**
 * Walk the top-level atom sequence: 4-byte big-endian size + 4-byte type;
 * size 1 means a 64-bit extended size follows; size 0 means "to end of
 * file". Returns null unless the atoms tile the buffer exactly — trailing
 * garbage or a size pointing past the end means we do not understand the
 * file well enough to rearrange it.
 */
function parseTopLevel(bytes: Uint8Array): Atom[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const atoms: Atom[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return null;
    let size = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    let headerSize = 8;
    if (size === 1) {
      // 64-bit largesize in the next 8 bytes. Compare as BigInt before
      // narrowing: a size beyond the buffer is malformed either way, and
      // Number() of a huge value would compare lossily.
      if (offset + 16 > bytes.length) return null;
      // No BigInt literals: the repo targets ES2017 (with esnext lib), so
      // 16n would not compile while BigInt() calls do.
      const large = view.getBigUint64(offset + 8);
      if (large < BigInt(16) || large > BigInt(bytes.length - offset)) return null;
      size = Number(large);
      headerSize = 16;
    } else if (size === 0) {
      // "To end of file" — legal only as the closing atom, which the loop
      // enforces naturally (nothing can follow it).
      size = bytes.length - offset;
    }
    if (size < headerSize || size > bytes.length - offset) return null;
    atoms.push({ type, start: offset, size });
    offset += size;
  }
  return atoms;
}

/**
 * True when a moov atom sits AFTER a mdat atom at the top level — i.e. the
 * file needs its tail before it can start playing. False for anything that
 * does not parse as a clean top-level atom sequence.
 */
export function moovAtTail(bytes: Uint8Array): boolean {
  const atoms = parseTopLevel(bytes);
  if (!atoms) return false;
  const firstMdat = atoms.findIndex((a) => a.type === "mdat");
  if (firstMdat === -1) return false;
  return atoms.some((a, i) => i > firstMdat && a.type === "moov");
}

const FREE_TYPES = new Set(["free", "skip"]);

/** One chunk-offset table found inside the moov copy (offsets moov-relative). */
type ChunkTable = {
  entryBytes: 4 | 8;
  /** Offset of the first entry, relative to the start of the moov copy. */
  entriesStart: number;
  entryCount: number;
};

/**
 * Find every stco (32-bit) and co64 (64-bit) chunk-offset table inside the
 * moov bytes by scanning for the fourcc and validating the shape around it:
 * the 4 bytes before the fourcc must be an atom size that fits inside moov
 * and equals exactly header (8) + version/flags (4) + entry count (4) +
 * count × entry width. A fourcc hit that fails validation is either a
 * stray byte coincidence or a table we do not understand — we cannot tell
 * which, and an unpatched real table means corruption, so the whole remux
 * bails (null). A cmov anywhere means the sample tables are compressed and
 * unpatchable, so that bails too; matching those four bytes by accident in
 * some metadata blob merely costs us the optimization, never correctness.
 */
function findChunkTables(moov: Uint8Array): ChunkTable[] | null {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const tables: ChunkTable[] = [];
  let i = 4;
  while (i + 4 <= moov.length) {
    const a = moov[i];
    const b = moov[i + 1];
    const c = moov[i + 2];
    const d = moov[i + 3];
    // "cmov"
    if (a === 0x63 && b === 0x6d && c === 0x6f && d === 0x76) return null;
    const isStco = a === 0x73 && b === 0x74 && c === 0x63 && d === 0x6f; // "stco"
    const isCo64 = a === 0x63 && b === 0x6f && c === 0x36 && d === 0x34; // "co64"
    if (!isStco && !isCo64) {
      i += 1;
      continue;
    }
    const atomStart = i - 4;
    const size = view.getUint32(atomStart);
    if (size < 16 || size > moov.length - atomStart) return null;
    // Full boxes carry version (1 byte) + flags (3 bytes); the spec defines
    // both as zero for stco/co64, and anything else is a table we do not
    // understand well enough to patch.
    if (view.getUint32(atomStart + 8) !== 0) return null;
    const entryCount = view.getUint32(atomStart + 12);
    const entryBytes = isStco ? 4 : 8;
    if (size !== 16 + entryCount * entryBytes) return null;
    tables.push({ entryBytes, entriesStart: atomStart + 16, entryCount });
    // Resume past the validated table: its entries are raw file offsets and
    // could spell "stco" by coincidence, which would otherwise fail
    // validation above and bail a perfectly good file.
    i = atomStart + size;
  }
  return tables;
}

/**
 * Move a tail moov in front of mdat and patch the chunk-offset tables, in a
 * fresh buffer of the same length. The output atom order is: everything
 * that already preceded mdat (ftyp first, in original order), then moov,
 * then the remaining atoms in original order. Returns null — meaning
 * "leave the file exactly as it is" — whenever the input is already fine
 * or is anything we do not fully understand; see the header comment for
 * the list of bail conditions.
 */
export function faststartRemux(bytes: Uint8Array): Uint8Array | null {
  const atoms = parseTopLevel(bytes);
  if (!atoms) return null;

  // Same stance as the probe: a real MP4 leads with ftyp. A renamed webm or
  // a truncated stream is not something to rearrange.
  if (atoms[0]?.type !== "ftyp") return null;

  const moovs = atoms.filter((a) => a.type === "moov");
  if (moovs.length !== 1) return null;
  const moov = moovs[0];
  const firstMdat = atoms.find((a) => a.type === "mdat");
  if (!firstMdat || firstMdat.start > moov.start) return null; // nothing to fix

  // Everything in [mdat start, moov start) slides down by moov's size when
  // moov moves in front of it; that delta is what every chunk offset must
  // absorb. Atoms AFTER moov keep their absolute positions (moov's size is
  // removed ahead of them and re-inserted ahead of them), so offsets into
  // that region must NOT be patched — but a uniform patch is the only one
  // we can do safely, so anything after moov besides free space bails.
  for (const a of atoms) {
    if (a.start > moov.start && !FREE_TYPES.has(a.type)) return null;
  }

  const delta = moov.size;
  const shiftStart = firstMdat.start;
  // Explicit copy, not .slice(): Node's Buffer is a Uint8Array subclass
  // whose slice() ALIASES memory, and patching an alias would corrupt the
  // caller's input in place. The input is never mutated.
  const moovCopy = new Uint8Array(moov.size);
  moovCopy.set(bytes.subarray(moov.start, moov.start + moov.size));

  const tables = findChunkTables(moovCopy);
  if (!tables) return null;

  const view = new DataView(moovCopy.buffer, moovCopy.byteOffset, moovCopy.byteLength);
  for (const table of tables) {
    for (let n = 0; n < table.entryCount; n++) {
      const at = table.entriesStart + n * table.entryBytes;
      if (table.entryBytes === 4) {
        const value = view.getUint32(at);
        // The entry must point into the region that actually moves; an
        // offset outside [mdat, moov) belongs to bytes we are not shifting,
        // and patching it would corrupt a file we merely misread.
        if (value < shiftStart || value >= moov.start) return null;
        const patched = value + delta;
        // stco is 32-bit. Files near the 4GB line whose offsets would
        // overflow after the shift need a co64 rewrite (a different, bigger
        // surgery) — refusing is the correct move here.
        if (patched > 0xffffffff) return null;
        view.setUint32(at, patched);
      } else {
        const value = view.getBigUint64(at);
        if (value < BigInt(shiftStart) || value >= BigInt(moov.start)) return null;
        view.setBigUint64(at, value + BigInt(delta));
      }
    }
  }

  const out = new Uint8Array(bytes.length);
  // Pre-mdat atoms stay put; the patched moov slides in front of mdat; the
  // [mdat, moov) region shifts down by moov's size; whatever trailed moov
  // (free space only, checked above) lands back at its original offset.
  out.set(bytes.subarray(0, shiftStart), 0);
  out.set(moovCopy, shiftStart);
  out.set(bytes.subarray(shiftStart, moov.start), shiftStart + delta);
  out.set(bytes.subarray(moov.start + moov.size), moov.start + moov.size);
  return out;
}
