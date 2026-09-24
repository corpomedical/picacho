// The editor's hands: the steps that run ffmpeg on real files.
//
// Everything that decides something lives in the pure modules (analyze.ts
// builds the arguments, compile.ts writes the page, plan.ts checks the edit);
// this file only runs them against a scratch directory and reads the results
// back. Each exported step fits inside one function invocation — the job
// runner (cut 2) calls them one stage at a time.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  analyzeArgs,
  musicArgs,
  parseProbe,
  parseSceneChanges,
  parseSilences,
  probeArgs,
  segmentArgs,
  fillArgs,
  type ProbeResult,
  type Silence,
} from "./analyze";
import { compileComposition, type ShotMedia } from "./compile";
import { canvasFor, planDuration, type EditPlan } from "./plan";
import type { Transcripts } from "./timeline";
import { buildZip, type ZipEntry } from "./zip";
import { CompositionLintError, describeFindings, lintComposition } from "./lint";

const execFileAsync = promisify(execFile);
const ANALYZE_TIMEOUT_MS = 240_000;
const SEGMENT_TIMEOUT_MS = 120_000;
/** Handle either side of each shot's trimmed file, seconds. */
const SEGMENT_PAD = 0.5;

/**
 * The encoder, found at run time — the same reasoning and the same place as
 * lib/generations/chain-run.ts's encoderPath (next.config.ts traces the
 * binary into the routes that need it). EDITOR_FFMPEG overrides it for a
 * local proof run.
 */
function ffmpegBinary(): string {
  const override = process.env.EDITOR_FFMPEG;
  if (override && existsSync(override)) return override;
  const pkg = ["ffmpeg", "static"].join("-");
  const file = path.join(process.cwd(), "node_modules", pkg, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  if (!existsSync(file)) throw new Error("editor: no ffmpeg in this function");
  return file;
}

/** Run ffmpeg and return its stderr — where probe, showinfo and silencedetect report. */
async function ffmpeg(args: string[], timeout: number, allowFailure = false): Promise<string> {
  try {
    const { stderr } = await execFileAsync(ffmpegBinary(), args, { timeout, maxBuffer: 64 * 1024 * 1024 });
    return String(stderr);
  } catch (err) {
    const stderr = String((err as { stderr?: unknown }).stderr ?? "");
    if (allowFailure && stderr) return stderr;
    const tail = stderr.split("\n").filter(Boolean).slice(-3).join(" | ");
    throw new Error(`editor: ffmpeg failed: ${tail || (err instanceof Error ? err.message : String(err))}`);
  }
}

export async function withScratch<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "editor-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function probeClip(file: string): Promise<ProbeResult> {
  // `ffmpeg -i` with no output exits 1 by design; the banner is still there.
  return parseProbe(await ffmpeg(probeArgs(file), 30_000, true));
}

export type AnalyzedClip = ProbeResult & {
  interval: number;
  sheets: Uint8Array[];
  sceneChanges: number[];
  silences: Silence[];
  /** Mono 16 kHz speech track for the transcriber; null when the clip is silent. */
  speech: Uint8Array | null;
};

export async function analyzeClip(file: string, probe: ProbeResult, interval: number): Promise<AnalyzedClip> {
  return withScratch(async (dir) => {
    const sheetPattern = path.join(dir, "sheet-%03d.jpg");
    const audioOut = path.join(dir, "speech.mp3");
    const stderr = await ffmpeg(
      analyzeArgs(file, { interval, hasVideo: probe.hasVideo, hasAudio: probe.hasAudio, sheetPattern, audioOut }),
      ANALYZE_TIMEOUT_MS,
    );
    const names = (await readdir(dir)).filter((n) => n.startsWith("sheet-")).sort();
    const sheets = await Promise.all(names.map(async (n) => new Uint8Array(await readFile(path.join(dir, n)))));
    const speech = probe.hasAudio && existsSync(audioOut) ? new Uint8Array(await readFile(audioOut)) : null;
    return {
      ...probe,
      interval,
      sheets,
      sceneChanges: probe.hasVideo ? parseSceneChanges(stderr) : [],
      silences: probe.hasAudio ? parseSilences(stderr, probe.duration) : [],
      speech,
    };
  });
}

export type Bundle = { zip: Uint8Array; html: string; files: string[] };

/**
 * The render bundle: one trimmed file per shot, the music bed if any, and the
 * compiled page, zipped. `clipFiles[i]` is clip i on local disk.
 */
export async function buildBundle(
  plan: EditPlan,
  transcripts: Transcripts,
  clipFiles: string[],
  clipAudio: boolean[],
): Promise<Bundle> {
  return withScratch(async (dir) => {
    const { width, height } = canvasFor(plan.aspect);
    const maxEdge = Math.max(width, height);
    const entries: ZipEntry[] = [];
    const shotMedia: ShotMedia[] = [];

    // Consecutive shots are independent encodes; two at a time keeps a
    // function's CPUs busy without starving the second.
    const jobs = plan.shots.map((shot, i) => async () => {
      const name = `media/shot-${String(i).padStart(3, "0")}.mp4`;
      const out = path.join(dir, `shot-${i}.mp4`);
      const hasAudio = clipAudio[shot.clip] === true;
      const seg = segmentArgs(clipFiles[shot.clip], out, { from: shot.from, to: shot.to, pad: SEGMENT_PAD, maxEdge, hasAudio });
      await ffmpeg(seg.args, SEGMENT_TIMEOUT_MS);
      shotMedia[i] = { src: name, mediaStart: seg.mediaStart, hasAudio };
      entries.push({ name, data: new Uint8Array(await readFile(out)) });
      if (shot.fit === "contain") {
        const fillName = `media/fill-${String(i).padStart(3, "0")}.mp4`;
        const fillOut = path.join(dir, `fill-${i}.mp4`);
        await ffmpeg(fillArgs(clipFiles[shot.clip], fillOut, { from: shot.from, to: shot.to, pad: SEGMENT_PAD }), SEGMENT_TIMEOUT_MS);
        shotMedia[i].fillSrc = fillName;
        entries.push({ name: fillName, data: new Uint8Array(await readFile(fillOut)) });
      }
    });
    await runLimited(jobs, 2);

    let music = null;
    if (plan.music) {
      const out = path.join(dir, "music.m4a");
      await ffmpeg(musicArgs(clipFiles[plan.music.clip], out, { from: plan.music.from, length: planDuration(plan) }), SEGMENT_TIMEOUT_MS);
      entries.push({ name: "media/music.m4a", data: new Uint8Array(await readFile(out)) });
      music = { src: "media/music.m4a", mediaStart: 0 };
    }

    const html = compileComposition({ plan, transcripts, shotMedia, music });
    const verdict = await lintComposition(html);
    if (verdict.errors.length > 0) {
      throw new CompositionLintError(`the composition failed HyperFrames' checks: ${describeFindings(verdict.errors)}`);
    }
    if (verdict.warnings.length > 0) console.warn(`[editor] composition warnings: ${describeFindings(verdict.warnings)}`);
    // Sorted by name so the zip — and its checksum, HeyGen's idempotency key — is the same however the encodes finished.
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const all: ZipEntry[] = [{ name: "index.html", data: new TextEncoder().encode(html) }, ...entries];
    return { zip: buildZip(all), html, files: all.map((e) => e.name) };
  });
}

async function runLimited(jobs: (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      await job();
    }
  });
  await Promise.all(lanes);
}
