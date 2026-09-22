// A recast's clip, in the browser (cut 2, 2026-09-18). Browser only;
// relative imports — the Recce's recce-client.ts pattern, for a clip that
// DOES travel.
//
// The difference from a Recce: the engine needs the footage, so the file
// itself uploads. What this does is sample frames for THE READ — which
// happens while the upload is still going, so the door has understood the
// clip by the time the person looks up. Frames are sampled here rather than
// on the server because the file is already in the browser's hands, a canvas
// costs nothing, and the alternative is paying a provider to pull frames
// back out of storage.
//
// It samples a FILE the person picked or a URL of one of their own finished
// takes (the motion library) — both same-origin, so the canvas is never
// tainted. A signed storage URL would taint it, which is why the library's
// takes are read through our own media route.
//
// A refusal here is one of the server's own English sentences, so the page
// localizes it exactly as it localizes the server's.

import { RECAST_NOT_A_VIDEO, RECAST_UPLOAD_UNREADABLE } from "./messages";
import { RECAST_FRAME_COUNT, recastSampleTimes } from "./recast-read";

/** Long side of a sampled frame — enough for the reader to see a wristwatch. */
export const RECAST_FRAME_LONG_PX = 1024;
const FRAME_QUALITIES = [0.75, 0.66, 0.55, 0.45];
export const RECAST_FRAME_MAX_BYTES = 260 * 1024;
/** All frames together, decoded — the read's request must stay inside Vercel's body budget. */
export const RECAST_FRAMES_TOTAL_BYTES = 3_000_000;

const JPEG_HEAD = "data:image/jpeg;base64,";

