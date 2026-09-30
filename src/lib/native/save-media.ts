"use client";

import { capPlugin } from "./bridge";

// Saving a file to the phone from the Android app (operator, 2026-09-30:
// "Android app ... can't download images and videos").
//
// The WebView has no download manager, so an <a download> does nothing at
// all. The app's first answer (2026-08-21) was the system share sheet — and
// on Android that sheet has no "Save" in it: Quick Share, Drive, Maps,
// Messages, "Upload to Photos" (the cloud). Measured on the Pixel 7
// emulator with the operator's own Recast take: Download spun for ~15 s,
// opened that sheet, and nothing ever landed on the phone.
//
// What every installed shell can already do instead (versionCode 4+ carries
// @capacitor/filesystem 8): write the file straight into the phone's shared
// folders — pictures to Pictures/Picacho, videos to Movies/Picacho, anything
// else to Download/Picacho. On Android 11+ an app may create its own files
// there with no permission prompt, and the plugin asks the media scanner to
// index them, so they appear in Google Photos / Samsung Gallery under a
// "Picacho" album. Proven on the emulator (Android 17, 2026-09-30): a 2.1 MB
// take saved byte-identical (same SHA-256), indexed with its size and its
// 5.0 s duration.
//
// Two ways to write, fastest first:
//   1. downloadFile — the plugin fetches the URL natively and streams it to
//      disk. No base64 over the bridge (8.3 s vs 15 s for that same take on
//      the emulator's network). Deprecated upstream in favour of
//      @capacitor/file-transfer, so a future shell may not have it; and it
//      can't read blob:/data: URLs. Media URLs are capability links
//      (lib/media/url.ts), so no cookie is needed.
//   2. The file fetched in the page and written in 1.5 MB base64 pieces
//      (writeFile, then appendFile). Pieces, not one call: a whole video as
//      one base64 string over the bridge is tens of MB on a phone that may
//      have little to spare.
//
// Android 10 and older need WRITE_EXTERNAL_STORAGE, which the manifest does
// not ask for, so the plugin refuses there — the caller then falls back to
// the share sheet (download-button.tsx), which is what those phones had.

export type SavedTo = "gallery" | "downloads";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "heic"]);
const VIDEO_EXT = new Set(["mp4", "m4v", "mov", "webm", "3gp", "mkv"]);

const EXT_FOR_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "application/pdf": "pdf",
  "application/json": "json",
  "application/zip": "zip",
  "text/plain": "txt",
  "text/markdown": "md",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "model/gltf-binary": "glb",
};

// 1.5 MiB of file per piece: a multiple of 3 bytes, so each piece encodes to
// base64 with no padding in the middle of the file.
const PIECE = 3 * 512 * 1024;

function extOf(name: string): string | null {
  const m = /\.([a-z0-9]{2,5})$/i.exec(name);
  return m ? m[1].toLowerCase() : null;
}

function pathExt(url: string): string | null {
  try {
    const u = new URL(url, window.location.href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return extOf(u.pathname);
  } catch {
    return null;
  }
}

function folderFor(ext: string): { dir: string; savedTo: SavedTo; kind: "image" | "video" | "file" } {
  if (IMAGE_EXT.has(ext)) return { dir: "Pictures/Picacho", savedTo: "gallery", kind: "image" };
  if (VIDEO_EXT.has(ext)) return { dir: "Movies/Picacho", savedTo: "gallery", kind: "video" };
  return { dir: "Download/Picacho", savedTo: "downloads", kind: "file" };
}

/**
 * The name the file gets on the phone: the caller's own name when it means
 * something ("my-set-film.mp4"), "picacho-video" when all it has is a storage
 * UUID, and always a time mark, because a name that already exists in a
 * shared folder can belong to an earlier install and refuse the write.
 */
function deviceName(requested: string, ext: string, kind: "image" | "video" | "file"): string {
  let base = requested.replace(/\.[a-z0-9]{2,5}$/i, "");
  base = base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!base || /^[0-9a-f-]{20,}$/i.test(base)) base = `picacho-${kind}`;
  if (!/\d{12,}/.test(base)) base = `${base}-${Date.now()}`;
  return `${base}.${ext}`;
}

function toBase64(part: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const s = String(reader.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    reader.readAsDataURL(part);
  });
}

/** True when this shell can write into the phone's shared folders at all. */
export function canSaveToDevice(): boolean {
  const fs = capPlugin("Filesystem");
  return Boolean(fs?.writeFile);
}

/**
 * Saves `url` into the phone's shared storage and says where it went.
 * Throws when neither way of writing works (no plugin, Android 10's missing
 * permission, a dead URL) — the caller decides what to fall back to.
 */
export async function saveToDevice(
  url: string,
  requestedName: string,
  kind?: "image" | "video",
): Promise<SavedTo> {
  const fs = capPlugin("Filesystem");
  if (!fs?.writeFile) throw new Error("This app can't save files");
  const abs = new URL(url, window.location.href).toString();
  const remote = /^https?:/i.test(abs);
  const directory = "EXTERNAL_STORAGE";

  // 1. Natively, when we can tell what the file is: the stored file's own
  // extension first (callers name every picture ".png", and some engines
  // return JPEG or WebP), then the caller's name, then the kind.
  let ext = pathExt(abs) ?? extOf(requestedName) ?? (kind === "video" ? "mp4" : kind === "image" ? "png" : null);
  if (remote && ext && fs.downloadFile) {
    const folder = folderFor(ext);
    const { dir, savedTo } = folder;
    const path = `${dir}/${deviceName(requestedName, ext, folder.kind)}`;
    try {
      // downloadFile writes into the folder but does not create it.
      await fs.mkdir({ path: dir, directory, recursive: true }).catch(() => {});
      await fs.downloadFile({ url: abs, path, directory, connectTimeout: 15000, readTimeout: 30000 });
      return savedTo;
    } catch {
      // A half-written file would sit in the gallery as a broken video.
      await fs.deleteFile?.({ path, directory }).catch(() => {});
    }
  }

  // 2. Fetched here and written in pieces.
  const res = await fetch(abs);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const type = blob.type.split(";")[0].trim().toLowerCase();
  ext =
    ext ??
    EXT_FOR_TYPE[type] ??
    (type.startsWith("image/") ? "png" : type.startsWith("video/") ? "mp4" : "bin");
  const folder = folderFor(ext);
  const { dir, savedTo } = folder;
  const path = `${dir}/${deviceName(requestedName, ext, folder.kind)}`;
  try {
    let offset = 0;
    do {
      const data = await toBase64(blob.slice(offset, offset + PIECE));
      if (offset === 0) await fs.writeFile({ path, data, directory, recursive: true });
      else await fs.appendFile({ path, data, directory });
      offset += PIECE;
    } while (offset < blob.size);
  } catch (err) {
    await fs.deleteFile?.({ path, directory }).catch(() => {});
    throw err;
  }
  return savedTo;
}
