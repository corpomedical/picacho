// Minimal MP4 header probe: duration and video dimensions, read from the
// container's own boxes (moov → mvhd for duration, trak → tkhd for size).
//
// Why this exists (upscale lane, 2026-09-02): the upscale's PRICE derives
// from the clip's seconds and its upscale FACTOR from the clip's height,
// and fal bills by the real delivered output regardless of what our client
// claimed. A browser-supplied duration/height is therefore a price the
// caller sets for themselves — a lied height of 100px would compute factor
// 3 on a real 720p clip, deliver 2160p, and bill us the 4K tier against a
// 1080p charge. So the server reads the actual file and trusts nothing
// else. The client's own metadata read still drives the upload sheet's
// preview; this is the money path.
//
// Deliberately not a full demuxer: top-level box walk, then one level into
// moov (and trak → tkhd). Handles 64-bit largesize boxes and version-1
// mvhd/tkhd. Phone MP4s often put moov AFTER mdat, so the caller hands the
// whole buffer (the bucket caps files at 50MB — reading that server-side is
// an ordinary storage fetch).

export type Mp4Probe = {
  seconds: number;
  width: number;
  height: number;
};

function boxes(buf: Buffer, start: number, end: number): { type: string; start: number; end: number }[] {
  const out: { type: string; start: number; end: number }[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    const type = buf.toString("latin1", offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      // 64-bit largesize. Number() is safe: the bucket caps files far below
      // Number.MAX_SAFE_INTEGER.
      if (offset + 16 > end) break;
      size = Number(buf.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      // "To end of file."
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;
    out.push({ type, start: offset + headerSize, end: offset + size });
    offset += size;
  }
  return out;
}

/** Returns null when the buffer is not a parseable MP4 with a video track. */
export function probeMp4(buf: Buffer): Mp4Probe | null {
  const top = boxes(buf, 0, buf.length);
  // A real MP4 leads with ftyp; anything else (webm, mov-with-oddities,
  // renamed files) is rejected rather than guessed at.
  if (top[0]?.type !== "ftyp") return null;
  const moov = top.find((b) => b.type === "moov");
  if (!moov) return null;

  const inMoov = boxes(buf, moov.start, moov.end);
  const mvhd = inMoov.find((b) => b.type === "mvhd");
  if (!mvhd) return null;

  const mvhdVersion = buf.readUInt8(mvhd.start);
  let timescale: number;
  let duration: number;
  if (mvhdVersion === 1) {
    timescale = buf.readUInt32BE(mvhd.start + 20);
    duration = Number(buf.readBigUInt64BE(mvhd.start + 24));
  } else {
    timescale = buf.readUInt32BE(mvhd.start + 12);
    duration = buf.readUInt32BE(mvhd.start + 16);
  }
  if (!timescale || !duration) return null;

  // The video track is the trak whose tkhd carries non-zero dimensions
  // (audio tracks store 0x0). Width/height are 16.16 fixed-point at the
  // end of tkhd: bytes 76/80 (version 0) or 88/92 (version 1) from the
  // box's payload start.
  for (const trak of inMoov.filter((b) => b.type === "trak")) {
    const tkhd = boxes(buf, trak.start, trak.end).find((b) => b.type === "tkhd");
    if (!tkhd) continue;
    const v = buf.readUInt8(tkhd.start);
    const dimOffset = tkhd.start + (v === 1 ? 88 : 76);
    if (dimOffset + 8 > tkhd.end) continue;
    const width = buf.readUInt32BE(dimOffset) / 65536;
    const height = buf.readUInt32BE(dimOffset + 4) / 65536;
    if (width > 0 && height > 0) {
      return { seconds: duration / timescale, width: Math.round(width), height: Math.round(height) };
    }
  }
  return null;
}
