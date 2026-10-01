// Where the free "P" goes on (operator, 2026-10-02: "Wire it in"): every
// download and share of a free account's OWN picture or video leaves with
// the mark (free-mark.ts); paid plans, comped plans, admins and anyone who
// holds bought credits get the file as it was made.
//
// Marked on the way out, not when the render is stored: the original is
// never touched, so an account that upgrades downloads everything it ever
// made clean, at once, with nothing to rewrite. The marked copy is made on
// the first download and kept beside the original at <owner>/marked/<file>,
// so the second download is a plain read.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { burnFreeMarkImage, burnFreeMarkVideo } from "./free-mark";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp"]);
const VIDEO_EXT = new Set(["mp4", "mov"]);
const MARKED_DIR = "marked";

export type ExportProfile = {
  plan: string | null;
  role: string | null;
  purchased_credits: number | null;
};

function ext(p: string): string {
  return p.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * Whether this download leaves with the mark: the requester's own render, in
 * a render bucket, a picture or video, and a free account (no plan, not an
 * admin, no bought credits left). Anything else downloads as it was made.
 */
export function freeMarkApplies(
  requesterId: string | null,
  profile: ExportProfile | null,
  bucket: string,
  objectPath: string,
): boolean {
  if (!requesterId || !profile) return false;
  if (bucket !== "generated-images" && bucket !== "generated-videos") return false;
  const [owner, ...rest] = objectPath.split("/");
  if (owner !== requesterId || rest.length === 0 || rest[0] === MARKED_DIR) return false;
  const e = ext(objectPath);
  if (!IMAGE_EXT.has(e) && !VIDEO_EXT.has(e)) return false;
  if (profile.role === "admin") return false;
  if ((profile.purchased_credits ?? 0) > 0) return false;
  return (profile.plan ?? "none") === "none";
}

/** <owner>/marked/<rest>; a video always lands as .mp4 (the burn writes MP4). */
export function markedPath(objectPath: string): string {
  const [owner, ...rest] = objectPath.split("/");
  const tail = rest.join("/");
  return `${owner}/${MARKED_DIR}/${VIDEO_EXT.has(ext(tail)) ? tail.replace(/\.[^.]+$/, ".mp4") : tail}`;
}

export function contentTypeFor(objectPath: string): string {
  switch (ext(objectPath)) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return "video/mp4";
  }
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
 * The marked copy's bytes: read from <owner>/marked/ when an earlier download
 * made it, otherwise burned from the original now and stored there. Null when
 * the original can't be read or the burn fails; the caller then serves the
 * original rather than fail a download.
 */
export async function markedCopy(
  admin: SupabaseClient,
  bucket: string,
  objectPath: string,
): Promise<{ bytes: Buffer; contentType: string; path: string } | null> {
  const target = markedPath(objectPath);
  const contentType = contentTypeFor(target);
  const kept = await admin.storage.from(bucket).download(target);
  if (kept.data) return { bytes: Buffer.from(await kept.data.arrayBuffer()), contentType, path: target };

  const original = await admin.storage.from(bucket).download(objectPath);
  if (original.error || !original.data) return null;
  const input = Buffer.from(await original.data.arrayBuffer());

  let bytes: Buffer;
  if (IMAGE_EXT.has(ext(objectPath))) {
    bytes = await burnFreeMarkImage(input);
  } else {
    const ffmpeg = await ffmpegBinary();
    if (!ffmpeg) {
      console.error("[free-mark] no ffmpeg binary on this route; serving the original");
      return null;
    }
    const dir = await mkdtemp(path.join(tmpdir(), "free-mark-"));
    try {
      const src = path.join(dir, `in.${ext(objectPath)}`);
      const dest = path.join(dir, "out.mp4");
      await writeFile(src, input);
      await burnFreeMarkVideo(ffmpeg, src, dest);
      bytes = await readFile(dest);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // Kept for the next download. A second download racing this one finds the
  // file already there; either copy is the same mark on the same original.
  const { error } = await admin.storage.from(bucket).upload(target, bytes, { contentType, upsert: false });
  if (error && !/already exists|duplicate/i.test(error.message)) {
    console.warn(`[free-mark] couldn't keep the marked copy (${error.message}); serving it anyway`);
  }
  return { bytes, contentType, path: target };
}
