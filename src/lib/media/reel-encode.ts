// The highlight reel's encoder: three takes in, one small MP4 out.
//
// Alias-free so it can be unit-tested — the caller pulls in Supabase storage
// and the ffmpeg binary, neither of which belongs in a unit test.
//
// WHY RE-ENCODE AT ALL. Concatenating the source files as they are was
// measured on real takes (2026-09-07) and is unsafe: Picacho's takes come from
// different models at different resolutions (1280x720 and 1920x1080 both
// occur), and a stream-copy concat of those produces a file whose container
// advertises the FIRST clip's dimensions for the whole timeline. ffmpeg
// decodes it anyway; browsers — iOS Safari and the Android WebView, which is
// where this ships — are far stricter about a mid-stream resolution change.
// Normalising is mandatory, and normalising is re-encoding.
//
// That turns out to be the whole win rather than a cost. Measured on real
// footage, three takes x 3 seconds:
//
//   untouched sources, 5s each fetched by Range   7,779 KB
//   640x360 24fps crf26                             567 KB
//   640x360 24fps crf30                             358 KB
//   640x360 24fps crf31                             322 KB   <- shipped
//   512x288 24fps crf31                             224 KB
//   640x360 12fps crf31                             316 KB
//
// Two findings from that table drove the settings. Halving the frame rate
// saves ~2% (316 vs 322 KB) because a good encoder spends almost nothing on
// near-static frames — so paying for it in visible judder is a bad trade, and
// the reel stays at 24fps. And 640x360 is an exact 2:1 downscale from 1280x720
// and an exact 3:1 from 1920x1080, so both of Picacho's source resolutions
// land on it without resampling artefacts.
//
// TWO PHASES, ONE ENCODE. Each take is cut and normalised on its own, then the
// finished segments are joined with `-c copy`. Encoding all three in one
// filter graph would need every source on disk at once, and a source can be
// up to the 200 MB persist ceiling — three of those overrun a lambda's 512 MB
// /tmp. Doing it per-segment means peak disk is one source plus a few hundred
// KB, and the join is lossless because the segments already share identical
// codec parameters. Verified on real mixed-resolution footage: 215 KB of
// segments join to a 214 KB reel that decodes clean.

import { createHash } from "node:crypto";

export const REEL_WIDTH = 640;
export const REEL_HEIGHT = 360;
export const REEL_FPS = 24;
export const REEL_CRF = 31;

/**
 * Bumped whenever a change here would produce different BYTES for the same
 * clips. It is mixed into the storage key, so an encoder change lands on a new
 * immutable URL instead of trying to invalidate a year-long cache header.
 */
export const REEL_ENCODER_VERSION = 1;

export type EncodeSegment = {
  /** Local path of the downloaded source take. */
  inputPath: string;
  startSeconds: number;
  durationSeconds: number;
};

/**
 * The storage key for a reel, derived from exactly the inputs that decide its
 * bytes: which generations, cut where, at which encoder version.
 *
 * Deterministic on purpose. The media route serves
 * `public, max-age=31536000, immutable` and signs URLs with a pure function of
 * the path, so a stable key means the browser and Vercel's edge fetch a reel
 * once and never again. When the user's best three change, the key changes,
 * which produces a NEW immutable URL rather than a stale-cache problem.
 */
export function reelStorageKey(
  userId: string,
  segments: { generationId: string; startSeconds: number; durationSeconds: number }[],
): string {
  const fingerprint = segments
    .map((s) => `${s.generationId}@${s.startSeconds}+${s.durationSeconds}`)
    .join("|");
  const hash = createHash("sha256")
    .update(
      [
        `v${REEL_ENCODER_VERSION}`,
        `${REEL_WIDTH}x${REEL_HEIGHT}`,
        `fps${REEL_FPS}`,
        `crf${REEL_CRF}`,
        fingerprint,
      ].join("~"),
    )
    .digest("hex")
    .slice(0, 32);
  return `${userId}/reel/${hash}.mp4`;
}

/**
 * Cut one take and normalise it to the reel's frame.
 *
 * force_original_aspect_ratio=decrease + pad rather than a bare scale, because
 * aspect is user-selectable (16:9 and 9:16 are both offered in the composer)
 * and generations.video_aspect_ratio records which. A bare `scale=640:360`
 * would horizontally squash every vertical take into the landscape frame.
 * Letterboxing keeps the take's own shape and fills the rest with the reel's
 * own black, which is what the hero band shows anyway.
 *
 * Audio is dropped (-an). The reel is muted on the dashboard, so shipping an
 * audio track is pure waste; it measured 125 KB per five seconds.
 */
