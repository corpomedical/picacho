// Builds one user's dashboard highlight reel.
//
// Operator's brief (2026-09-07): "the website takes best scoring videos
// generated, 3 at max. Making a one video with 3 to 5 seconds of footage from
// each", built "with the lowest data consumption possible and cacheable".
//
// The pure halves live elsewhere so they can be unit-tested — reel-select.ts
// decides WHICH takes and WHERE to cut them, reel-encode.ts decides the argv
// and the storage key. This module is the impure part: storage in, ffmpeg,
// storage out, one row written.
//
// It never throws. A reel is decoration on a dashboard that has to render
// anyway, and this runs in a cron sweeping many users — one bad row must not
// take the others down. Every failure path returns a status the caller logs.
//
// DISK. Each take is downloaded, cut, and DELETED before the next is fetched,
// because a source can be up to the 200 MB persist ceiling and a lambda's /tmp
// is 512 MB. Peak usage is one source plus a few hundred KB of finished
// segments.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import type { createAdminClient } from "@/lib/supabase/server";
import { mediaStoragePath } from "@/lib/media/url";
import {
  buildConcatArgs,
  buildConcatList,
  buildPosterArgs,
  buildSegmentArgs,
  reelDurationSeconds,
  reelPosterKeyFor,
  reelStorageKey,
} from "@/lib/media/reel-encode";
import { selectReel, type ReelRow } from "@/lib/generations/reel-select";

const execFileAsync = promisify(execFile);

/** Rows considered when ranking. See reel-select.ts for what this window means. */
const WINDOW_ROWS = 150;

/**
 * Per-source ceiling. Above this the take is skipped rather than downloaded:
 * three 200 MB sources would not fit /tmp even one at a time alongside the
 * rest of the run, and a take that large is a 4K outlier, not the common case.
 */
const MAX_SOURCE_BYTES = 120 * 1024 * 1024;

/** ffmpeg wall-clock ceiling per invocation. Measured: ~2s for a 9s reel. */
const FFMPEG_TIMEOUT_MS = 60_000;

export type ReelBuildResult =
  | {
      status: "built";
      storagePath: string;
      posterPath: string | null;
      byteSize: number;
      durationSeconds: number;
    }
  | { status: "unchanged"; storagePath: string }
  | { status: "retired"; reason: string }
  | { status: "skipped"; reason: string };

// The service-role client, taken from its own factory rather than restated —
// same convention as workspace-data.ts. Passing the type in keeps this module
// free of a runtime Supabase import it does not need.
type AdminClient = ReturnType<typeof createAdminClient>;

async function runFfmpeg(args: string[]): Promise<void> {
  if (!ffmpegPath) throw new Error("ffmpeg-static resolved no binary path");
  await execFileAsync(ffmpegPath, args, {
    timeout: FFMPEG_TIMEOUT_MS,
    // ffmpeg is run with `-v error`, so anything on stderr is a real fault and
    // is short. A big buffer here would only mask a runaway.
    maxBuffer: 1024 * 1024,
  });
}

