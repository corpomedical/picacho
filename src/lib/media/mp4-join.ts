// Joining MP4 clips into one file without re-encoding (Helios Film,
// "Download as one file", canvas page H, 2026-09-16). The board's rule: the
// beats are stitched in the browser, "same codec, no re-encode", and the
// stitch is proven before it is promised. A film's beats come from one
// engine, so their streams share one codec setup, and a join is then a
// matter of containers: the samples are copied as they are, one after
// another, and the sample tables are written once for the whole film.
//
// What a join needs, and refuses without:
// - Every file progressive (one moov, no fragments), each track with one
//   sample description and at most one plain edit.
// - The same tracks in the same order, each with the same timescale, the
//   same sample description (its codec setup, colour and size), the same
//   sample groups and the same edit offset (the decoder delay a B-frame
//   stream or an AAC encoder starts with). The bitrate notes every encode
//   writes its own figures into (the btrt box, and an esds descriptor's
//   buffer size and bitrates) may differ: they describe, and never set up.
// - Sound that runs the length of its picture, to within a sound frame, in
//   every clip but the last (below).
// Anything else is refused, never guessed at: a wrong join plays as
// garbage, a refused one leaves the beats to be downloaded one by one.
//
// What the joined file is: the first file's ftyp; one moov at the front
// (faststart) with, for each track, the first file's track and media
// headers, its sample description with the film's own bitrate notes (the
// average over every sample, the highest peak and buffer any clip noted),
// the whole film's sample tables (one sample to a chunk) and one edit that
// starts at the shared offset and shows the rest of the track;
// then one mdat with each file's kept samples in their own order. Sample
// groups are carried: an AAC track's roll group says each sound frame needs
// the one before it, and without it Apple's players (QuickTime, Safari,
// iOS) start the sound 1,088 samples later than its edit says, 25 ms into
// the sound at 44.1 kHz. Not carried: metadata, sdtp, and any other
// top-level box, a C2PA manifest among them (content credentials are bound
// to the clip's own bytes, so no join could keep them valid).
//
// Why the beats stay in step: the picture keeps every frame, and each
// clip's first picture follows the previous clip's last, since each clip
// presents [offset, offset + its decode length) of its own media time.
// Sound cannot simply follow on. A clip's sound starts with the encoder's
// priming (23 to 46 ms of AAC warm-up, hidden by the clip's own edit and
// needed to decode what follows) and usually runs a little past its
// picture, so copied whole, each later beat's sound would start late by
// both, and later at every seam: 53 to 99 ms late by the third beat on six
// real three-beat films. So the sound of every clip but the last is cut
// where its picture ends, at the whole sound frame nearest the running end
// of the pictures, and every beat's sound then starts within half a sound
// frame of its picture, however many beats there are. The priming is kept,
// so the next beat's sound decodes exactly; its warm-up plays where the
// earlier beat's sound was cut, fading that sound out, as the picture
// cuts. A last sound frame said to be shorter than the rest (an encoder's
// padded end) is never kept before another beat: it decodes to a whole
// frame, which would run over.
//
// Pure, relative-import only, Uint8Array in and out: the browser and the
// tests run the same code. Never throws.

export type JoinResult =
  | { ok: true; bytes: Uint8Array; seconds: number }
  | { ok: false; reason: "empty" | "unreadable" | "different" | "short-sound" };

type Box = { type: string; start: number; body: number; end: number };

class Unreadable extends Error {}

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** The boxes that tile [from, to): refused unless they tile it exactly. */
function boxesIn(b: Uint8Array, v: DataView, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at < to) {
    if (at + 8 > to) throw new Unreadable();
    let size = v.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) throw new Unreadable();
      const large = v.getBigUint64(at + 8);
      if (large > BigInt(to - at)) throw new Unreadable();
      size = Number(large);
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) throw new Unreadable();
    out.push({ type: fourcc(b, at + 4), start: at, body: at + header, end: at + size });
    at += size;
  }
  return out;
}

const only = (boxes: Box[], type: string): Box | null => {
  const hits = boxes.filter((x) => x.type === type);
  if (hits.length > 1) throw new Unreadable();
  return hits[0] ?? null;
};
const need = (boxes: Box[], type: string): Box => {
  const box = only(boxes, type);
  if (!box) throw new Unreadable();
  return box;
};

