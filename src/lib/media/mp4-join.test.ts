import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { joinMp4 } from "./mp4-join";

// Joining clips into one MP4 without re-encoding (Helios Film, "Download as
// one file", canvas page H: "that stitch is the one link to prove before
// promising it"). Proven on the real encoded videos the site ships: ffmpeg,
// a demuxer that shares no code with the join, reads every packet of the
// joined file back and hashes it, and the hashes must be the clips' own, in
// order, with the time running on across each seam. Real renders, which
// cannot live in the repo, were checked the same way and with AVFoundation
// when this was built (docs/ASTRA_SETS.md, 2026-09-17).

const pub = (name: string) => new Uint8Array(readFileSync(join(__dirname, "../../../public", name)));
const HERO = pub("hero-band.mp4");
const HERO2 = pub("hero-band-2.mp4");
const HERO3 = pub("hero-band-3.mp4");
const HERO4 = pub("hero-band-4.mp4");
const SHOW = pub("showcase-video.mp4");
const SHOW2 = pub("showcase-video-2.mp4");

const ffmpeg = (() => {
  try {
    const path = createRequire(__filename)("ffmpeg-static") as string | null;
    return path && existsSync(path) ? path : null;
  } catch {
    return null;
  }
})();

type Packet = { stream: number; dts: number; pts: number; duration: number; size: number; hash: string };

