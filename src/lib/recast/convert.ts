import { RECAST_MAX_SECONDS } from "./recast";

// Any clip into the MP4 a take stands on (2026-09-25) — the rules; the run is
// convert-run.ts. Pure, so the arguments are pinned by tests without ffmpeg.
//
// Why convert rather than send: the engines are fed an MP4 they can decode,
// the money path reads the length and the frame count from an MP4's own
// boxes (mp4-probe.ts), and the window is cut from one (trim-run.ts). A WebM
// or an AVI is none of those until it is converted — after which every step
// that follows is the one an MP4 upload always took.

/** Long side of a converted clip. Every engine renders at 1080p or under; this keeps a 4K WebM's conversion inside the page's time. */
export const RECAST_CONVERT_LONG_PX = 1920;

/**
 * The conversion never runs past this: a clip over the lane's 30 s still
 * comes out over 30 s, so the length check that follows refuses it exactly
 * as it refuses a long MP4 — and a ten-minute recording is not converted in
 * full only to be refused.
 */
export const RECAST_CONVERT_MAX_SECONDS = RECAST_MAX_SECONDS + 1;

/**
 * The ffmpeg arguments that turn any clip into an H.264/AAC MP4.
 *
 * - Square pixels first (`iw*sar`), then inside 1920 px on the long side,
 *   never enlarged, in even numbers (H.264's 4:2:0 needs them) — an
 *   anamorphic camera file would otherwise reach the engine squeezed.
 * - Turned upright: ffmpeg applies a phone's rotation while it decodes.
 * - `-fps_mode vfr` keeps each frame's own time. A browser recording's WebM
 *   says 1000 frames a second in its header; held to a constant rate the
 *   conversion would copy every frame thirty times over.
 * - The quality of the trim's cut (trim.ts), with a ceiling on the rate so
 *   30 s at 1080p stays inside the bucket's 50 MB (10 Mb/s × 31 s ≈ 39 MB).
 * - Sound kept when there is any, as stereo AAC.
 * - faststart so the provider can begin reading before the download ends.
 */
export function recastConvertArgs(inputPath: string, outputPath: string): string[] {
  const max = RECAST_CONVERT_LONG_PX;
  return [
    "-y",
    "-v",
    "error",
    "-i",
    inputPath,
    "-t",
    String(RECAST_CONVERT_MAX_SECONDS),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    [
      "scale=trunc(iw*sar/2)*2:trunc(ih/2)*2",
      "setsar=1",
      `scale=w='min(${max},iw)':h='min(${max},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    ].join(","),
    "-fps_mode",
    "vfr",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "17",
    "-maxrate",
    "10M",
    "-bufsize",
    "20M",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

/**
 * One still for the read, at `seconds` into the clip, inside 1024 px on the
 * long side (recast-client.ts RECAST_FRAME_LONG_PX, the browser's own
 * sampling). Used when the browser could not decode the file itself — an
 * AVI, a WMV, an HEVC clip in a browser without HEVC — so the read still
 * happens.
 */
export function recastFrameArgs(inputPath: string, outputPath: string, seconds: number, longPx: number, quality: number): string[] {
  return [
    "-y",
    "-v",
    "error",
    "-ss",
    seconds.toFixed(2),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-vf",
    `scale=w='min(${longPx},iw)':h='min(${longPx},ih)':force_original_aspect_ratio=decrease`,
    "-q:v",
    String(quality),
    "-f",
    "image2",
    "-update",
    "1",
    outputPath,
  ];
}