type Sample = { offset: number; size: number; delta: number; cto: number; sync: boolean };

type TrackIn = {
  handler: string;
  timescale: number;
  language: number;
  tkhd: Uint8Array;
  hdlr: Uint8Array;
  mediaHeader: Uint8Array;
  dinf: Uint8Array;
  stsd: Uint8Array;
  /** The sample description, less its bitrate notes, for comparing. */
  stsdKey: string;
  /** Where the bitrate notes sit in `stsd`: the btrt box's body, and an esds's 11 rate bytes. */
  btrtAt: number | null;
  esdsAt: number | null;
  /** The highest buffer size and peak bitrate the notes give. */
  rates: { buffer: number; max: number };
  samples: Sample[];
  hasCtts: boolean;
  /** The sample group descriptions (sgpd) and the tables' headers, for comparing. */
  groupsKey: string;
  /** The sample group descriptions, copied as they are. */
  groupDescriptions: Uint8Array[];
  /** Each sample-to-group table (sbgp): its fields before the entries, and each sample's group. */
  groups: { header: Uint8Array; indices: number[] }[];
  /** The one plain edit: its length in the movie's timescale, and where in the media it starts. */
  edit: { duration: number; mediaTime: number } | null;
};

type FileIn = { bytes: Uint8Array; ftyp: Uint8Array; movieTimescale: number; tracks: TrackIn[] };

/** Sample entries whose own fields run this many bytes before their child boxes. */
const ENTRY_FIELDS: Record<string, number> = {
  avc1: 78,
  avc3: 78,
  hvc1: 78,
  hev1: 78,
  vp09: 78,
  av01: 78,
  mp4v: 78,
  mp4a: 28,
  "ac-3": 28,
  "ec-3": 28,
  Opus: 28,
  fLaC: 28,
};

const hexOf = (x: Uint8Array) => Array.from(x, (y) => y.toString(16).padStart(2, "0")).join("");

/**
 * Where an esds box's DecoderConfigDescriptor keeps its buffer size (3
 * bytes) and its peak and average bitrates (4 each), or null when the box
 * is not laid out as expected (it is then compared whole).
 */
function esdsRatesAt(b: Uint8Array, esds: Box): number | null {
  // A descriptor: its tag, a size in up to four 7-bit bytes, then its body.
  const descriptor = (at: number, tag: number) => {
    if (at >= esds.end || b[at] !== tag) return null;
    let size = 0;
    let p = at + 1;
    for (let i = 0; ; i++) {
      if (i === 4 || p >= esds.end) return null;
      const x = b[p++];
      size = size * 128 + (x & 0x7f);
      if (x < 0x80) break;
    }
    return p + size <= esds.end ? { body: p, end: p + size } : null;
  };
  const es = descriptor(esds.body + 4, 0x03);
  // ES_ID, then flags for optional fields an MP4 file never sets (where one
  // is set, the box is compared whole), then the decoder config.
  if (!es || es.end - es.body < 3 || b[es.body + 2] & 0xe0) return null;
  const config = descriptor(es.body + 3, 0x04);
  // objectTypeIndication and streamType come before the rates.
  return config && config.end - config.body >= 13 ? config.body + 2 : null;
}

/**
 * The one sample description, read for joining: a key to compare it by,
 * with its bitrate notes left out, and where those notes sit.
 */
