// The moments of a filmed shot, taken out as stills with the ffmpeg-static
// binary the product already ships (recast/convert-run.ts takes any
// timestamps the same way; spec §1.8 "The ffmpeg sampler takes any
// timestamps"). Local, so it costs function time only.
//
// A route that calls checkMoments must trace the binary into its function:
// next.config.ts outputFileTracingIncludes, as /api/cron/edits and the
// Recast routes do. Without it the binary is missing and every moment is
// "not checked" (never a miss).
//
// Server-only. Relative imports only; `frameArgs` is pure and tested.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const FRAME_TIMEOUT_MS = 20_000;
/** Moments are taken at most this big on the long edge (crop.ts FRAME_EDGE). */
export const MOMENT_LONG_PX = 1536;
/** A shot longer than this is not a Press Tour shot: refused before ffmpeg runs. */
export const MAX_SHOT_BYTES = 200 * 1024 * 1024;

/** ffmpeg's arguments for one still at `seconds` (the recast/convert.ts recastFrameArgs shape). */
export function frameArgs(inputPath: string, outputPath: string, seconds: number, longPx: number = MOMENT_LONG_PX): string[] {
  return [
    "-y",
    "-v",
    "error",
    "-ss",
    Math.max(0, seconds).toFixed(2),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-vf",
    `scale=w='min(${longPx},iw)':h='min(${longPx},ih)':force_original_aspect_ratio=decrease`,
    "-q:v",
    "3",
    "-f",
    "image2",
    "-update",
    "1",
    outputPath,
  ];
}

async function ffmpegBinary(): Promise<string | null> {
  try {
    const mod = (await import("ffmpeg-static")) as unknown as { default?: string | null } | string | null;
    const p = typeof mod === "string" ? mod : (mod?.default ?? null);
    return typeof p === "string" && p ? p : null;
  } catch {
    return null;
  }
}

/**
 * One JPEG per time, or null where that moment could not be taken. Never
 * throws: no binary, an unreadable clip or a timeout is a null moment.
 */
export async function sampleMoments(video: Buffer, times: readonly number[]): Promise<(Buffer | null)[]> {
  if (!Buffer.isBuffer(video) || video.length === 0 || video.length > MAX_SHOT_BYTES) return times.map(() => null);
  const binary = await ffmpegBinary();
  if (!binary) {
    console.error("[product-lock] moments not taken: ffmpeg-static resolved no binary");
    return times.map(() => null);
  }
  const dir = await mkdtemp(path.join(tmpdir(), "product-moments-"));
  const input = path.join(dir, "shot.mp4");
  try {
    await writeFile(input, video);
    const out: (Buffer | null)[] = [];
    for (let i = 0; i < times.length; i++) {
      const file = path.join(dir, `moment-${i}.jpg`);
      try {
        await execFileAsync(binary, frameArgs(input, file, times[i]), { timeout: FRAME_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
        const jpeg = await readFile(file);
        out.push(jpeg.length > 0 ? jpeg : null);
      } catch {
        out.push(null);
      }
    }
    return out;
  } catch {
    return times.map(() => null);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