/** The bytes as a file of their own, for as long as `work` runs. */
function asFile<T>(bytes: Uint8Array, work: (file: string, dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "mp4-join-"));
  try {
    const file = join(dir, "in.mp4");
    writeFileSync(file, bytes);
    return work(file, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What ffmpeg prints for the bytes. */
const ffmpegOn = (bytes: Uint8Array, args: (file: string) => string[]) =>
  asFile(bytes, (file) => execFileSync(ffmpeg!, args(file), { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));

/** The clip copied by ffmpeg's own muxer, which writes the index after the samples. */
const remuxed = (bytes: Uint8Array) =>
  asFile(bytes, (file, dir) => {
    const out = join(dir, "out.mp4");
    execFileSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-i", file, "-map", "0", "-c", "copy", out]);
    return new Uint8Array(readFileSync(out));
  });

const rows = (out: string) =>
  out
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(",").map((x) => x.trim()));

/** Every packet ffmpeg reads from the file, copied, never decoded. */
function packets(bytes: Uint8Array): Packet[] {
  const out = ffmpegOn(bytes, (file) => ["-hide_banner", "-loglevel", "error", "-i", file, "-map", "0", "-c", "copy", "-f", "framemd5", "-"]);
  return rows(out).map(([stream, dts, pts, duration, size, hash]) => ({
    stream: Number(stream),
    dts: Number(dts),
    pts: Number(pts),
    duration: Number(duration),
    size: Number(size),
    hash,
  }));
}

/**
 * Each packet's flags as ffmpeg reads them, per stream: "key" for a
 * keyframe, "F=0x0" for any other, "F=0x5" for a keyframe the edit hides.
 */
function flags(bytes: Uint8Array, stream: number): string[] {
  const out = ffmpegOn(bytes, (file) => ["-hide_banner", "-loglevel", "error", "-i", file, "-map", "0", "-c", "copy", "-f", "framecrc", "-"]);
  return rows(out)
    .filter((row) => Number(row[0]) === stream)
    .map((row) => row[6] ?? "key");
}

/** What ffmpeg says when it decodes the whole file: nothing, for a good file. */
function decodeErrors(bytes: Uint8Array): string {
  try {
    ffmpegOn(bytes, (file) => ["-hide_banner", "-v", "error", "-xerror", "-i", file, "-f", "null", "-"]);
    return "";
  } catch (err) {
    return String((err as { stderr?: unknown }).stderr ?? err);
  }
}

const topLevel = (bytes: Uint8Array) => {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: { type: string; size: number }[] = [];
  for (let at = 0; at < bytes.length; ) {
    const size = v.getUint32(at);
    out.push({ type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), size });
    at += size;
  }
  return out;
};

/** Where a file's index (its moov box) starts, in bytes, and how long it is. */
function moovOf(bytes: Uint8Array): { start: number; size: number } {
  let at = 0;
  for (const x of topLevel(bytes)) {
    if (x.type === "moov") return { start: at, size: x.size };
    at += x.size;
  }
  throw new Error("no moov");
}

/** Where each box of this type starts inside a file's index. */
function boxesInMoov(bytes: Uint8Array, type: string): number[] {
  const { start, size } = moovOf(bytes);
  const moov = Buffer.from(bytes.subarray(start, start + size));
  const out: number[] = [];
  for (let i = moov.indexOf(type); i !== -1; i = moov.indexOf(type, i + 4)) out.push(start + i - 4);
  return out;
}

/** Each box of this type inside a file's index, as its bytes. */
const boxBytes = (bytes: Uint8Array, type: string) => {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return boxesInMoov(bytes, type).map((at) => bytes.slice(at, at + v.getUint32(at)));
};

/** A copy of a clip with its sample groups hidden (renamed free, which readers skip). */
function withoutGroups(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const hidden = [...boxesInMoov(out, "sgpd"), ...boxesInMoov(out, "sbgp")];
  expect(hidden.length).toBeGreaterThan(0);
  for (const at of hidden) out.set([0x66, 0x72, 0x65, 0x65], at + 4);
  return out;
}

/** A copy of a clip with its one edit changed: where in the media it starts, its speed, or how many there are. */
function editedClip(bytes: Uint8Array, edit: { mediaTime?: number; rate?: number; entries?: number }): Uint8Array {
  const out = bytes.slice();
  const [elst] = boxesInMoov(out, "elst");
  expect(elst).toBeGreaterThan(0);
  // A version 0 edit list: 32-bit fields.
  expect(out[elst + 8]).toBe(0);
  const v = new DataView(out.buffer);
  if (edit.entries !== undefined) v.setUint32(elst + 12, edit.entries);
  if (edit.mediaTime !== undefined) v.setInt32(elst + 20, edit.mediaTime);
  if (edit.rate !== undefined) v.setInt32(elst + 24, edit.rate);
  return out;
}

/**
 * A copy of a clip whose sound frames each say they last half as long as
 * they do (its sound track's stts, the one with 1,024-sample frames).
 */
function shortSound(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const v = new DataView(out.buffer);
  let halved = 0;
  for (const stts of boxesInMoov(out, "stts")) {
    const entries = v.getUint32(stts + 12);
    for (let k = 0; k < entries; k++) {
      const at = stts + 20 + k * 8;
      if (v.getUint32(at) === 1024) {
        v.setUint32(at, 512);
        halved++;
      }
    }
  }
  expect(halved).toBeGreaterThan(0);
  return out;
}

/**
 * A copy of a clip whose last sound frame says it lasts `last` samples, as
 * an encoder's padded end does: the sound's stts gains a second run. The
 * index grows by 8 bytes and the empty free box after it goes, so every
 * sample stays where it was.
 */
function withShortLastSound(bytes: Uint8Array, last: number): Uint8Array {
  const top = topLevel(bytes);
  expect(top.map((x) => x.type)).toEqual(["ftyp", "moov", "free", "mdat"]);
  expect(top[2].size).toBe(8);
  const free = top[0].size + top[1].size;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stts = boxesInMoov(bytes, "stts").find((at) => v.getUint32(at + 12) === 1 && v.getUint32(at + 20) === 1024)!;
  expect(stts).toBeGreaterThan(0);
  const count = v.getUint32(stts + 16);
  const runs = new Uint8Array(32);
  const rv = new DataView(runs.buffer);
  rv.setUint32(0, 32);
  runs.set([0x73, 0x74, 0x74, 0x73], 4);
  rv.setUint32(12, 2);
  rv.setUint32(16, count - 1);
  rv.setUint32(20, 1024);
  rv.setUint32(24, 1);
  rv.setUint32(28, last);
  const out = new Uint8Array(bytes.length);
  out.set(bytes.subarray(0, stts));
  out.set(runs, stts);
  out.set(bytes.subarray(stts + 24, free), stts + 32);
  out.set(bytes.subarray(free + 8), free + 8);
  // Every box around the stts is 8 bytes longer.
  const ov = new DataView(out.buffer);
  const around = [moovOf(bytes).start, ...["trak", "mdia", "minf", "stbl"].flatMap((type) => boxesInMoov(bytes, type))].filter(
    (at) => at < stts && at + v.getUint32(at) > stts,
  );
  expect(around).toHaveLength(5);
  for (const at of around) ov.setUint32(at, v.getUint32(at) + 8);
  return out;
}

/** Where an AAC esds (the box starting at `esds`) keeps its buffer size and bitrates: after its object type (0x40) and stream type (0x15). */
function aacRatesAt(bytes: Uint8Array, esds: number): number {
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(esds);
  const at = Buffer.from(bytes.subarray(esds, esds + size)).indexOf(Buffer.from([0x40, 0x15]));
  expect(at).toBeGreaterThan(0);
  return esds + at + 2;
}

/** The bitrate notes in a file's index: each btrt's, and each AAC esds's. */
function rateNotes(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    btrt: boxesInMoov(bytes, "btrt").map((at) => ({ buffer: v.getUint32(at + 8), max: v.getUint32(at + 12), avg: v.getUint32(at + 16) })),
    esds: boxesInMoov(bytes, "esds").map((esds) => {
      const at = aacRatesAt(bytes, esds);
      return { buffer: (bytes[at] << 16) | (bytes[at + 1] << 8) | bytes[at + 2], max: v.getUint32(at + 3), avg: v.getUint32(at + 7) };
    }),
  };
}