function describe(b: Uint8Array, v: DataView, stsd: Box): Pick<TrackIn, "stsdKey" | "btrtAt" | "esdsAt" | "rates"> {
  if (stsd.end - stsd.body < 8 || v.getUint32(stsd.body + 4) !== 1) throw new Unreadable();
  const [entry] = boxesIn(b, v, stsd.body + 8, stsd.end);
  if (!entry || entry.end !== stsd.end) throw new Unreadable();
  const rates = { buffer: 0, max: 0 };
  const fields = ENTRY_FIELDS[entry.type];
  if (fields === undefined || entry.body + fields > entry.end) {
    return { stsdKey: `${entry.type}:${hexOf(b.subarray(entry.body, entry.end))}`, btrtAt: null, esdsAt: null, rates };
  }
  // A QuickTime sound description (version 1 or 2) has more fields than we read.
  if (fields === 28 && v.getUint16(entry.body + 8) !== 0) throw new Unreadable();
  let btrtAt: number | null = null;
  let esdsAt: number | null = null;
  const parts: string[] = [];
  for (const kid of boxesIn(b, v, entry.body + fields, entry.end)) {
    if (kid.type === "btrt") {
      if (kid.end - kid.body < 12 || btrtAt !== null) throw new Unreadable();
      btrtAt = kid.body - stsd.start;
      rates.buffer = Math.max(rates.buffer, v.getUint32(kid.body));
      rates.max = Math.max(rates.max, v.getUint32(kid.body + 4));
      continue;
    }
    const bytes = b.slice(kid.start, kid.end);
    const at = kid.type === "esds" ? esdsRatesAt(b, kid) : null;
    if (at !== null) {
      if (esdsAt !== null) throw new Unreadable();
      esdsAt = at - stsd.start;
      rates.buffer = Math.max(rates.buffer, (b[at] << 16) | (b[at + 1] << 8) | b[at + 2]);
      rates.max = Math.max(rates.max, v.getUint32(at + 3));
      bytes.fill(0, at - kid.start, at - kid.start + 11);
    }
    parts.push(hexOf(bytes));
  }
  return { stsdKey: `${entry.type}:${hexOf(b.subarray(entry.body, entry.body + fields))}|${parts.join("|")}`, btrtAt, esdsAt, rates };
}