function decodedBytes(dataUri: string): number {
  const b64 = dataUri.slice(dataUri.indexOf(",") + 1);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

function once<K extends keyof HTMLVideoElementEventMap>(video: HTMLVideoElement, event: K, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish(false), timeoutMs);
    const onEvent = () => finish(true);
    const onError = () => finish(false);
    function finish(ok: boolean) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      video.removeEventListener("error", onError);
      resolve(ok);
    }
    video.addEventListener(event, onEvent, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

// ---------------------------------------------------------------------------
// THE LENGTH, BEFORE ANY UPLOAD (2026-09-22)
//
// A 181 s clip used to upload in full — tens of megabytes on a phone — only
// for the server to say it is over 30 seconds. The browser knows a file's
// length from its first few kilobytes, so the door asks it first.
//
// It only ever SPEEDS UP a refusal; it never makes one on its own say-so.
// A browser that cannot decode the file (an HEVC .mov in Chrome on Windows,
// most often) may fire an error, never answer, or answer with no picture —
// and that file may still be perfectly usable, since the server reads it
// with ffprobe, not a decoder. So anything short of a clean answer is
// { ok: false }, and the door carries on to the upload and the server's own
// probe exactly as before (the completeness critic's point).

export type LocalProbe = { ok: true; seconds: number; width: number; height: number } | { ok: false };

/** How long the door waits for the browser to say a file's length before leaving it to the server. */
export const RECAST_PROBE_TIMEOUT_MS = 5_000;

export async function probeLocal(file: File, timeoutMs = RECAST_PROBE_TIMEOUT_MS): Promise<LocalProbe> {
  let objectUrl: string | null = null;
  let video: HTMLVideoElement | null = null;
  try {
    objectUrl = URL.createObjectURL(file);
    video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const loaded = once(video, "loadedmetadata", timeoutMs);
    video.src = objectUrl;
    if (!(await loaded)) return { ok: false };
    const seconds = Math.round(video.duration * 10) / 10;
    if (!Number.isFinite(seconds) || seconds <= 0 || !(video.videoWidth > 0) || !(video.videoHeight > 0)) return { ok: false };
    return { ok: true, seconds, width: video.videoWidth, height: video.videoHeight };
  } catch {
    return { ok: false };
  } finally {
    if (video) {
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        // Nothing left to release.
      }
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

// ---------------------------------------------------------------------------
// THE UPLOAD, WITH ITS PROGRESS (2026-09-22)
//
// supabase-js uploads with fetch, and fetch cannot report how much of a
// request has gone — so a 40 MB clip was "Uploading…" and a pulse for as
// long as the connection took, with no way to stop it but to choose another
// file. This sends the SAME request the library sends from a browser
// (storage-js 2.112 uploadOrUpdate, read at source today): a POST to
// {project}/storage/v1/object/{bucket}/{path}, the anon key as `apikey`, the
// signed-in session's token as the bearer, `x-upsert: false`, and a
// multipart body of `cacheControl` = 3600 and the file under an empty name —
// through XMLHttpRequest, whose upload reports its progress and can be
// aborted. The same storage policy judges it: nothing is granted that the
// library's upload did not already have.
//
// Anything but a 2xx is { ok: false } and the door falls back to the
// library's own upload (no progress), so the worst this can do is what the
// door did yesterday.

export type RecastUploadResult = { ok: true } | { ok: false; aborted: boolean };

/** Where the library's upload() sends an object (supabase-js: new URL("storage/v1", base); storage-js: object/{bucket}/{path}). */
export function recastStorageObjectUrl(projectUrl: string, bucket: string, path: string): string {
  return `${projectUrl.replace(/\/+$/, "")}/storage/v1/object/${bucket}/${path.replace(/^\/+/, "")}`;
}

export function uploadRecastClip(input: {
  url: string;
  anonKey: string;
  token: string;
  file: File;
  signal: AbortSignal;
  /** How much has gone, 0 to 1. */
  onProgress: (share: number) => void;
}): Promise<RecastUploadResult> {
  return new Promise((resolve) => {
    if (input.signal.aborted) return resolve({ ok: false, aborted: true });
    let xhr: XMLHttpRequest;
    try {
      xhr = new XMLHttpRequest();
    } catch {
      return resolve({ ok: false, aborted: false });
    }
    let settled = false;
    const onAbort = () => xhr.abort();
    const done = (result: RecastUploadResult) => {
      if (settled) return;
      settled = true;
      input.signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    input.signal.addEventListener("abort", onAbort, { once: true });
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) input.onProgress(Math.min(1, Math.max(0, e.loaded / e.total)));
    };
    xhr.onload = () => done(xhr.status >= 200 && xhr.status < 300 ? { ok: true } : { ok: false, aborted: false });
    xhr.onerror = () => done({ ok: false, aborted: false });
    xhr.ontimeout = () => done({ ok: false, aborted: false });
    xhr.onabort = () => done({ ok: false, aborted: true });
    try {
      const body = new FormData();
      body.append("cacheControl", "3600");
      body.append("", input.file);
      xhr.open("POST", input.url);
      xhr.setRequestHeader("apikey", input.anonKey);
      xhr.setRequestHeader("authorization", `Bearer ${input.token}`);
      xhr.setRequestHeader("x-upsert", "false");
      xhr.send(body);
    } catch {
      done({ ok: false, aborted: false });
    }
  });
}

export type SampledClip = { frames: string[]; seconds: number; width: number; height: number };

/**
 * Decode and sample. Nothing here decides anything that costs money: the
 * server reads the real file for the length, the size and the price. What
 * comes back is pictures, for the read alone.
 */
export async function sampleClip(source: File | string): Promise<{ ok: true; clip: SampledClip } | { ok: false; error: string }> {
  if (typeof source !== "string" && !source.type.startsWith("video/")) return { ok: false, error: RECAST_NOT_A_VIDEO };

  const objectUrl = typeof source === "string" ? null : URL.createObjectURL(source);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  // Same-origin either way; set explicitly so a media route that answers with
  // CORS headers still gives readable pixels rather than a tainted canvas.
  video.crossOrigin = "anonymous";
  video.src = objectUrl ?? (source as string);
  try {
    if (!(await once(video, "loadedmetadata", 25_000))) return { ok: false, error: RECAST_UPLOAD_UNREADABLE };
    const seconds = Math.round(video.duration * 10) / 10;
    if (!Number.isFinite(seconds) || seconds <= 0 || video.videoWidth <= 0 || video.videoHeight <= 0) {
      return { ok: false, error: RECAST_UPLOAD_UNREADABLE };
    }

    const scale = Math.min(1, RECAST_FRAME_LONG_PX / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, error: RECAST_UPLOAD_UNREADABLE };
    ctx.imageSmoothingQuality = "high";

    const frames: string[] = [];
    let total = 0;
    for (const t of recastSampleTimes(seconds, RECAST_FRAME_COUNT)) {
      video.currentTime = t;
      if (!(await once(video, "seeked", 12_000))) break;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      let frame: string | null = null;
      for (const q of FRAME_QUALITIES) {
        let dataUri: string;
        try {
          dataUri = canvas.toDataURL("image/jpeg", q);
        } catch {
          // A tainted canvas — nothing can be read; the take still can be taken.
          return { ok: false, error: RECAST_UPLOAD_UNREADABLE };
        }
        if (!dataUri.startsWith(JPEG_HEAD)) return { ok: false, error: RECAST_UPLOAD_UNREADABLE };
        if (decodedBytes(dataUri) <= RECAST_FRAME_MAX_BYTES) {
          frame = dataUri;
          break;
        }
      }
      // One frame that will not shrink stops the sampling; what was gathered
      // is still a read. The reader is given whatever arrived.
      if (frame === null) break;
      if (total + decodedBytes(frame) > RECAST_FRAMES_TOTAL_BYTES) break;
      total += decodedBytes(frame);
      frames.push(frame);
    }
    return { ok: true, clip: { frames, seconds, width: video.videoWidth, height: video.videoHeight } };
  } finally {
    video.removeAttribute("src");
    video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
