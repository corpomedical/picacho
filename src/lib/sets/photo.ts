// A Set's source photo, on the server (Sets from a photo, docs 3.2,
// 2026-09-11). Relative imports only and the Supabase client passed in, so
// the test suite loads this file as it is.
//
// THE ONLY MODULE IN src/ THAT NAMES THE PHOTO COLUMNS (photo.test.ts scans
// for it). They arrive with supabase/pending/astra-photo-sets.sql, and until
// the operator runs it they do not exist — and PostgREST fails a whole
// statement that names a missing column (42703 on a read, PGRST204 on a
// write). So no existing query names them: a build's kind is read here, in
// its own query, whose failure reads as "a text build" — which it must be,
// because a photo build cannot be written without the columns. Text sets
// keep working in either order; a photo build before the SQL stops at its
// first write with an admin-facing sentence, before anything is spent.
//
// THE PHOTO IS THE PERSON'S DATA. It is re-encoded here before anything else
// sees it (sharp, which drops EXIF — GPS included — and bounds the pixels the
// input-token budget rests on), judged by the picture check, stored under
// the person's own folder in a bucket account deletion sweeps, and removed
// with the set. A retry resends it only if its bytes still hash to what
// passed the check: the owner can write to their own folder.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_SET_PHOTO_BYTES, SET_PHOTO_MAX_SIDE_PX, photoFit, setPhotoPath } from "./set-config";
import {
  SET_BUILD_COULDNT_START,
  SET_PHOTO_BAD_SHAPE,
  SET_PHOTO_TOO_LARGE,
  SET_PHOTO_TOO_SMALL,
  SET_PHOTO_UNREADABLE,
} from "./messages";

const BUCKET = "generated-images";
const SHA256_RE = /^[0-9a-f]{64}$/;

export const PHOTO_SOURCE_SELECT = "id, source_photo_path, source_photo_sha256";

/** Written in the same insert that reserves a photo build's row. */
export function photoSourceColumns(userId: string, setId: string, sha256: string) {
  return { source_photo_path: setPhotoPath(userId, setId), source_photo_sha256: sha256 };
}

/** Cleared when a set is deleted: the photo's hash is the person's data, like the brief. */
export const CLEAR_PHOTO_SOURCE = { source_photo_path: null, source_photo_sha256: null } as const;

/** A column the statement named is not in the database: PGRST204 on a write, 42703 on a read. */
export function isMissingColumn(err: { code?: string } | null | undefined): boolean {
  return err?.code === "PGRST204" || err?.code === "42703";
}

const warned = new Set<string>();
function warnOnce(op: string, message: string) {
  if (warned.has(op)) return;
  warned.add(op);
  console.warn(`[sets] photo ${op} failed (further failures of this kind are not logged): ${message}`);
}

// ---------------------------------------------------------------------------
// The upload
// ---------------------------------------------------------------------------

const JPEG_DATA_URI = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
// Checked on the string before anything is decoded: base64 is 4 characters
// per 3 bytes, plus the "data:image/jpeg;base64," head.
const MAX_DATA_URI_CHARS = Math.ceil((MAX_SET_PHOTO_BYTES * 4) / 3) + 32;

/** The browser's prepared JPEG (photo-client.ts), checked before it is decoded. */
export function parseSetPhotoDataUri(uri: unknown): { ok: true; bytes: Buffer } | { ok: false; error: string } {
  if (typeof uri !== "string") return { ok: false, error: SET_PHOTO_UNREADABLE };
  if (uri.length > MAX_DATA_URI_CHARS) return { ok: false, error: SET_PHOTO_TOO_LARGE };
  if (!JPEG_DATA_URI.test(uri)) return { ok: false, error: SET_PHOTO_UNREADABLE };
  const bytes = Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");
  if (bytes.byteLength > MAX_SET_PHOTO_BYTES) return { ok: false, error: SET_PHOTO_TOO_LARGE };
  if (bytes.byteLength < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return { ok: false, error: SET_PHOTO_UNREADABLE };
  }
  return { ok: true, bytes };
}