function readTrack(b: Uint8Array, v: DataView, trak: Box, fileLength: number): TrackIn {
  const kids = boxesIn(b, v, trak.body, trak.end);
  const tkhd = need(kids, "tkhd");
  // Patched in place later (patchTkhd), which reads an 8-byte header.
  if (tkhd.body - tkhd.start !== 8) throw new Unreadable();
  const mdia = need(kids, "mdia");
  const m = boxesIn(b, v, mdia.body, mdia.end);
  const mdhd = need(m, "mdhd");
  const hdlr = need(m, "hdlr");
  const minf = need(m, "minf");
  const mdhdV1 = b[mdhd.body] === 1;
  const timescale = v.getUint32(mdhd.body + (mdhdV1 ? 20 : 12));
  const language = v.getUint16(mdhd.body + (mdhdV1 ? 32 : 20));
  if (timescale === 0) throw new Unreadable();
  const handler = fourcc(b, hdlr.body + 8);

  let edit: TrackIn["edit"] = null;
  const edts = only(kids, "edts");
  if (edts) {
    const elst = need(boxesIn(b, v, edts.body, edts.end), "elst");
    const v1 = b[elst.body] === 1;
    const count = v.getUint32(elst.body + 4);
    if (count > 1) throw new Unreadable();
    if (count === 1) {
      const at = elst.body + 8;
      const duration = v1 ? Number(v.getBigUint64(at)) : v.getUint32(at);
      const mediaTime = v1 ? Number(v.getBigInt64(at + 8)) : v.getInt32(at + 4);
      const rate = v.getInt32(at + (v1 ? 16 : 8));
      // An empty edit (a gap) or a rate other than 1 is more than a join keeps.
      if (mediaTime < 0 || rate !== 0x10000) throw new Unreadable();
      edit = { duration, mediaTime };
    }
  }

  const mi = boxesIn(b, v, minf.body, minf.end);
  const mediaHeader = mi.find((x) => x.type === "vmhd" || x.type === "smhd" || x.type === "nmhd" || x.type === "sthd");
  const dinf = need(mi, "dinf");
  const stbl = need(mi, "stbl");
  if (!mediaHeader) throw new Unreadable();
  const s = boxesIn(b, v, stbl.body, stbl.end);
  const stsd = need(s, "stsd");
  const stts = need(s, "stts");
  const stsc = need(s, "stsc");
  const stsz = need(s, "stsz");
  const ctts = only(s, "ctts");
  const stss = only(s, "stss");
  const stco = only(s, "stco");
  const co64 = only(s, "co64");
  if (!!stco === !!co64) throw new Unreadable();

  // Sizes.
  const fixed = v.getUint32(stsz.body + 4);
  const count = v.getUint32(stsz.body + 8);
  if (fixed === 0 && stsz.body + 12 + count * 4 > stsz.end) throw new Unreadable();
  const sizes = Array.from({ length: count }, (_, i) => (fixed !== 0 ? fixed : v.getUint32(stsz.body + 12 + i * 4)));

  // Decode lengths.
  const deltas: number[] = [];
  const sttsCount = v.getUint32(stts.body + 4);
  if (stts.body + 8 + sttsCount * 8 > stts.end) throw new Unreadable();
  for (let i = 0; i < sttsCount; i++) {
    const n = v.getUint32(stts.body + 8 + i * 8);
    const d = v.getUint32(stts.body + 12 + i * 8);
    if (deltas.length + n > count) throw new Unreadable();
    for (let k = 0; k < n; k++) deltas.push(d);
  }
  if (deltas.length !== count) throw new Unreadable();

  // Composition offsets.
  const ctos = new Array<number>(count).fill(0);
  if (ctts) {
    const signed = b[ctts.body] === 1;
    const n = v.getUint32(ctts.body + 4);
    if (ctts.body + 8 + n * 8 > ctts.end) throw new Unreadable();
    let at = 0;
    for (let i = 0; i < n; i++) {
      const runs = v.getUint32(ctts.body + 8 + i * 8);
      const off = signed ? v.getInt32(ctts.body + 12 + i * 8) : v.getUint32(ctts.body + 12 + i * 8);
      if (at + runs > count) throw new Unreadable();
      for (let k = 0; k < runs; k++) ctos[at++] = off;
    }
    if (at !== count) throw new Unreadable();
  }

  // Sync samples: without stss, every sample is one.
  const sync = new Array<boolean>(count).fill(!stss);
  if (stss) {
    const n = v.getUint32(stss.body + 4);
    if (stss.body + 8 + n * 4 > stss.end) throw new Unreadable();
    for (let i = 0; i < n; i++) {
      const at = v.getUint32(stss.body + 8 + i * 4);
      if (at < 1 || at > count) throw new Unreadable();
      sync[at - 1] = true;
    }
  }

  // Where each sample is: chunks from stsc and stco/co64.
  const table = (stco ?? co64)!;
  const wide = !stco;
  const chunkCount = v.getUint32(table.body + 4);
  if (table.body + 8 + chunkCount * (wide ? 8 : 4) > table.end) throw new Unreadable();
  const chunkAt = (c: number) => (wide ? Number(v.getBigUint64(table.body + 8 + c * 8)) : v.getUint32(table.body + 8 + c * 4));
  const runs = v.getUint32(stsc.body + 4);
  if (stsc.body + 8 + runs * 12 > stsc.end || runs === 0) throw new Unreadable();
  const offsets: number[] = [];
  for (let r = 0; r < runs; r++) {
    const first = v.getUint32(stsc.body + 8 + r * 12);
    const per = v.getUint32(stsc.body + 12 + r * 12);
    const description = v.getUint32(stsc.body + 16 + r * 12);
    const next = r + 1 < runs ? v.getUint32(stsc.body + 20 + r * 12) : chunkCount + 1;
    if (description !== 1 || first < 1 || next <= first || next > chunkCount + 1) throw new Unreadable();
    for (let c = first; c < next; c++) {
      let at = chunkAt(c - 1);
      for (let k = 0; k < per; k++) {
        const i = offsets.length;
        if (i >= count) throw new Unreadable();
        offsets.push(at);
        at += sizes[i];
      }
    }
  }
  if (offsets.length !== count) throw new Unreadable();

  const samples: Sample[] = sizes.map((size, i) => {
    if (offsets[i] + size > fileLength) throw new Unreadable();
    return { offset: offsets[i], size, delta: deltas[i], cto: ctos[i], sync: sync[i] };
  });

  // Sample groups: descriptions as they are, and each sample's group (0,
  // no group, past a table's last entry).
  const groupDescriptions = s.filter((x) => x.type === "sgpd").map((x) => b.slice(x.start, x.end));
  const groups = s
    .filter((x) => x.type === "sbgp")
    .map((x) => {
      const fields = b[x.body] === 1 ? 12 : 8;
      if (x.body + fields + 4 > x.end) throw new Unreadable();
      const n = v.getUint32(x.body + fields);
      if (x.body + fields + 4 + n * 8 > x.end) throw new Unreadable();
      const indices: number[] = [];
      for (let i = 0; i < n; i++) {
        const runs = v.getUint32(x.body + fields + 4 + i * 8);
        const group = v.getUint32(x.body + fields + 8 + i * 8);
        if (indices.length + runs > count) throw new Unreadable();
        for (let k = 0; k < runs; k++) indices.push(group);
      }
      while (indices.length < count) indices.push(0);
      return { header: b.slice(x.body, x.body + fields), indices };
    });
  const groupsKey = [...groupDescriptions.map(hexOf), "|", ...groups.map((g) => hexOf(g.header))].join(",");

  return {
    handler,
    timescale,
    language,
    tkhd: b.slice(tkhd.start, tkhd.end),
    hdlr: b.slice(hdlr.start, hdlr.end),
    mediaHeader: b.slice(mediaHeader.start, mediaHeader.end),
    dinf: b.slice(dinf.start, dinf.end),
    stsd: b.slice(stsd.start, stsd.end),
    ...describe(b, v, stsd),
    samples,
    hasCtts: !!ctts,
    groupsKey,
    groupDescriptions,
    groups,
    edit,
  };
}