export function buildSegmentArgs(segment: EncodeSegment, outputPath: string): string[] {
  return [
    "-y",
    "-v",
    "error",
    // -ss BEFORE -i is the fast seek: ffmpeg jumps to the nearest keyframe
    // rather than decoding the whole file up to the in-point.
    "-ss",
    String(segment.startSeconds),
    "-t",
    String(segment.durationSeconds),
    "-i",
    segment.inputPath,
    "-filter_complex",
    `[0:v]scale=${REEL_WIDTH}:${REEL_HEIGHT}:force_original_aspect_ratio=decrease,` +
      `pad=${REEL_WIDTH}:${REEL_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,` +
      `fps=${REEL_FPS},setsar=1[v]`,
    "-map",
    "[v]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryslow",
    "-crf",
    String(REEL_CRF),
    "-pix_fmt",
    "yuv420p",
    // Main rather than high: universally decodable on the Android WebView
    // versions this ships to, and at 640x360 the profile costs nothing
    // measurable.
    "-profile:v",
    "main",
    // A keyframe exactly on each segment boundary, and no scene-cut keyframes
    // to shift it. Without this the lossless join below can start a segment
    // mid-GOP, which decodes as a smear until the next keyframe.
    "-x264-params",
    `keyint=${REEL_FPS}:min-keyint=${REEL_FPS}:scenecut=0`,
    outputPath,
  ];
}

/**
 * Join finished segments without re-encoding them.
 *
 * Safe here — and only here — because every segment came out of
 * buildSegmentArgs with identical codec parameters, which is the condition the
 * concat demuxer needs. `listPath` is a file of `file '<abs path>'` lines that
 * the caller writes.
 */
export function buildConcatArgs(listPath: string, outputPath: string): string[] {
  return [
    "-y",
    "-v",
    "error",
    "-f",
    "concat",
    // The list holds absolute paths under our own temp dir, never user input.
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    // The index at the FRONT, so playback can start on the first bytes instead
    // of waiting for a trailing moov. The repo already treats this as
    // load-bearing for delivered video (lib/media/faststart.ts).
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

/** The concat demuxer's list file, one absolute path per line. */
export function buildConcatList(segmentPaths: string[]): string {
  if (segmentPaths.length === 0) throw new Error("buildConcatList: no segments");
  // Single quotes are the demuxer's escape; a path containing one would break
  // the list. Ours are `<tmp>/reel-<uuid>/seg0.mp4`, but assert rather than
  // assume — a malformed list is a confusing ffmpeg error much later.
  for (const p of segmentPaths) {
    if (p.includes("'") || p.includes("\n")) throw new Error(`buildConcatList: unsafe path ${p}`);
  }
  return `${segmentPaths.map((p) => `file '${p}'`).join("\n")}\n`;
}

/**
 * The reel's own poster, taken from its first frame.
 *
 * Not optional. The band paints this server-side, so the dashboard shows the
 * reel's opening frame instead of a black rectangle while the video loads —
 * and it is the ONLY thing a viewer on a metered connection or with
 * prefers-reduced-motion ever downloads, at roughly 25 KB against the reel's
 * ~322 KB. Without a poster there is nothing to fall back TO, and the
 * data-saver path would have to show black.
 *
 * .jpg rather than .png because /api/media only resizes png/jpg/jpeg/webp, so
 * this one file can also be served at 320 wide by thumbUrl.
 */
export function buildPosterArgs(reelPath: string, outputPath: string): string[] {
  return [
    "-y",
    "-v",
    "error",
    "-i",
    reelPath,
    "-frames:v",
    "1",
    // q:v 4 is visually clean at this size and lands around 25 KB; the poster
    // must never be a meaningful fraction of the reel it stands in for.
    "-q:v",
    "4",
    outputPath,
  ];
}

/** The poster that belongs to a reel, derived from the reel's own key. */
export function reelPosterKeyFor(storagePath: string): string {
  return storagePath.replace(/\.mp4$/, ".jpg");
}

/** Total seconds the built reel will run. */
export function reelDurationSeconds(segments: { durationSeconds: number }[]): number {
  return segments.reduce((total, s) => total + s.durationSeconds, 0);
}
