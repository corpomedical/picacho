import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import type { createAdminClient } from "@/lib/supabase/server";
import { probeMp4 } from "@/lib/media/mp4-probe";
import { RECAST_BUCKET, recastSourcePath, type RecastClip, type RecastUploadFormat } from "@/lib/recast/recast";
import { recastConvertArgs, recastFrameArgs } from "@/lib/recast/convert";
import { RECAST_FRAME_COUNT, recastSampleTimes } from "@/lib/recast/recast-read";
import { RECAST_FRAME_LONG_PX, RECAST_FRAME_MAX_BYTES, RECAST_FRAMES_TOTAL_BYTES } from "@/lib/recast/recast-client";

// The conversion itself — server only. The arguments are pure (convert.ts);
// this runs them with the same ffmpeg-static binary the trim uses, traced
// into /app/mystique (next.config.ts).
//
// The converted clip takes the upload's own id and becomes <id>.mp4 in the
// person's folder; the file they sent is removed by the caller once the MP4
// is stored. From there it is an MP4 upload like any other.

const execFileAsync = promisify(execFile);

/**
 * Past this the conversion is abandoned. 31 s of 1080p re-encodes in well
 * under a minute; a 4K WebM decoded in software is the slow case, and the
 * page has 300 s in all, the read included.
 */
const CONVERT_TIMEOUT_MS = 180_000;
const FRAME_TIMEOUT_MS = 20_000;

/** ffmpeg's JPEG quality scale, best first: a frame over the read's byte limit is taken again coarser. */
const FRAME_QUALITIES = [4, 7, 11];

type Admin = ReturnType<typeof createAdminClient>;

export type ConvertedClip = { path: string; clip: RecastClip; bytes: Buffer; frames: string[] };

/**
 * The upload, converted to an MP4 and stored at <takeId>.mp4 — over the
 * upload itself when that was an .mp4 whose insides the engines cannot take.
 * With `frames`, stills for the read are taken from the converted file while
 * it is still on disk.
 */
export async function convertRecastUpload(
  admin: Admin,
  userId: string,
  takeId: string,
  source: Buffer,
  format: RecastUploadFormat,
  frames: boolean,
): Promise<ConvertedClip | { error: "no-encoder" | "convert-failed" | "unreadable" | "store-failed" }> {
  if (!ffmpegPath) {
    console.error("[recast] convert skipped: ffmpeg-static resolved no binary path");
    return { error: "no-encoder" };
  }
  const dir = await mkdtemp(path.join(tmpdir(), "recast-convert-"));
  const input = path.join(dir, `in.${format}`);
  const output = path.join(dir, "out.mp4");
  try {
    await writeFile(input, source);
    try {
      await execFileAsync(ffmpegPath, recastConvertArgs(input, output), { timeout: CONVERT_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
    } catch (err) {
      console.error(`[recast] convert failed (${format}):`, err instanceof Error ? err.message.slice(0, 300) : err);
      return { error: "convert-failed" };
    }
    const bytes = await readFile(output);
    // The money path reads the file: the conversion is probed like any upload.
    const probe = probeMp4(bytes);
    if (!probe) return { error: "unreadable" };
    const clip: RecastClip = { seconds: probe.seconds, frames: probe.frames, width: probe.width, height: probe.height, bytes: bytes.length };

    const stored = recastSourcePath(userId, takeId, "mp4");
    const { error: uploadError } = await admin.storage
      .from(RECAST_BUCKET)
      .upload(stored, bytes, { contentType: "video/mp4", upsert: format === "mp4" });
    if (uploadError) {
      console.error("[recast] converted clip upload failed:", uploadError.message);
      return { error: "store-failed" };
    }
    return { path: stored, clip, bytes, frames: frames ? await framesOf(dir, output, clip.seconds) : [] };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Stills for the read from a clip the browser could not decode but the
 * server can (an HEVC clip in a browser without HEVC). Best-effort: no
 * stills is a clip that is simply not understood, never a refusal.
 */
export async function sampleRecastFrames(source: Buffer, format: RecastUploadFormat, seconds: number): Promise<string[]> {
  if (!ffmpegPath) return [];
  const dir = await mkdtemp(path.join(tmpdir(), "recast-frames-"));
  const input = path.join(dir, `in.${format}`);
  try {
    await writeFile(input, source);
    return await framesOf(dir, input, seconds);
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** The browser's sampling (recast-client.ts sampleClip), done by ffmpeg: the same times, size and byte limits. */
async function framesOf(dir: string, input: string, seconds: number): Promise<string[]> {
  if (!ffmpegPath || !(seconds > 0)) return [];
  const out: string[] = [];
  let total = 0;
  const times = recastSampleTimes(seconds, RECAST_FRAME_COUNT);
  for (let i = 0; i < times.length; i++) {
    let frame: Buffer | null = null;
    for (const quality of FRAME_QUALITIES) {
      const file = path.join(dir, `frame-${i}-${quality}.jpg`);
      try {
        await execFileAsync(ffmpegPath, recastFrameArgs(input, file, times[i], RECAST_FRAME_LONG_PX, quality), {
          timeout: FRAME_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        });
        const jpeg = await readFile(file);
        if (jpeg.length > 0 && jpeg.length <= RECAST_FRAME_MAX_BYTES) {
          frame = jpeg;
          break;
        }
      } catch {
        break;
      }
    }
    // As in the browser: one frame that cannot be had ends the sampling, and
    // what was gathered is still a read.
    if (frame === null || total + frame.length > RECAST_FRAMES_TOTAL_BYTES) break;
    total += frame.length;
    out.push(`data:image/jpeg;base64,${frame.toString("base64")}`);
  }
  return out;
}