function readFile(bytes: Uint8Array): FileIn {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const top = boxesIn(bytes, v, 0, bytes.length);
  if (top[0]?.type !== "ftyp") throw new Unreadable();
  if (top.some((x) => x.type === "moof" || x.type === "mvex")) throw new Unreadable();
  const moov = need(top, "moov");
  if (!top.some((x) => x.type === "mdat")) throw new Unreadable();
  const inner = boxesIn(bytes, v, moov.body, moov.end);
  if (inner.some((x) => x.type === "mvex" || x.type === "cmov")) throw new Unreadable();
  const mvhd = need(inner, "mvhd");
  const movieTimescale = v.getUint32(mvhd.body + (bytes[mvhd.body] === 1 ? 20 : 12));
  if (movieTimescale === 0) throw new Unreadable();
  const tracks = inner.filter((x) => x.type === "trak").map((trak) => readTrack(bytes, v, trak, bytes.length));
  if (tracks.length === 0) throw new Unreadable();
  return { bytes, ftyp: bytes.slice(top[0].start, top[0].end), movieTimescale, tracks };
}

// ---- writing ----

class Writer {
  private parts: Uint8Array[] = [];
  length = 0;
  push(part: Uint8Array) {
    this.parts.push(part);
    this.length += part.length;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

const u32 = (n: number) => {
  const a = new Uint8Array(4);
  new DataView(a.buffer).setUint32(0, n);
  return a;
};
const i32 = (n: number) => {
  const a = new Uint8Array(4);
  new DataView(a.buffer).setInt32(0, n);
  return a;
};
const u64 = (n: number) => {
  const a = new Uint8Array(8);
  new DataView(a.buffer).setBigUint64(0, BigInt(n));
  return a;
};
const i64 = (n: number) => {
  const a = new Uint8Array(8);
  new DataView(a.buffer).setBigInt64(0, BigInt(n));
  return a;
};
const concat = (parts: Uint8Array[]) => {
  const w = new Writer();
  for (const p of parts) w.push(p);
  return w.bytes();
};
const tag = (type: string) => new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
const box = (type: string, ...parts: Uint8Array[]) => {
  const body = concat(parts);
  return concat([u32(body.length + 8), tag(type), body]);
};
const fullBox = (type: string, version: number, ...parts: Uint8Array[]) => box(type, new Uint8Array([version, 0, 0, 0]), ...parts);
const U32_MAX = 0xffffffff;

/** Run-length pairs of equal values: [count, value][]. */
function runs(values: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const x of values) {
    const last = out[out.length - 1];
    if (last && last[1] === x) last[0]++;
    else out.push([1, x]);
  }
  return out;
}

/** A copy of a tkhd with its track id and duration set. */
function patchTkhd(tkhd: Uint8Array, trackId: number, duration: number): Uint8Array {
  const out = tkhd.slice();
  const v = new DataView(out.buffer);
  const v1 = out[8] === 1;
  v.setUint32(8 + (v1 ? 20 : 12), trackId);
  if (v1) v.setBigUint64(8 + 28, BigInt(duration));
  else v.setUint32(8 + 20, Math.min(U32_MAX, duration));
  return out;
}

/** A copy of a track's sample description with the film's bitrate notes written in. */
function withRates(track: TrackIn, rates: { buffer: number; max: number; avg: number }): Uint8Array {
  const out = track.stsd.slice();
  const v = new DataView(out.buffer);
  if (track.btrtAt !== null) {
    v.setUint32(track.btrtAt, rates.buffer);
    v.setUint32(track.btrtAt + 4, rates.max);
    v.setUint32(track.btrtAt + 8, rates.avg);
  }
  if (track.esdsAt !== null) {
    const buffer = Math.min(0xffffff, rates.buffer);
    out.set([buffer >> 16, (buffer >> 8) & 0xff, buffer & 0xff], track.esdsAt);
    v.setUint32(track.esdsAt + 3, rates.max);
    v.setUint32(track.esdsAt + 7, rates.avg);
  }
  return out;
}

const IDENTITY = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];

