"use client";

// What the timeline draws inside its clips: a frame from each shot, and the
// waveform of each sound. Both are read in the browser from the project's own
// files through the preview route (which redirects to storage; storage sends
// CORS, so frames can be drawn onto a canvas and sound decoded).

import { useEffect, useRef, useState } from "react";
import type { TimelineModel } from "@/lib/editor/timeline";

/** Peaks per second of source kept for drawing. */
export const PEAKS_PER_SECOND = 40;
const MAX_AUDIO_BYTES = 80 * 1024 * 1024;

export type Previews = {
  /** `${src}@${second}` → a small JPEG data URL. */
  frames: Record<string, string>;
  /** src → peaks (0..1) at PEAKS_PER_SECOND over the whole source file. */
  peaks: Record<string, number[]>;
};

export function frameKey(src: string, at: number): string {
  return `${src}@${Math.round(at * 2) / 2}`;
}

async function grabFrames(url: string, times: number[]): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "auto";
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("video"));
  });
  const canvas = document.createElement("canvas");
  const w = 192;
  canvas.width = w;
  canvas.height = Math.max(1, Math.round((w * video.videoHeight) / Math.max(1, video.videoWidth)));
  const ctx = canvas.getContext("2d");
  for (const t of times) {
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.currentTime = Math.min(Math.max(0, t), Math.max(0, video.duration - 0.05));
    });
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      out[t] = canvas.toDataURL("image/jpeg", 0.6);
    } catch {
      break;
    }
  }
  video.removeAttribute("src");
  video.load();
  return out;
}

async function readPeaks(url: string): Promise<number[] | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > MAX_AUDIO_BYTES) return null;
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_AUDIO_BYTES) return null;
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const audio = await ctx.decodeAudioData(bytes);
  const data = audio.getChannelData(0);
  const step = Math.max(1, Math.floor(audio.sampleRate / PEAKS_PER_SECOND));
  const peaks: number[] = [];
  let max = 0;
  for (let i = 0; i < data.length; i += step) {
    let p = 0;
    for (let j = i; j < Math.min(i + step, data.length); j++) p = Math.max(p, Math.abs(data[j]));
    peaks.push(p);
    max = Math.max(max, p);
  }
  return max > 0 ? peaks.map((p) => Math.round((p / max) * 1000) / 1000) : peaks;
}

export function useMediaPreviews(base: string | null, model: TimelineModel | null): Previews {
  const [previews, setPreviews] = useState<Previews>({ frames: {}, peaks: {} });
  const asked = useRef(new Set<string>());
  const mounted = useRef(true);
  const queue = useRef<Promise<void>>(Promise.resolve());

  // Every edit makes a new model; queued work carries on (each file is asked
  // for once), and only leaving the editor stops it.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!base || !model) return;
    const jobs: (() => Promise<void>)[] = [];
    // Frames: two per shot (a long one reads as a strip), from where it plays in its source.
    const bySrc = new Map<string, number[]>();
    for (const c of model.lanes.find((l) => l.key === "story")?.clips ?? []) {
      if (!c.src) continue;
      const len = c.end - c.start;
      for (const at of len > 4 ? [c.mediaStart + len * 0.25, c.mediaStart + len * 0.75] : [c.mediaStart + len / 2]) {
        const key = frameKey(c.src, at);
        if (asked.current.has(key)) continue;
        asked.current.add(key);
        bySrc.set(c.src, [...(bySrc.get(c.src) ?? []), Math.round(at * 2) / 2]);
      }
    }
    for (const [src, times] of bySrc) {
      jobs.push(async () => {
        const got = await grabFrames(`${base}${src}`, times).catch(() => ({}) as Record<number, string>);
        if (!mounted.current) return;
        setPreviews((p) => ({ ...p, frames: { ...p.frames, ...Object.fromEntries(Object.entries(got).map(([t, url]) => [frameKey(src, Number(t)), url])) } }));
      });
    }
    // Waveforms: one decode per sound file.
    for (const lane of model.lanes.filter((l) => l.audio)) {
      for (const c of lane.clips) {
        if (!c.src || asked.current.has(`peaks:${c.src}`)) continue;
        asked.current.add(`peaks:${c.src}`);
        const src = c.src;
        jobs.push(async () => {
          const peaks = await readPeaks(`${base}${src}`).catch(() => null);
          if (!mounted.current || !peaks) return;
          setPreviews((p) => ({ ...p, peaks: { ...p.peaks, [src]: peaks } }));
        });
      }
    }
    // One at a time: decoding and seeking are heavy on a laptop, and the timeline is usable before they land.
    for (const job of jobs) {
      queue.current = queue.current.then(() => (mounted.current ? job() : undefined)).catch(() => undefined);
    }
  }, [base, model]);

  return previews;
}