/**
 * Re-encode the photo on the server, whatever the browser sent: upright,
 * at most SET_PHOTO_MAX_SIDE_PX on the long side, sRGB JPEG with NO metadata
 * (sharp keeps none unless asked, so EXIF, GPS and ICC go). Raw client bytes
 * are never passed on: without sharp, photo builds are refused.
 */
export async function normaliseSetPhoto(
  bytes: Buffer,
): Promise<{ ok: true; jpeg: Buffer; width: number; height: number; sha256: string } | { ok: false; error: string }> {
  let sharp: (typeof import("sharp"))["default"];
  try {
    ({ default: sharp } = await import("sharp"));
  } catch {
    console.error("[sets] sharp unavailable; photo builds refused");
    return { ok: false, error: SET_BUILD_COULDNT_START };
  }
  let out: { data: Buffer; info: { width: number; height: number } };
  try {
    out = await sharp(bytes, { limitInputPixels: 25_000_000, failOn: "error" })
      .rotate()
      .resize({ width: SET_PHOTO_MAX_SIDE_PX, height: SET_PHOTO_MAX_SIDE_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    return { ok: false, error: SET_PHOTO_UNREADABLE };
  }
  const fit = photoFit(out.info.width, out.info.height);
  if (!fit.ok) return { ok: false, error: fit.reason === "small" ? SET_PHOTO_TOO_SMALL : SET_PHOTO_BAD_SHAPE };
  const sha256 = createHash("sha256").update(out.data).digest("hex");
  return { ok: true, jpeg: out.data, width: out.info.width, height: out.info.height, sha256 };
}

/** The picture check and Astra both take the bytes themselves, never a link. */
export const photoDataUrl = (jpeg: Buffer) => `data:image/jpeg;base64,${jpeg.toString("base64")}`;

// ---------------------------------------------------------------------------
// Reading it back
// ---------------------------------------------------------------------------

export type PhotoSource = { path: string; sha256: string };

/**
 * Which of these sets were built from a photo, and where the photo is. ANY
 * error — the columns not there yet above all — reads as "none of them": a
 * text build, which is what every set is until the SQL has run. A row counts
 * only when its path is exactly the owner's own photo path for that set.
 */
export async function readPhotoSources(db: SupabaseClient, ids: string[], userId: string): Promise<Map<string, PhotoSource>> {
  const out = new Map<string, PhotoSource>();
  if (ids.length === 0) return out;
  try {
    const { data, error } = await db
      .from("location_sets")
      .select(PHOTO_SOURCE_SELECT)
      .in("id", ids)
      .eq("user_id", userId);
    if (error) {
      warnOnce("source read", error.message);
      return out;
    }
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const id = row.id;
      const path = row.source_photo_path;
      const sha256 = row.source_photo_sha256;
      if (typeof id !== "string" || typeof path !== "string" || typeof sha256 !== "string") continue;
      if (path !== setPhotoPath(userId, id) || !SHA256_RE.test(sha256)) continue;
      out.set(id, { path, sha256 });
    }
  } catch (err) {
    warnOnce("source read", err instanceof Error ? err.message : String(err));
  }
  return out;
}

/**
 * The stored photo as a data URL — only if its bytes are the ones that
 * passed the picture check. Null on any failure or mismatch: the caller then
 * sends nothing.
 */
export async function readStoredPhoto(admin: SupabaseClient, src: PhotoSource): Promise<string | null> {
  try {
    const { data, error } = await admin.storage.from(BUCKET).download(src.path);
    if (error || !data) return null;
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.byteLength === 0) return null;
    if (createHash("sha256").update(bytes).digest("hex") !== src.sha256) {
      console.warn("[sets] a stored set photo no longer matches what passed the picture check; not resent");
      return null;
    }
    return photoDataUrl(bytes);
  } catch {
    return null;
  }
}

/** Best-effort: remove a set's photo. Harmless when there is none. Never throws. */
export async function removeSetPhoto(admin: SupabaseClient, userId: string, setId: string): Promise<void> {
  try {
    const { error } = await admin.storage.from(BUCKET).remove([setPhotoPath(userId, setId)]);
    if (error) warnOnce("remove", error.message);
  } catch (err) {
    warnOnce("remove", err instanceof Error ? err.message : String(err));
  }
}