export async function buildUserReel(
  admin: AdminClient,
  userId: string,
): Promise<ReelBuildResult> {
  if (!ffmpegPath) {
    // Deploy-time problem, not a data problem — worth its own status so the
    // cron log says "no encoder" rather than "no reel for 40 users".
    return { status: "skipped", reason: "ffmpeg-binary-missing" };
  }

  const { data: rows, error } = await admin
    .from("generations")
    // One literal, not a concatenation: supabase-js infers the row type from
    // the select string, and it can only do that when the string is literal.
    // Built from pieces, every column comes back typed as an error placeholder.
    .select(
      "id, result_url, poster_url, content_type, status, character_profile_id, match_score, created_at, video_duration_seconds, video_aspect_ratio, prompt_input, angle_group_id, angle",
    )
    .eq("user_id", userId)
    .eq("status", "succeeded")
    .eq("content_type", "video")
    // deleteGeneration soft-deletes the ROW and hard-deletes the FILE, so a
    // deleted take matches every other clause and then 404s on download.
    .is("deleted_at", null)
    .not("result_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(WINDOW_ROWS);

  if (error) return { status: "skipped", reason: `read-failed: ${error.message}` };

  const selection = selectReel((rows ?? []) as ReelRow[]);

  // Someone who no longer qualifies must LOSE their reel, not keep the last
  // one forever. The quality bar otherwise only governs new builds, so a reel
  // that stopped being good enough — the bar was raised, its character was
  // deleted, its takes were removed — would sit on the dashboard indefinitely
  // with nothing rebuilding or removing it.
  if (!selection) {
    const { data: stale } = await admin
      .from("user_reels")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (stale?.storage_path) {
      await admin.from("user_reels").delete().eq("user_id", userId);
      await admin.storage
        .from("generated-videos")
        .remove([stale.storage_path, reelPosterKeyFor(stale.storage_path)])
        .catch(() => {});
      return { status: "retired", reason: "no-longer-qualifies" };
    }
    return { status: "skipped", reason: "no-eligible-takes" };
  }

  const storagePath = reelStorageKey(userId, selection.clips);

  const { data: existing } = await admin
    .from("user_reels")
    // select("*") rather than a column list: naming a column that has not been
    // migrated yet fails the whole read in PostgREST, which on 2026-09-07 took
    // the reel off every dashboard at once. Same reasoning as /app/page.tsx.
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  // "Unchanged" has to mean the whole ROW is what the band needs, not just that
  // the video bytes would be identical.
  //
  // The key is a hash of exactly the inputs that decide the bytes, so an equal
  // key does mean an identical file — re-encoding it would burn CPU to produce
  // the same thing at the same immutable URL. But the row carries more than the
  // file, and twice now a field arrived after the reels did:
  //
  //   - the poster, which can fail on its own. Comparing only the video key
  //     left a reel whose poster failed stuck without one forever, opening on
  //     black for that user permanently.
  //   - clips, added 2026-09-07 for the segmented bar, the slug and the meter.
  //     Every existing reel had an empty array and no run would ever refill it,
  //     so the design would simply never have appeared for anyone who already
  //     had a reel.
  //
  // So completeness is judged on what the band reads, and anything missing
  // earns another build. `clips` is only required when the column is actually
  // present — otherwise a deploy that runs ahead of its migration would rebuild
  // every reel every hour instead of quietly doing nothing.
  const clipsColumnExists = Boolean(existing) && "clips" in (existing as object);
  const clipsPopulated =
    !clipsColumnExists || (Array.isArray(existing?.clips) && existing.clips.length > 0);
  if (existing?.storage_path === storagePath && existing.poster_path && clipsPopulated) {
    return { status: "unchanged", storagePath };
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "reel-"));
  try {
    const segmentPaths: string[] = [];

    for (const [index, clip] of selection.clips.entries()) {
      const source = mediaStoragePath(clip.resultUrl);
      // An external provider URL or an unrecognised bucket: not ours to read
      // from storage, and not worth a network fetch inside a cron.
      if (!source) continue;

      const { data: blob, error: dlError } = await admin.storage
        .from(source.bucket)
        .download(source.path);
      if (dlError || !blob) continue;

      const bytes = Buffer.from(await blob.arrayBuffer());
      if (bytes.byteLength > MAX_SOURCE_BYTES) continue;

      const sourcePath = path.join(workDir, `src${index}.mp4`);
      const segmentPath = path.join(workDir, `seg${index}.mp4`);
      await writeFile(sourcePath, bytes);
      try {
        await runFfmpeg(
          buildSegmentArgs(
            {
              inputPath: sourcePath,
              startSeconds: clip.startSeconds,
              durationSeconds: clip.durationSeconds,
            },
            segmentPath,
          ),
        );
        segmentPaths.push(segmentPath);
      } finally {
        // Freed before the next source is fetched — the whole point of cutting
        // one take at a time.
        await unlink(sourcePath).catch(() => {});
      }
    }

    if (segmentPaths.length === 0) {
      return { status: "skipped", reason: "no-segments-encoded" };
    }

    const listPath = path.join(workDir, "list.txt");
    const outputPath = path.join(workDir, `${randomUUID()}.mp4`);
    await writeFile(listPath, buildConcatList(segmentPaths));
    await runFfmpeg(buildConcatArgs(listPath, outputPath));

    const reel = await readFile(outputPath);

    const { error: upError } = await admin.storage
      .from("generated-videos")
      // upsert so a retry after a partial failure lands on the same key rather
      // than failing forever on a half-written object.
      .upload(storagePath, reel, { contentType: "video/mp4", upsert: true });
    if (upError) return { status: "skipped", reason: `upload-failed: ${upError.message}` };

    // The poster is what the band paints server-side, and the only thing a
    // metered or reduced-motion viewer downloads. Best-effort: a reel without
    // one still plays, it just opens on black for a moment.
    const posterKey = reelPosterKeyFor(storagePath);
    let posterPath: string | null = null;
    try {
      const posterFile = path.join(workDir, "poster.jpg");
      await runFfmpeg(buildPosterArgs(outputPath, posterFile));
      const posterBytes = await readFile(posterFile);
      const { error: posterError } = await admin.storage
        .from("generated-videos")
        .upload(posterKey, posterBytes, { contentType: "image/jpeg", upsert: true });
      if (posterError) {
        console.warn("Reel poster upload failed.", { userId, message: posterError.message });
      } else {
        posterPath = posterKey;
      }
    } catch (err) {
      // Best-effort, but never silent: without a poster the band opens on black
      // and a save-data viewer has nothing to fall back to, so this is worth
      // seeing in the log rather than inferring from a null column.
      console.warn("Reel poster encode failed.", {
        userId,
        message: err instanceof Error ? err.message.slice(0, 300) : "unknown",
      });
      posterPath = null;
    }

    // Only the clips that actually made it into the file are recorded, so the
    // row never claims a take the reel does not contain.
    const usedClips = selection.clips.slice(0, segmentPaths.length);
    const durationSeconds = reelDurationSeconds(usedClips);

    const { error: rowError } = await admin.from("user_reels").upsert(
      {
        user_id: userId,
        storage_path: storagePath,
        poster_path: posterPath,
        character_profile_id: selection.characterProfileId,
        clip_generation_ids: usedClips.map((c) => c.generationId),
        duration_seconds: durationSeconds,
        byte_size: reel.byteLength,
        takes: selection.takes,
        mean_identity: selection.meanIdentity,
        // Per-cut detail for the band: the segmented bar, the identity meter
        // and the slug that names each cut all read from here rather than
        // joining back to generations on every dashboard load.
        clips: usedClips.map((c) => ({
          id: c.generationId,
          score: c.matchScore,
          seconds: c.durationSeconds,
          label: c.label,
        })),
        built_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (rowError) return { status: "skipped", reason: `row-failed: ${rowError.message}` };

    // The old reel is unreachable the moment the row moves, and its URL is
    // immutable-cached for a year, so nothing can be pointing at it that would
    // notice. Best-effort: a failure here costs storage, not correctness.
    if (existing?.storage_path && existing.storage_path !== storagePath) {
      await admin.storage
        .from("generated-videos")
        .remove([existing.storage_path, reelPosterKeyFor(existing.storage_path)])
        .catch(() => {});
    }

    return {
      status: "built",
      storagePath,
      posterPath,
      byteSize: reel.byteLength,
      durationSeconds,
    };
  } catch (err) {
    return {
      status: "skipped",
      reason: `build-failed: ${err instanceof Error ? err.message.slice(0, 200) : "unknown"}`,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