function mvhdBox(timescale: number, duration: number, nextTrackId: number): Uint8Array {
  const v1 = duration > U32_MAX;
  return fullBox(
    "mvhd",
    v1 ? 1 : 0,
    ...(v1 ? [u64(0), u64(0), u32(timescale), u64(duration)] : [u32(0), u32(0), u32(timescale), u32(duration)]),
    u32(0x10000),
    new Uint8Array([0x01, 0x00]),
    new Uint8Array(10),
    ...IDENTITY.map(u32),
    new Uint8Array(24),
    u32(nextTrackId),
  );
}

function mdhdBox(timescale: number, duration: number, language: number): Uint8Array {
  const v1 = duration > U32_MAX;
  const lang = new Uint8Array(4);
  new DataView(lang.buffer).setUint16(0, language);
  return fullBox("mdhd", v1 ? 1 : 0, ...(v1 ? [u64(0), u64(0), u32(timescale), u64(duration)] : [u32(0), u32(0), u32(timescale), u32(duration)]), lang);
}

/**
 * How many of each file's samples the join keeps, per track: all of them,
 * except in a sound track of every file but the last, which keeps the whole
 * sound frames that end nearest the running end of the pictures (the first
 * video track's decode lengths), so that the next file's sound starts with
 * its picture. Null when a clip's sound falls short of that by more than a
 * sound frame, where the next beat's sound could only start early. Without
 * a video track, every sample is kept.
 */
function keptCounts(parsed: FileIn[]): number[][] | null {
  const counts = parsed.map((file) => file.tracks.map((track) => track.samples.length));
  const picture = parsed[0].tracks.findIndex((track) => track.handler === "vide");
  if (picture < 0) return counts;
  const pictureTs = parsed[0].tracks[picture].timescale;
  for (let t = 0; t < parsed[0].tracks.length; t++) {
    if (parsed[0].tracks[t].handler !== "soun") continue;
    const ts = parsed[0].tracks[t].timescale;
    let pictureEnd = 0;
    let soundEnd = 0;
    for (let f = 0; f < parsed.length - 1; f++) {
      const samples = parsed[f].tracks[t].samples;
      pictureEnd += parsed[f].tracks[picture].samples.reduce((n, x) => n + x.delta, 0);
      const target = (pictureEnd * ts) / pictureTs;
      const frame = Math.max(0, ...samples.map((x) => x.delta));
      // A last sound frame said to be shorter than the rest is an encoder's
      // padded end: it still decodes to a whole frame, which would run over
      // the next beat's sound, so only the last beat keeps it.
      const usable = samples.length > 0 && samples[samples.length - 1].delta < frame ? samples.length - 1 : samples.length;
      let n = 0;
      while (n < usable && Math.abs(soundEnd + samples[n].delta - target) <= Math.abs(soundEnd - target)) {
        soundEnd += samples[n].delta;
        n++;
      }
      if (Math.abs(soundEnd - target) > frame) return null;
      counts[f][t] = n;
    }
  }
  return counts;
}

/**
 * The clips as one MP4, when they can be joined as they are. A single clip
 * comes back as it is; no clip, or clips that differ, are refused.
 */
export function joinMp4(files: readonly Uint8Array[]): JoinResult {
  try {
    return join(files);
  } catch {
    // An allocation the browser refuses, or anything else unforeseen.
    return { ok: false, reason: "unreadable" };
  }
}