/** A copy of a clip whose bitrate notes all give these figures, as another encode's would. */
function withRateNotes(bytes: Uint8Array, rates: { buffer: number; max: number; avg: number }): Uint8Array {
  const out = bytes.slice();
  const v = new DataView(out.buffer);
  for (const at of boxesInMoov(out, "btrt")) {
    v.setUint32(at + 8, rates.buffer);
    v.setUint32(at + 12, rates.max);
    v.setUint32(at + 16, rates.avg);
  }
  for (const esds of boxesInMoov(out, "esds")) {
    const at = aacRatesAt(out, esds);
    out.set([rates.buffer >> 16, (rates.buffer >> 8) & 0xff, rates.buffer & 0xff], at);
    v.setUint32(at + 3, rates.max);
    v.setUint32(at + 7, rates.avg);
  }
  return out;
}

/** A copy of a clip with its two tracks in the other order, sound first, as some engines write them. */
function soundFirst(bytes: Uint8Array): Uint8Array {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const [picture, sound] = boxesInMoov(bytes, "trak");
  const pictureEnd = picture + v.getUint32(picture);
  const soundEnd = sound + v.getUint32(sound);
  expect(sound).toBe(pictureEnd);
  const out = bytes.slice();
  out.set(bytes.subarray(sound, soundEnd), picture);
  out.set(bytes.subarray(picture, pictureEnd), picture + (soundEnd - sound));
  return out;
}

/** Each track's decode-length runs (stts), as [count, length] pairs, read from the file. */
function sttsRuns(bytes: Uint8Array): [number, number][][] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return boxesInMoov(bytes, "stts").map((at) =>
    Array.from({ length: v.getUint32(at + 12) }, (_, k): [number, number] => [v.getUint32(at + 16 + k * 8), v.getUint32(at + 20 + k * 8)]),
  );
}

const mdatBody = (bytes: Uint8Array) => {
  let at = 0;
  for (const x of topLevel(bytes)) {
    if (x.type === "mdat") return bytes.subarray(at + 8, at + x.size);
    at += x.size;
  }
  throw new Error("no mdat");
};

/**
 * The keyframe lists (stss) in a file's index, read straight from it: ffmpeg
 * cannot check them, as it finds H.264 keyframes in the stream itself when
 * the list is missing, but a player that seeks by the list (QuickTime,
 * Safari) takes every frame for one.
 */
function keyframeLists(bytes: Uint8Array): number[][] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return boxesInMoov(bytes, "stss").map((stss) => Array.from({ length: v.getUint32(stss + 12) }, (_, k) => v.getUint32(stss + 16 + k * 4)));
}

