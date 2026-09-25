// The editable project behind each delivered video (the pro editor, operator
// 2026-09-25: "I also need a track to visualize the video cuts and audio are
// placed as a professional video editor"; he picked board A, the Edit Bay).
//
// Opus builds every video as a HyperFrames project. With the video it now
// hands over that project packed as a plain tar, footage left out (we hold the
// footage: the project refers to it as footage/clip-N.<ext>). Delivery unpacks
// it into the private footage bucket; the editor opens its index.html in the
// HyperFrames SDK, and a sealed preview frame plays it from
// /api/edit-project/<token>/… so every relative link in it resolves on its own.
//
// The token is the only key to that route: it names one edit and one video,
// expires, and is signed like our media URLs. The preview frame is sandboxed
// without allow-same-origin, so a script in the project (Opus wrote it, from a
// customer's brief) runs with no access to picacho.ai, its cookies or its pages.

import { mediaSig } from "../media/url";

/** A packed project bigger than this is not kept (footage is not in it; this is effects, music, stills). */
export const PROJECT_MAX_BYTES = 150 * 1024 * 1024;
export const PROJECT_MAX_FILES = 400;
/** How long a preview token opens the project. */
export const PROJECT_TOKEN_SECONDS = 6 * 60 * 60;
/** The file the editor opens. */
export const PROJECT_ENTRY = "index.html";
/** The editor's working copy: what Save writes and the preview plays until Export. */
export const PROJECT_DRAFT = "draft.html";

export type ProjectFile = { path: string; data: Uint8Array };
export type ProjectManifest = { dir: string; entry: string; files: { path: string; bytes: number }[] };

const FOOTAGE_RE = /^footage\/clip-(\d{1,2})\.[a-z0-9]{2,5}$/i;

/**
 * A path inside a project, cleaned: relative, forward slashes, no "." or ".."
 * segments, printable, short. Null for anything else — a packed file named
 * "../x" or "/etc/x" is dropped, never written.
 */
export function safeProjectPath(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const parts = raw.replace(/^\.\//, "").split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length === 0 || parts.length > 8) return null;
  for (const p of parts) {
    if (p === ".." || p.length > 120 || !/^[\w.@+-][\w .@+-]*$/.test(p)) return null;
  }
  return parts.join("/");
}

/** footage/clip-3.mp4 → 3; anything else → null. */
export function footageIndex(path: string): number | null {
  const m = FOOTAGE_RE.exec(path);
  return m ? Number(m[1]) : null;
}

function field(block: Uint8Array, from: number, len: number): string {
  let end = from;
  while (end < from + len && block[end] !== 0) end++;
  return Buffer.from(block.subarray(from, end)).toString("utf8");
}

/**
 * A plain (ustar or GNU) tar → its regular files. Directories, links, device
 * entries and pax headers are skipped; GNU long names are honoured; unsafe
 * names are dropped. Throws when the archive is truncated or over the limits.
 */
export function readTar(bytes: Uint8Array): ProjectFile[] {
  if (bytes.byteLength > PROJECT_MAX_BYTES) throw new Error(`project is ${(bytes.byteLength / 1e6).toFixed(0)} MB; the limit is ${PROJECT_MAX_BYTES / 1024 / 1024} MB`);
  const files: ProjectFile[] = [];
  let at = 0;
  let longName: string | null = null;
  while (at + 512 <= bytes.byteLength) {
    const header = bytes.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(field(header, 124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) throw new Error("project archive has a broken header");
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = at + 512;
    if (dataStart + size > bytes.byteLength) throw new Error("project archive is cut short");
    const data = bytes.subarray(dataStart, dataStart + size);
    at = dataStart + Math.ceil(size / 512) * 512;
    if (type === "L") {
      longName = Buffer.from(data).toString("utf8").replace(/\0+$/, "");
      continue;
    }
    const prefix = field(header, 345, 155);
    const name = longName ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    longName = null;
    if (type !== "0" && type !== "\0" && type !== "7") continue;
    const path = safeProjectPath(name);
    if (!path) continue;
    files.push({ path, data: new Uint8Array(data) });
    if (files.length > PROJECT_MAX_FILES) throw new Error(`project has more than ${PROJECT_MAX_FILES} files`);
  }
  return files;
}

/** Where a delivered video's project lives in the footage bucket. */
export function projectDir(userId: string, editId: string, generationId: string): string {
  return `${userId}/${editId}/projects/${generationId}`;
}

// ------------------------------------------------------------ preview token

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function projectToken(editId: string, generationId: string, nowMs: number = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + PROJECT_TOKEN_SECONDS;
  return `${editId}.${generationId}.${exp}.${mediaSig("edit-project", `${editId}/${generationId}/${exp}`)}`;
}

/** The token's edit and video when it is ours and unexpired; null otherwise. */
export function readProjectToken(token: string, nowMs: number = Date.now()): { editId: string; generationId: string } | null {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 4) return null;
  const [editId, generationId, expRaw, sig] = parts;
  if (!UUID.test(editId) || !UUID.test(generationId) || !/^\d{9,11}$/.test(expRaw)) return null;
  const exp = Number(expRaw);
  if (exp * 1000 < nowMs) return null;
  const want = mediaSig("edit-project", `${editId}/${generationId}/${exp}`);
  if (want.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? { editId, generationId } : null;
}

// ------------------------------------------------------------ preview policy

/**
 * The preview document's own policy (it is framed, so it gets its own, not
 * the site's nonce policy): scripts only inline and from jsdelivr — GSAP and
 * the HyperFrames runtime come from there — media from our storage, fal and
 * this route, framed only by picacho.ai. The frame's sandbox (no
 * allow-same-origin) is the real wall; this keeps a project from calling out.
 */
export function previewCsp(supabaseOrigin: string | null): string {
  const store = supabaseOrigin ? ` ${supabaseOrigin}` : "";
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `img-src 'self' data: blob:${store} https://*.fal.media`,
    `media-src 'self' blob:${store} https://*.fal.media`,
    `connect-src 'self'${store} https://cdn.jsdelivr.net`,
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
}