function join(files: readonly Uint8Array[]): JoinResult {
  if (files.length === 0) return { ok: false, reason: "empty" };
  let parsed: FileIn[];
  try {
    parsed = files.map(readFile);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const first = parsed[0];
  const movieTs = first.movieTimescale;
  const secondsOf = (file: FileIn) =>
    Math.max(
      ...file.tracks.map((t) =>
        t.edit ? t.edit.duration / file.movieTimescale : t.samples.reduce((n, x) => n + x.delta, 0) / t.timescale,
      ),
    );
  if (parsed.length === 1) return { ok: true, bytes: files[0], seconds: secondsOf(first) };

  // The same tracks, set up the same way.
  for (const file of parsed.slice(1)) {
    if (file.tracks.length !== first.tracks.length) return { ok: false, reason: "different" };
    for (let t = 0; t < first.tracks.length; t++) {
      const a = first.tracks[t];
      const b = file.tracks[t];
      if (a.handler !== b.handler || a.timescale !== b.timescale || a.stsdKey !== b.stsdKey || a.groupsKey !== b.groupsKey) {
        return { ok: false, reason: "different" };
      }
      if (!!a.edit !== !!b.edit || (a.edit && b.edit && a.edit.mediaTime !== b.edit.mediaTime)) return { ok: false, reason: "different" };
    }
  }

  const kept = keptCounts(parsed);
  if (!kept) return { ok: false, reason: "short-sound" };

  // The mdat: each file's kept samples, all tracks, in the file's own order.
  type Placed = { file: number; track: number; index: number };
  const newOffset: number[][][] = parsed.map((file, f) => file.tracks.map((_, t) => new Array<number>(kept[f][t])));
  const order: Placed[] = [];
  parsed.forEach((file, f) => {
    const all: (Placed & { at: number })[] = [];
    file.tracks.forEach((track, t) =>
      track.samples.slice(0, kept[f][t]).forEach((sample, i) => all.push({ file: f, track: t, index: i, at: sample.offset })),
    );
    all.sort((x, y) => x.at - y.at || x.track - y.track || x.index - y.index);
    order.push(...all);
  });
  let dataLength = 0;
  for (const p of order) dataLength += parsed[p.file].tracks[p.track].samples[p.index].size;
  if (dataLength + 8 > U32_MAX) return { ok: false, reason: "unreadable" };

  // Each track's whole-film tables. Offsets are written once the moov's
  // length is known; every table's length is known before that.
  const trackPlans = first.tracks.map((track, t) => {
    const samples = parsed.flatMap((file, f) => file.tracks[t].samples.slice(0, kept[f][t]));
    const mediaDuration = samples.reduce((n, x) => n + x.delta, 0);
    // The edit shows everything the joined track presents from the shared
    // offset on. Summing the clips' own edits would not: each later clip's
    // priming is presented in the join, where its own edit hid it.
    let presentedEnd = 0;
    let decodeAt = 0;
    for (const x of samples) {
      presentedEnd = Math.max(presentedEnd, decodeAt + x.cto + x.delta);
      decodeAt += x.delta;
    }
    const edit = track.edit
      ? {
          mediaTime: track.edit.mediaTime,
          duration: Math.max(0, Math.round(((presentedEnd - track.edit.mediaTime) * movieTs) / track.timescale)),
        }
      : null;
    const duration = edit ? edit.duration : Math.round((mediaDuration * movieTs) / track.timescale);
    // The film's bitrate notes: the average over every sample it keeps, as
    // ffmpeg's muxer counts it, and the highest peak and buffer any clip noted.
    const bytes = samples.reduce((n, x) => n + x.size, 0);
    const avg = mediaDuration > 0 ? Math.min(U32_MAX, Math.floor((bytes * 8 * track.timescale) / mediaDuration)) : 0;
    const stsd = withRates(track, {
      buffer: Math.max(...parsed.map((file) => file.tracks[t].rates.buffer)),
      max: Math.max(avg, ...parsed.map((file) => file.tracks[t].rates.max)),
      avg,
    });
    return { track, t, samples, mediaDuration, edit, duration, stsd };
  });
  const movieDuration = Math.max(...trackPlans.map((p) => p.duration));

  const buildMoov = (offsets: number[][]) =>
    box(
      "moov",
      mvhdBox(movieTs, movieDuration, first.tracks.length + 1),
      ...trackPlans.map((plan) => {
        const { track, t, samples, stsd } = plan;
        const stts = runs(samples.map((x) => x.delta));
        const anyCtts = parsed.some((file) => file.tracks[t].hasCtts);
        const ctts = anyCtts ? runs(samples.map((x) => x.cto)) : null;
        const cttsSigned = !!ctts && samples.some((x) => x.cto < 0);
        const allSync = samples.every((x) => x.sync);
        const sizes = samples.map((x) => x.size);
        const sameSize = sizes.every((x) => x === sizes[0]);
        const stbl = box(
          "stbl",
          stsd,
          fullBox("stts", 0, u32(stts.length), ...stts.flatMap(([n, d]) => [u32(n), u32(d)])),
          ...(ctts ? [fullBox("ctts", cttsSigned ? 1 : 0, u32(ctts.length), ...ctts.flatMap(([n, o]) => [u32(n), cttsSigned ? i32(o) : u32(o)]))] : []),
          ...(allSync
            ? []
            : [fullBox("stss", 0, u32(samples.filter((x) => x.sync).length), ...samples.flatMap((x, i) => (x.sync ? [u32(i + 1)] : [])))]),
          fullBox("stsc", 0, u32(1), u32(1), u32(1), u32(1)),
          fullBox("stsz", 0, u32(sameSize ? sizes[0] : 0), u32(samples.length), ...(sameSize ? [] : sizes.map(u32))),
          // The joined file stays under 4 GB (refused otherwise), so 32-bit offsets hold it.
          fullBox("stco", 0, u32(samples.length), ...offsets[t].map(u32)),
          ...track.groupDescriptions,
          ...track.groups.map((group, g) => {
            const entries = runs(parsed.flatMap((file, f) => file.tracks[t].groups[g].indices.slice(0, kept[f][t])));
            return box("sbgp", group.header, u32(entries.length), ...entries.flatMap(([n, index]) => [u32(n), u32(index)]));
          }),
        );
        const edts = plan.edit
          ? [
              box(
                "edts",
                plan.edit.duration > U32_MAX || plan.edit.mediaTime > 0x7fffffff
                  ? fullBox("elst", 1, u32(1), u64(plan.edit.duration), i64(plan.edit.mediaTime), u32(0x10000))
                  : fullBox("elst", 0, u32(1), u32(plan.edit.duration), i32(plan.edit.mediaTime), u32(0x10000)),
              ),
            ]
          : [];
        return box(
          "trak",
          patchTkhd(track.tkhd, t + 1, plan.duration),
          ...edts,
          box("mdia", mdhdBox(track.timescale, plan.mediaDuration, track.language), track.hdlr, box("minf", track.mediaHeader, track.dinf, stbl)),
        );
      }),
    );

  const zeroOffsets = trackPlans.map((p) => new Array<number>(p.samples.length).fill(0));
  const moovLength = buildMoov(zeroOffsets).length;
  const dataStart = first.ftyp.length + moovLength + 8;

  // Place the samples, then write the tables that point at them.
  let cursor = dataStart;
  for (const p of order) {
    newOffset[p.file][p.track][p.index] = cursor;
    cursor += parsed[p.file].tracks[p.track].samples[p.index].size;
  }
  if (cursor > U32_MAX) return { ok: false, reason: "unreadable" };
  const offsets = trackPlans.map((plan) => parsed.flatMap((_, f) => newOffset[f][plan.t]));
  const moov = buildMoov(offsets);
  if (moov.length !== moovLength) return { ok: false, reason: "unreadable" };

  const out = new Uint8Array(dataStart + dataLength);
  out.set(first.ftyp, 0);
  out.set(moov, first.ftyp.length);
  new DataView(out.buffer).setUint32(first.ftyp.length + moovLength, dataLength + 8);
  out.set(tag("mdat"), first.ftyp.length + moovLength + 4);
  for (const p of order) {
    const sample = parsed[p.file].tracks[p.track].samples[p.index];
    out.set(parsed[p.file].bytes.subarray(sample.offset, sample.offset + sample.size), newOffset[p.file][p.track][p.index]);
  }
  return { ok: true, bytes: out, seconds: movieDuration / movieTs };
}
