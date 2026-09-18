import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import type { createAdminClient } from "@/lib/supabase/server";
import { probeMp4 } from "@/lib/media/mp4-probe";
import { RECAST_BUCKET, recastSourcePath, type RecastClip } from "@/lib/recast/recast";
import { recastTrimArgs, type RecastFit, type RecastWindow } from "@/lib/recast/trim";

// The cut itself — server only. The window's rules and arguments are pure
// (trim.ts); this runs them. The same ffmpeg-static binary the reels cron
// uses, traced into this route the same way (next.config.ts).
//
// The cut is a NEW clip in the person's own folder, with its own id: the
// original stays where it is, so the take can be recut differently later,
// and several windows of one upload can each stand as a take.

const execFileAsync = promisify(execFile);

/** A 10 s window of 1440p footage re-encodes in seconds; this is the runaway guard. */
const TRIM_TIMEOUT_MS = 120_000;

type Admin = ReturnType<typeof createAdminClient>;

export type TrimmedClip = { path: string; clipId: string; clip: RecastClip };

export async function cutRecastWindow(
  admin: Admin,
  userId: string,
  source: Buffer,
  window: RecastWindow,
  /** The size and frame rate the engine needs, when the clip is outside them (trim.ts recastFitFor). */
  fit: RecastFit | null = null,
): Promise<TrimmedClip | { error: "no-encoder" | "cut-failed" | "unreadable" | "store-failed" }> {
  if (!ffmpegPath) {
    console.error("[recast] trim skipped: ffmpeg-static resolved no binary path");
    return { error: "no-encoder" };
  }
  const dir = await mkdtemp(path.join(tmpdir(), "recast-trim-"));
  const input = path.join(dir, "in.mp4");
  const output = path.join(dir, "out.mp4");
  try {
    await writeFile(input, source);
    try {
      await execFileAsync(ffmpegPath, recastTrimArgs(input, output, window, fit), { timeout: TRIM_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
    } catch (err) {
      console.error("[recast] trim failed:", err instanceof Error ? err.message.slice(0, 300) : err);
      return { error: "cut-failed" };
    }
    const bytes = await readFile(output);
    // The money path reads the file: the cut is probed like any upload.
    const probe = probeMp4(bytes);
    if (!probe) return { error: "unreadable" };

    const clipId = crypto.randomUUID();
    const stored = recastSourcePath(userId, clipId, "mp4");
    const { error: uploadError } = await admin.storage.from(RECAST_BUCKET).upload(stored, bytes, { contentType: "video/mp4", upsert: false });
    if (uploadError) {
      console.error("[recast] trim upload failed:", uploadError.message);
      return { error: "store-failed" };
    }
    return {
      path: stored,
      clipId,
      clip: { seconds: probe.seconds, frames: probe.frames, width: probe.width, height: probe.height, bytes: bytes.length },
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
