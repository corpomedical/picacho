// A Recce's clip, in the browser (board K cut 1, 2026-09-17). Browser only;
// relative imports — the photo-client.ts pattern, for footage.
//
// THE CLIP NEVER LEAVES THE DEVICE. A <video> plays it from a blob URL and
// a canvas samples RECCE_FRAME_COUNT frames evenly across it; only those
// JPEG frames travel, inside the same request budget the photo build rides
// (Vercel refuses bodies over 4.5 MB before our code runs). A canvas writes
// no metadata, so nothing a phone stamps into its footage leaves either;
// the server re-encodes every frame regardless (recce-actions.ts).
//
// Frames keep at least the photo build's minimum side: one of them becomes
// the set's photograph, and photoFit must pass on it server-side.
//
// A refusal here is one of the server's own English sentences (messages.ts),
// so the page localizes it exactly as it localizes the server's.

import { SET_CLIP_LENGTH, SET_CLIP_TOO_LARGE, SET_CLIP_UNREADABLE } from "./messages";
import { RECCE_FRAME_COUNT, SET_CLIP_MAX_SECONDS, SET_CLIP_MIN_SECONDS, sampleTimes } from "./recce-read";

/** The file itself only ever feeds the local decoder, so the bound is generous. */
export const SET_CLIP_MAX_FILE_BYTES = 512 * 1024 * 1024;
/** Long side of a sampled frame: enough for the reader and the photo build's minimum side. */
export const RECCE_FRAME_LONG_PX = 1280;
const FRAME_QUALITIES = [0.8, 0.72, 0.62, 0.5];
/** One frame past this cannot be sent; the ladder above nearly always lands well under. */
export const RECCE_FRAME_MAX_BYTES = 300 * 1024;
/** All frames together, decoded — the request must stay inside Vercel's body budget. */
export const RECCE_FRAMES_TOTAL_BYTES = 3_300_000;

const JPEG_HEAD = "data:image/jpeg;base64,";

function decodedBytes(dataUri: string): number {
  const b64 = dataUri.slice(dataUri.indexOf(",") + 1);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

function once<K extends keyof HTMLVideoElementEventMap>(
  video: HTMLVideoElement,
  event: K,
  timeoutMs: number,
): Promise<boolean> {
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

export type PreparedClip = { frames: string[]; seconds: number; times: number[] };

/**
 * Decode, bound, sample. The times are recomputed on the server from the
 * seconds sent — what is trusted from here is only pictures and a length.
 */
export async function prepareClip(file: File): Promise<{ ok: true; clip: PreparedClip } | { ok: false; error: string }> {
  if (!file.type.startsWith("video/")) return { ok: false, error: SET_CLIP_UNREADABLE };
  if (file.size > SET_CLIP_MAX_FILE_BYTES) return { ok: false, error: SET_CLIP_TOO_LARGE };

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    if (!(await once(video, "loadedmetadata", 20_000))) return { ok: false, error: SET_CLIP_UNREADABLE };
    const seconds = Math.round(video.duration * 10) / 10;
    if (!Number.isFinite(seconds) || video.videoWidth <= 0 || video.videoHeight <= 0) {
      return { ok: false, error: SET_CLIP_UNREADABLE };
    }
    if (seconds < SET_CLIP_MIN_SECONDS || seconds > SET_CLIP_MAX_SECONDS) return { ok: false, error: SET_CLIP_LENGTH };

    const scale = Math.min(1, RECCE_FRAME_LONG_PX / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, error: SET_CLIP_UNREADABLE };
    ctx.imageSmoothingQuality = "high";

    const times = sampleTimes(seconds, RECCE_FRAME_COUNT);
    const frames: string[] = [];
    let total = 0;
    for (const t of times) {
      video.currentTime = t;
      if (!(await once(video, "seeked", 10_000))) return { ok: false, error: SET_CLIP_UNREADABLE };
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      let frame: string | null = null;
      for (const q of FRAME_QUALITIES) {
        const dataUri = canvas.toDataURL("image/jpeg", q);
        if (!dataUri.startsWith(JPEG_HEAD)) return { ok: false, error: SET_CLIP_UNREADABLE };
        if (decodedBytes(dataUri) <= RECCE_FRAME_MAX_BYTES) {
          frame = dataUri;
          break;
        }
      }
      if (frame === null) return { ok: false, error: SET_CLIP_TOO_LARGE };
      total += decodedBytes(frame);
      if (total > RECCE_FRAMES_TOTAL_BYTES) return { ok: false, error: SET_CLIP_TOO_LARGE };
      frames.push(frame);
    }
    return { ok: true, clip: { frames, seconds, times } };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
