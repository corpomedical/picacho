// A video's spoken words with the second each phrase starts, and (for an
// upload) a cover frame. The video is fetched or downloaded into a temporary
// folder, its sound is taken out with the ffmpeg-static binary the product
// already ships (the /app/press-tour route traces it: next.config.ts), and
// the sound goes to OpenAI's Whisper for the words. Nothing is kept: the
// folder is removed whatever happens.
//
// Price, read from OpenAI's pricing page on 2026-10-02: Whisper "$0.006 /
// minute" (the only transcription model there that returns timed phrases:
// whisper-1 with response_format verbose_json). A 30-second video costs
// 0.5 × $0.006 = $0.003.
//
// Server-only. Relative imports only; the pure parts are exported for tests.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { frameArgs } from "../product-lock/frames";
import type { Segment } from "./label";
import { UPLOAD_MAX_BYTES, WORDS_MAX_SECONDS } from "./types";

const execFileAsync = promisify(execFile);
export const WHISPER_MODEL = "whisper-1";
export const WHISPER_USD_PER_MINUTE = 0.006;
const FFMPEG_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
/** A network's file is read up to this size (a 3-minute reel is far under). */
const NETWORK_FILE_MAX_BYTES = 150 * 1024 * 1024;

export function whisperCostUsd(seconds: number): number {
  return (Math.max(0, seconds) / 60) * WHISPER_USD_PER_MINUTE;
}

/** "Duration: 00:01:02.50" in ffmpeg's report → 62.5, or null. */
export function durationFromReport(report: string): number | null {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(report);
  if (!m) return null;
  const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(s) ? s : null;
}

/** Whether the report shows a sound track at all. */
export function hasAudio(report: string): boolean {
  return /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio:/.test(report);
}

/** ffmpeg's arguments for the sound alone: mono, 16 kHz, 32 kb/s MP3 (a minute ≈ 240 KB). */
export function audioArgs(input: string, output: string, maxSeconds: number): string[] {
  return ["-y", "-v", "error", "-i", input, "-t", String(maxSeconds), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-f", "mp3", output];
}

/** Whisper's timed phrases, cleaned. */
export function segmentsFrom(body: unknown): Segment[] {
  const segs = body && typeof body === "object" ? (body as Record<string, unknown>).segments : null;
  if (!Array.isArray(segs)) return [];
  const out: Segment[] = [];
  for (const s of segs) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.replace(/\s+/g, " ").trim() : "";
    const start = typeof o.start === "number" && Number.isFinite(o.start) ? o.start : null;
    const end = typeof o.end === "number" && Number.isFinite(o.end) ? o.end : start;
    if (!text || start === null) continue;
    out.push({ start, end: end ?? start, text: text.slice(0, 400) });
    if (out.length >= 300) break;
  }
  return out;
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

/** ffmpeg's report on a file (it "fails" without an output, which is fine: the report is on stderr). */
async function report(binary: string, input: string): Promise<string> {
  try {
    const r = await execFileAsync(binary, ["-hide_banner", "-i", input], { timeout: 20_000, maxBuffer: 1024 * 1024 });
    return String(r.stderr ?? "");
  } catch (err) {
    return String((err as { stderr?: unknown }).stderr ?? "");
  }
}

async function download(url: string, file: string, maxBytes: number, fetchImpl: typeof fetch): Promise<boolean> {
  const call = new AbortController();
  const timer = setTimeout(() => call.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: call.signal, redirect: "follow" });
    if (!res.ok || !res.body) return false;
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > maxBytes) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > maxBytes) return false;
    await writeFile(file, buf);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export type WordsResult =
  | { kind: "read"; segments: Segment[]; durationS: number | null; costUsd: number; cover: Buffer | null }
  | { kind: "none"; durationS: number | null; costUsd: number; cover: Buffer | null }
  | { kind: "too_long"; durationS: number | null; cover: Buffer | null }
  | { kind: "failed"; durationS: number | null; cover: Buffer | null };

/**
 * The words of one video, from a link (Instagram's media_url) or bytes (an
 * upload). `cover` asks for a JPEG frame at one second (uploads only).
 * Never throws.
 */
export async function readWords(
  source: { url: string } | { bytes: Buffer },
  opts: { openaiKey: string | undefined; fetchImpl?: typeof fetch; cover?: boolean },
): Promise<WordsResult> {
  const binary = await ffmpegBinary();
  if (!binary || !opts.openaiKey) return { kind: "failed", durationS: null, cover: null };
  const dir = await mkdtemp(path.join(tmpdir(), "clip-words-"));
  const input = path.join(dir, "video");
  const audio = path.join(dir, "sound.mp3");
  const coverFile = path.join(dir, "cover.jpg");
  let durationS: number | null = null;
  let cover: Buffer | null = null;
  try {
    if ("url" in source) {
      if (!(await download(source.url, input, NETWORK_FILE_MAX_BYTES, opts.fetchImpl ?? fetch))) return { kind: "failed", durationS, cover };
    } else {
      if (source.bytes.length === 0 || source.bytes.length > UPLOAD_MAX_BYTES) return { kind: "failed", durationS, cover };
      await writeFile(input, source.bytes);
    }
    const info = await report(binary, input);
    durationS = durationFromReport(info);
    if (opts.cover) {
      try {
        await execFileAsync(binary, frameArgs(input, coverFile, durationS && durationS < 1.5 ? 0 : 1, 720), { timeout: 20_000, maxBuffer: 1024 * 1024 });
        const jpeg = await readFile(coverFile);
        cover = jpeg.length > 0 ? jpeg : null;
      } catch {
        cover = null;
      }
    }
    if (durationS !== null && durationS > WORDS_MAX_SECONDS) return { kind: "too_long", durationS, cover };
    if (!hasAudio(info)) return { kind: "none", durationS, costUsd: 0, cover };

    await execFileAsync(binary, audioArgs(input, audio, WORDS_MAX_SECONDS), { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
    const size = (await stat(audio)).size;
    if (size === 0) return { kind: "none", durationS, costUsd: 0, cover };

    const form = new FormData();
    form.set("model", WHISPER_MODEL);
    form.set("response_format", "verbose_json");
    form.set("file", new Blob([new Uint8Array(await readFile(audio))], { type: "audio/mpeg" }), "sound.mp3");
    const call = new AbortController();
    const timer = setTimeout(() => call.abort(), 90_000);
    let body: unknown = null;
    try {
      const res = await (opts.fetchImpl ?? fetch)("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { authorization: `Bearer ${opts.openaiKey}` },
        body: form,
        signal: call.signal,
      });
      if (!res.ok) return { kind: "failed", durationS, cover };
      body = await res.json();
    } finally {
      clearTimeout(timer);
    }
    const billed = typeof (body as Record<string, unknown>)?.duration === "number" ? ((body as Record<string, unknown>).duration as number) : (durationS ?? 0);
    const costUsd = whisperCostUsd(Math.min(billed, WORDS_MAX_SECONDS));
    const segments = segmentsFrom(body);
    if (segments.length === 0) return { kind: "none", durationS, costUsd, cover };
    return { kind: "read", segments, durationS, costUsd, cover };
  } catch {
    return { kind: "failed", durationS, cover };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