describe.skipIf(!ffmpeg)("joinMp4, read back by ffmpeg", () => {
  it("joins two clips with the same setup: every packet theirs, in order, the time running on", () => {
    const joined = joinMp4([HERO, HERO2]);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const a = packets(HERO);
    const b = packets(HERO2);
    const out = packets(joined.bytes);
    expect(out.map((p) => [p.stream, p.size, p.hash])).toEqual([...a, ...b].map((p) => [p.stream, p.size, p.hash]));
    // The second clip's packets keep their spacing, moved on by the first clip's length.
    const shift = a.reduce((n, p) => n + p.duration, 0);
    expect(out.slice(a.length).map((p) => [p.dts, p.pts])).toEqual(b.map((p) => [p.dts + shift, p.pts + shift]));
    // The first picture of the second clip follows the first clip's last, exactly.
    const lastShown = Math.max(...a.map((p) => p.pts));
    expect(Math.min(...out.slice(a.length).map((p) => p.pts))).toBe(lastShown + 512);
    expect(decodeErrors(joined.bytes)).toBe("");
    // Each clip opens on its one keyframe, and a player can seek to either.
    expect(flags(HERO, 0).filter((f) => f === "key")).toHaveLength(1);
    expect(flags(joined.bytes, 0)).toEqual([...flags(HERO, 0), ...flags(HERO2, 0)]);
    // As long as both clips' frames, to the millisecond.
    expect(joined.seconds).toBeCloseTo((shift + b.reduce((n, p) => n + p.duration, 0)) / 12288, 3);
  });

  it("joins picture and sound, each beat's sound starting with its picture", () => {
    const joined = joinMp4([SHOW, SHOW, SHOW]);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const one = packets(SHOW);
    const picture = one.filter((p) => p.stream === 0);
    const sound = one.filter((p) => p.stream === 1);
    const out = packets(joined.bytes);
    const outPicture = out.filter((p) => p.stream === 0);
    const outSound = out.filter((p) => p.stream === 1);
    // Every frame of the picture.
    expect(outPicture.map((p) => [p.size, p.hash])).toEqual([...picture, ...picture, ...picture].map((p) => [p.size, p.hash]));
    // A beat's picture is 121 frames, 5.042 s; its sound 218 AAC frames,
    // 5.062 s after the 1,024-sample priming. So the first two beats keep
    // 217 sound frames, which end 3 ms before their picture (218 would end
    // 20 ms after it, and the third beat's sound would start 40 ms late).
    expect(picture).toHaveLength(121);
    expect(sound).toHaveLength(218);
    const kept = [...sound.slice(0, 217), ...sound.slice(0, 217), ...sound];
    expect(outSound.map((p) => [p.size, p.hash])).toEqual(kept.map((p) => [p.size, p.hash]));
    expect(decodeErrors(joined.bytes)).toBe("");
    // Each later beat's sound, after its priming, starts within half a
    // sound frame of its first picture.
    for (const beat of [1, 2]) {
      const pictureStart = Math.min(...outPicture.slice(beat * 121, (beat + 1) * 121).map((p) => p.pts)) / 12288;
      const soundStart = outSound[beat * 217 + 1].pts / 44100;
      expect(Math.abs(soundStart - pictureStart)).toBeLessThan(512 / 44100);
    }
    expect(flags(joined.bytes, 0)).toEqual([...flags(SHOW, 0), ...flags(SHOW, 0), ...flags(SHOW, 0)]);
    // Only the first beat's priming is hidden by the edit; each later
    // beat's is played, over the end its earlier beat's sound was cut at.
    const soundFlags = flags(SHOW, 1);
    expect(soundFlags[0]).toBe("F=0x5");
    expect(flags(joined.bytes, 1)).toEqual([...soundFlags.slice(0, 217), "key", ...soundFlags.slice(1, 217), "key", ...soundFlags.slice(1)]);
    // As long as the pictures, the sound ending within a sound frame of them.
    expect(joined.seconds).toBeCloseTo((3 * 121 * 512) / 12288, 3);
    const end = (ps: Packet[], tb: number) => Math.max(...ps.map((p) => p.pts + p.duration)) / tb;
    expect(Math.abs(end(outSound, 44100) - end(outPicture, 12288))).toBeLessThan(1024 / 44100);
  });

  it("finds the picture wherever its track is", () => {
    const swapped = soundFirst(SHOW);
    expect(sttsRuns(swapped)).toEqual([[[218, 1024]], [[121, 512]]]);
    const joined = joinMp4([swapped, swapped, swapped]);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    // The sound is stream 0 now, cut as in the picture-first film.
    const sound = packets(SHOW).filter((p) => p.stream === 1);
    const out = packets(joined.bytes);
    expect(out.filter((p) => p.stream === 0).map((p) => p.hash)).toEqual([...sound.slice(0, 217), ...sound.slice(0, 217), ...sound].map((p) => p.hash));
    expect(out.filter((p) => p.stream === 1)).toHaveLength(363);
    expect(decodeErrors(joined.bytes)).toBe("");
  });

  it("keeps the sound in step over many beats, cutting at the nearest sound frame", () => {
    // Films have three beats at most, but the join takes any number. Over
    // five, each cut to the frame below would leave the fifth beat's sound
    // 12 ms early; the nearest frame keeps every start within 11.6 ms.
    const joined = joinMp4([SHOW, SHOW, SHOW, SHOW, SHOW]);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const priming = packets(SHOW).find((p) => p.stream === 1)!.hash;
    const outSound = packets(joined.bytes).filter((p) => p.stream === 1);
    const starts = outSound.flatMap((p, i) => (p.hash === priming ? [i] : []));
    expect(starts).toHaveLength(5);
    for (let beat = 1; beat < 5; beat++) {
      const pictureStart = (beat * 121 * 512) / 12288;
      const soundStart = outSound[starts[beat] + 1].pts / 44100;
      expect(Math.abs(soundStart - pictureStart)).toBeLessThan(512 / 44100);
    }
    expect(decodeErrors(joined.bytes)).toBe("");
  });

  it("leaves an earlier beat's padded last sound frame out", () => {
    // The last of the clip's 218 sound frames says it lasts 200 samples, so
    // its sound (222,408) ends 1.6 ms past its picture (222,337.5) and the
    // nearest frame would be that one; but it decodes to a whole 1,024
    // samples, which would have pushed the next beat's sound 19 ms late.
    const padded = withShortLastSound(SHOW, 200);
    expect(sttsRuns(padded)).toEqual([[[121, 512]], [[217, 1024], [1, 200]]]);
    expect(decodeErrors(padded)).toBe("");
    const alone = packets(padded).filter((p) => p.stream === 1);
    expect(alone).toHaveLength(218);
    const sound = packets(SHOW).filter((p) => p.stream === 1);
    const first = joinMp4([padded, SHOW]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(packets(first.bytes).filter((p) => p.stream === 1).map((p) => p.hash)).toEqual([...alone.slice(0, 217), ...sound].map((p) => p.hash));
    expect(decodeErrors(first.bytes)).toBe("");
    // The last beat keeps it: nothing follows.
    const last = joinMp4([SHOW, padded]);
    expect(last.ok).toBe(true);
    if (!last.ok) return;
    const lastSound = packets(last.bytes).filter((p) => p.stream === 1);
    expect(lastSound.map((p) => p.hash)).toEqual([...sound.slice(0, 217), ...alone].map((p) => p.hash));
    expect(sttsRuns(last.bytes)[1]).toEqual([[434, 1024], [1, 200]]);
    expect(decodeErrors(last.bytes)).toBe("");
  });

  it("refuses a beat whose sound stops well before its picture", () => {
    // The second clip's sound frames all say half their length: its sound
    // runs 2.5 s against a 5 s picture, so the third beat's could only start early.
    const short = shortSound(SHOW);
    expect(joinMp4([SHOW, short, SHOW])).toEqual({ ok: false, reason: "short-sound" });
    // As the last beat it can be joined: nothing follows it.
    const joined = joinMp4([SHOW, short]);
    expect(joined.ok).toBe(true);
    if (joined.ok) expect(decodeErrors(joined.bytes)).toBe("");
  });

  it("joins renders whose bitrate notes differ, and notes the film's own", () => {
    // Every encode writes its own figures into btrt and the esds; two
    // renders of one engine differ in nothing else (checked on real ones).
    const other = withRateNotes(SHOW, { buffer: 5000, max: 3_000_000, avg: 2_000_000 });
    const joined = joinMp4([SHOW, other]);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const notes = rateNotes(joined.bytes);
    expect(notes.btrt).toHaveLength(2);
    expect(notes.esds).toHaveLength(1);
    const out = packets(joined.bytes);
    const runs = sttsRuns(joined.bytes);
    // The picture's note, then the sound's two: the average over every
    // sample the film keeps, the highest peak and buffer any clip noted.
    const tracks = [
      { stream: 0, rate: 12288, notes: [notes.btrt[0]] },
      { stream: 1, rate: 44100, notes: [notes.btrt[1], notes.esds[0]] },
    ];
    for (const { stream, rate, notes: given } of tracks) {
      const bytes = out.filter((p) => p.stream === stream).reduce((n, p) => n + p.size, 0);
      const length = runs[stream].reduce((n, [count, each]) => n + count * each, 0);
      const avg = Math.floor((bytes * 8 * rate) / length);
      expect(avg).toBeLessThan(3_000_000);
      for (const note of given) expect(note).toEqual({ buffer: 5000, max: 3_000_000, avg });
    }
    // The clip's own notes are left as they were.
    expect(rateNotes(SHOW).btrt[0].max).toBeLessThan(3_000_000);
  });

  it("joins clips that differ only in their bitrate note", () => {
    const joined = joinMp4([HERO3, HERO4]);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(packets(joined.bytes).map((p) => p.hash)).toEqual([...packets(HERO3), ...packets(HERO4)].map((p) => p.hash));
    expect(decodeErrors(joined.bytes)).toBe("");
  });

  it("reads clips whose index comes after their samples", () => {
    const a = remuxed(HERO);
    expect(topLevel(a).map((x) => x.type)).toEqual(["ftyp", "free", "mdat", "moov"]);
    const joined = joinMp4([a, remuxed(HERO2)]);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(packets(joined.bytes).map((p) => p.hash)).toEqual([...packets(HERO), ...packets(HERO2)].map((p) => p.hash));
    // The same film as the clips as they were, byte for byte.
    const direct = joinMp4([HERO, HERO2]);
    expect(direct.ok && Buffer.compare(Buffer.from(direct.bytes), Buffer.from(joined.bytes))).toBe(0);
  });

  it("joins clips without an edit, shown from their first sample", () => {
    const joined = joinMp4([editedClip(HERO, { entries: 0 }), editedClip(HERO2, { entries: 0 })]);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const out = packets(joined.bytes);
    expect(out.map((p) => p.hash)).toEqual([...packets(HERO), ...packets(HERO2)].map((p) => p.hash));
    expect(decodeErrors(joined.bytes)).toBe("");
    // Every frame's length, the delay before the first picture included.
    expect(joined.seconds).toBeCloseTo((out.length * 512) / 12288, 3);
  });
});

describe("joinMp4", () => {
  it("writes the index first and nothing but the samples after it", () => {
    const joined = joinMp4([HERO, HERO2]);
    if (!joined.ok) throw new Error(joined.reason);
    const boxes = topLevel(joined.bytes);
    expect(boxes.map((x) => x.type)).toEqual(["ftyp", "moov", "mdat"]);
    const samplesOf = (bytes: Uint8Array) => topLevel(bytes).find((x) => x.type === "mdat")!.size - 8;
    // The sources' mdat holds only their samples, so the joined one is exactly both.
    expect(boxes[2].size - 8).toBe(samplesOf(HERO) + samplesOf(HERO2));
    expect(joined.bytes.length).toBe(boxes.reduce((n, x) => n + x.size, 0));
    // In the clips' order, each clip's picture and sound interleaved as they were.
    const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
    expect(same(mdatBody(joined.bytes), Buffer.concat([mdatBody(HERO), mdatBody(HERO2)]))).toBe(true);
    // The first clip's last sound frame, cut to its picture, is the last
    // thing in its file (320 bytes).
    const talking = joinMp4([SHOW, SHOW]);
    if (!talking.ok) throw new Error(talking.reason);
    const body = mdatBody(SHOW);
    expect(same(mdatBody(talking.bytes), Buffer.concat([body.subarray(0, body.length - 320), body]))).toBe(true);
  });

  it("lists each clip's keyframe where it now is", () => {
    const joined = joinMp4([HERO, HERO2]);
    if (!joined.ok) throw new Error(joined.reason);
    // 241 frames a clip, the first of each a keyframe.
    expect(keyframeLists(HERO)).toEqual([[1]]);
    expect(keyframeLists(joined.bytes)).toEqual([[1, 242]]);
    // Picture and sound: every sound frame is a keyframe, so its track needs no list.
    const talking = joinMp4([SHOW, SHOW, SHOW]);
    if (!talking.ok) throw new Error(talking.reason);
    expect(keyframeLists(SHOW)).toEqual([[1]]);
    expect(keyframeLists(talking.bytes)).toEqual([[1, 122, 243]]);
  });

  it("refuses clips set up differently: a track more or less, another colour note or codec setup", () => {
    expect(joinMp4([SHOW, SHOW2])).toEqual({ ok: false, reason: "different" });
    expect(joinMp4([SHOW2, SHOW])).toEqual({ ok: false, reason: "different" });
    expect(joinMp4([HERO, HERO3])).toEqual({ ok: false, reason: "different" });
    expect(joinMp4([HERO, SHOW2])).toEqual({ ok: false, reason: "different" });
  });

  it("keeps the sound's roll group, over every sound frame it keeps", () => {
    // Without it, Apple's players start the sound 1,088 samples past its
    // edit (checked with AVFoundation: 25 ms early, its first 25 ms lost).
    const joined = joinMp4([SHOW, SHOW, SHOW]);
    if (!joined.ok) throw new Error(joined.reason);
    const [description] = boxBytes(SHOW, "sgpd");
    expect(Buffer.from(description.subarray(12, 16)).toString()).toBe("roll");
    expect(boxBytes(joined.bytes, "sgpd")).toEqual([description]);
    const [table] = boxBytes(joined.bytes, "sbgp");
    const v = new DataView(table.buffer, table.byteOffset, table.byteLength);
    expect(Buffer.from(table.subarray(12, 16)).toString()).toBe("roll");
    // One run: all 217 + 217 + 218 sound frames in the group.
    expect([v.getUint32(16), v.getUint32(20), v.getUint32(24)]).toEqual([1, 652, 1]);
    expect(table.length).toBe(28);
    // A table that stops short leaves the frames after it out of the group,
    // in the join as in the clip.
    const partial = SHOW.slice();
    const [sbgp] = boxesInMoov(partial, "sbgp");
    const pv = new DataView(partial.buffer);
    expect(pv.getUint32(sbgp + 20)).toBe(218);
    pv.setUint32(sbgp + 20, 100);
    const partly = joinMp4([partial, partial]);
    if (!partly.ok) throw new Error(partly.reason);
    const [runs] = boxBytes(partly.bytes, "sbgp");
    const rv = new DataView(runs.buffer, runs.byteOffset, runs.byteLength);
    expect(Array.from({ length: rv.getUint32(16) * 2 }, (_, i) => rv.getUint32(20 + i * 4))).toEqual([100, 1, 117, 0, 100, 1, 118, 0]);
    // A clip without the group joins with its like, and the join has none either.
    const bare = joinMp4([withoutGroups(SHOW), withoutGroups(SHOW)]);
    expect(bare.ok && boxBytes(bare.bytes, "sgpd").length + boxBytes(bare.bytes, "sbgp").length).toBe(0);
  });

  it("refuses sound set up otherwise, whatever its bitrate notes say", () => {
    // The AAC setup (AudioSpecificConfig 0x1210: 44.1 kHz, stereo) said as 48 kHz.
    const otherRate = SHOW.slice();
    const [esds] = boxesInMoov(otherRate, "esds");
    // The decoder's own setup: tag 5, a four-byte size, then the config.
    const info = esds + Buffer.from(otherRate.subarray(esds, esds + 64)).indexOf(Buffer.from([0x05, 0x80, 0x80, 0x80]));
    expect([otherRate[info + 5], otherRate[info + 6]]).toEqual([0x12, 0x10]);
    otherRate.set([0x11, 0x90], info + 5);
    expect(joinMp4([SHOW, otherRate])).toEqual({ ok: false, reason: "different" });
    expect(joinMp4([SHOW, withRateNotes(otherRate, { buffer: 0, max: 1, avg: 1 })])).toEqual({ ok: false, reason: "different" });
    // An esds flagging an optional field (here the OCR stream) is compared
    // whole, its bitrates with it.
    const flagged = SHOW.slice();
    const flags = esds + 19;
    expect(flagged[flags]).toBe(0);
    flagged[flags] = 0x20;
    expect(joinMp4([flagged, flagged]).ok).toBe(true);
    expect(joinMp4([flagged, withRateNotes(flagged, { buffer: 0, max: 1, avg: 1 })])).toEqual({ ok: false, reason: "different" });
  });

  it("refuses clips whose sample groups differ", () => {
    expect(joinMp4([SHOW, withoutGroups(SHOW)])).toEqual({ ok: false, reason: "different" });
    expect(joinMp4([withoutGroups(SHOW), SHOW])).toEqual({ ok: false, reason: "different" });
    // The same group, saying each frame needs the two before it.
    const deeper = SHOW.slice();
    const [sgpd] = boxesInMoov(deeper, "sgpd");
    const view = new DataView(deeper.buffer);
    expect(view.getInt16(sgpd + 24)).toBe(-1);
    view.setInt16(sgpd + 24, -2);
    expect(joinMp4([SHOW, deeper])).toEqual({ ok: false, reason: "different" });
  });

  it("refuses clips whose edit starts elsewhere, or that have none beside one that has", () => {
    // Another encoder's delay: one edit cannot show both clips from their first picture.
    expect(joinMp4([HERO, editedClip(HERO2, { mediaTime: 2048 })])).toEqual({ ok: false, reason: "different" });
    expect(joinMp4([HERO, editedClip(HERO2, { entries: 0 })])).toEqual({ ok: false, reason: "different" });
    expect(joinMp4([editedClip(HERO, { entries: 0 }), HERO2])).toEqual({ ok: false, reason: "different" });
    // The copy itself is sound: with the edit as it was, it joins.
    expect(joinMp4([HERO, editedClip(HERO2, { mediaTime: 1024 })]).ok).toBe(true);
  });

  it("hands a single clip back as it is, and refuses none", () => {
    const one = joinMp4([HERO]);
    expect(one.ok && one.bytes).toBe(HERO);
    expect(joinMp4([])).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses what it cannot read, and never throws", () => {
    const truncated = HERO.slice(0, HERO.length - 1000);
    expect(joinMp4([HERO, truncated])).toEqual({ ok: false, reason: "unreadable" });
    expect(joinMp4([new Uint8Array([1, 2, 3])])).toEqual({ ok: false, reason: "unreadable" });
    expect(joinMp4([HERO, new TextEncoder().encode("not a video at all, just words")])).toEqual({ ok: false, reason: "unreadable" });
    // A fragmented file: a moof at the top level.
    const moof = new Uint8Array(16);
    new DataView(moof.buffer).setUint32(0, 16);
    moof.set([0x6d, 0x6f, 0x6f, 0x66], 4);
    const fragmented = new Uint8Array(HERO.length + 16);
    fragmented.set(HERO);
    fragmented.set(moof, HERO.length);
    expect(joinMp4([HERO, fragmented])).toEqual({ ok: false, reason: "unreadable" });
    // An edit that starts with a gap, or plays at another speed.
    expect(joinMp4([HERO, editedClip(HERO2, { mediaTime: -1 })])).toEqual({ ok: false, reason: "unreadable" });
    expect(joinMp4([HERO, editedClip(HERO2, { rate: 0x20000 })])).toEqual({ ok: false, reason: "unreadable" });
    expect(joinMp4([HERO, editedClip(HERO2, { rate: 0x10000 })]).ok).toBe(true);
    const twoEdits = editedClip(HERO2, { entries: 2 });
    expect(joinMp4([HERO, twoEdits])).toEqual({ ok: false, reason: "unreadable" });
  });

  it("leaves the clips as they were", () => {
    const before = Array.from(HERO.subarray(0, 4096));
    joinMp4([HERO, HERO2]);
    expect(Array.from(HERO.subarray(0, 4096))).toEqual(before);
  });
});
