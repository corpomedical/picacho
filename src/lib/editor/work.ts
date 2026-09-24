// The steps of reading footage that run ffmpeg on our side: probe a clip and
// pull its speech track. Both read straight from a signed https URL
// (ffmpeg-static carries https), so a large rush never lands on a function's
// disk whole. Deciding what anything means lives elsewhere (analyze.ts,
// transcribe.ts); making the video is the editing agent's job (agent.ts).

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { parseProbe, probeArgs, speechArgs, type ProbeResult } from "./analyze";

const execFileAsync = promisify(execFile);
const SPEECH_TIMEOUT_MS = 180_000;

/**
 * The encoder, found at run time — the same reasoning and the same place as
 * lib/generations/chain-run.ts's encoderPath (next.config.ts traces the
 * binary into the routes that need it). EDITOR_FFMPEG overrides it for a
 * local run.
 */
function ffmpegBinary(): string {
  const override = process.env.EDITOR_FFMPEG;
  if (override && existsSync(override)) return override;
  const pkg = ["ffmpeg", "static"].join("-");
  const file = path.join(process.cwd(), "node_modules", pkg, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  if (!existsSync(file)) throw new Error("editor: no ffmpeg in this function");
  return file;
}

async function ffmpeg(args: string[], timeout: number, allowFailure = false): Promise<string> {
  try {
    const { stderr } = await execFileAsync(ffmpegBinary(), args, { timeout, maxBuffer: 16 * 1024 * 1024 });
    return String(stderr);
  } catch (err) {
    const stderr = String((err as { stderr?: unknown }).stderr ?? "");
    if (allowFailure && stderr) return stderr;
    const tail = stderr.split("\n").filter(Boolean).slice(-3).join(" | ");
    throw new Error(`editor: ffmpeg failed: ${tail || (err instanceof Error ? err.message : String(err))}`);
  }
}

export async function probeClip(file: string): Promise<ProbeResult> {
  // `ffmpeg -i` with no output exits 1 by design; the banner is still there.
  return parseProbe(await ffmpeg(probeArgs(file), 30_000, true));
}

/** The clip's speech track, or null when it has no sound. */
export async function extractSpeech(file: string, probe: ProbeResult): Promise<Uint8Array | null> {
  if (!probe.hasAudio) return null;
  const dir = await mkdtemp(path.join(tmpdir(), "editor-"));
  try {
    const out = path.join(dir, "speech.mp3");
    await ffmpeg(speechArgs(file, out), SPEECH_TIMEOUT_MS);
    return existsSync(out) ? new Uint8Array(await readFile(out)) : null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
