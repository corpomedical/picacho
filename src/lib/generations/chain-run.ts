import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";
import { probeMp4 } from "@/lib/media/mp4-probe";
import { mediaUrl } from "@/lib/media/url";
import { ChainRetry, ENCODE_TIMEOUT_MS, encoderFailure } from "@/lib/generations/chain-failure";
import {
  AGREE_H,
  AGREE_W,
  CHAIN_PIECE_MAX_FRAMES,
  CHAIN_PREFIX_FRAMES,
  CHAIN_TAIL_FRAMES,
  chainAgreementArgs,
  chainSwitchAt,
  type ChainPiece,
  chainFirstPieceArgs,
  chainFrameDistance,
  chainJoinArgs,
  chainJoinOffset,
  chainJoinSpans,
  chainMotion,
  chainNextPieceArgs,
  chainStillArgs,
  chainWindowArgs,
  chainWindowSize,
  planChain,
  type ChainPlan,
  type ChainState,
} from "@/lib/generations/chain";

// THE LONG TAKE, run (chain.ts says what and why; this does it). Server only,
// and lane-neutral: the lane that starts a take composes every piece's
// request; this module only makes the pieces' clips and joins what comes back.
//
// Three moments, and where each runs:
//
//   START (the lane's take action) — the window is prepared at 24 fps, its
//   stillness measured, the switches placed, the first piece's input cut.
//   Everything that decides the price and the plan happens before a credit
//   is spent.
//
//   BETWEEN PIECES (job-runner.ts, on the finished piece's advance — fal's
//   webhook, a page's poll, the reaper) — the finished render is kept, and
//   the next piece's input is its last second followed by the window's
//   footage up to the next switch.
//
//   THE END (the same advance, on the last piece) — each join cut on the
//   frame where the two renders agree best, the pieces laid end to end, the
//   window's own sound under all of it, stored where every finished video
//   lives; then the runner's ordinary finish (the face lock, the picture
//   gate, the poster) sees one video like any other.
//
// The encoder is traced into the routes that can advance a take
// (next.config.ts). A route without it says so (chainEncoderAvailable) and
// the runner leaves the piece for one that has it, instead of guessing.

const execFileAsync = promisify(execFile);

/** How long a render may take to come down from the provider. */
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MOTION_W = 160;
const MOTION_H = 90;

/** The progress line while the parts are laid end to end — mapped for translation in lib/i18n/server-text.ts. */
export const CHAIN_JOINING = "Joining the parts";

type Admin = SupabaseClient;

export { ChainRetry };

/**
 * The encoder, FOUND at run time rather than imported. The runner reaches
 * this module from every page that shows a render, and importing
 * ffmpeg-static made the build trace its 45 MB binary into all 36 of those
 * functions (measured in the .nft.json files, 2026-09-19). It is traced into
 * the few routes that run a long take's steps by next.config.ts instead, and
 * sits there where it sits in the repo: node_modules/ffmpeg-static/ffmpeg
 * under the function's root. The name is assembled so the bundler's static
 * reading cannot follow it back to the file.
 */
function encoderPath(): string | null {
  const pkg = ["ffmpeg", "static"].join("-");
  const file = path.join(process.cwd(), "node_modules", pkg, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  return existsSync(file) ? file : null;
}

const ffmpegPath = encoderPath();

/** Whether this function carries the encoder — only the routes next.config.ts traces it into do. */
export function chainEncoderAvailable(): boolean {
  return ffmpegPath !== null;
}

async function run(args: string[], what: string): Promise<void> {
  if (!ffmpegPath) throw new ChainRetry(`${what}: no encoder in this function`);
  try {
    await execFileAsync(ffmpegPath, args, { timeout: ENCODE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
  } catch (err) {
    throw encoderFailure(what, err);
  }
}

async function runForBytes(args: string[], what: string): Promise<Buffer> {
  if (!ffmpegPath) throw new ChainRetry(`${what}: no encoder in this function`);
  try {
    const { stdout } = await execFileAsync(ffmpegPath, args, {
      timeout: ENCODE_TIMEOUT_MS,
      maxBuffer: 256 * 1024 * 1024,
      encoding: "buffer",
    });
    return stdout as Buffer;
  } catch (err) {
    throw encoderFailure(what, err);
  }
}

async function withScratch<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "chain-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function download(admin: Admin, bucket: string, storagePath: string, to: string): Promise<void> {
  const { data, error } = await admin.storage.from(bucket).download(storagePath);
  if (error || !data) throw new ChainRetry(`couldn't read ${storagePath}: ${error?.message ?? "no data"}`);
  await writeFile(to, Buffer.from(await data.arrayBuffer()));
}

async function fetchTo(url: string, to: string): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetchWithTimeout(url, {}, DOWNLOAD_TIMEOUT_MS);
  } catch (err) {
    throw new ChainRetry(`couldn't fetch the finished piece: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new ChainRetry(`couldn't fetch the finished piece (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(to, bytes);
  return bytes;
}

async function store(admin: Admin, bucket: string, storagePath: string, bytes: Buffer, contentType = "video/mp4"): Promise<void> {
  // upsert: a retried pass writes the same file to the same place.
  const { error } = await admin.storage.from(bucket).upload(storagePath, bytes, { contentType, upsert: true });
  if (error) throw new ChainRetry(`couldn't store ${storagePath}: ${error.message}`);
}

async function sign(admin: Admin, bucket: string, storagePath: string): Promise<string> {
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(storagePath, 60 * 60 * 24);
  if (error || !data?.signedUrl) throw new ChainRetry(`couldn't sign ${storagePath}: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

// --- START --------------------------------------------------------------

export type PreparedChain = {
  /** The prepared window, stored where the lane asked — the take's recorded source. */
  windowPath: string;
  window: { seconds: number; frames: number; width: number; height: number; bytes: number };
  plan: ChainPlan;
  /** The first piece's input, to be stored under each take's own folder. */
  firstPiece: Buffer;
};

/**
 * The window at 24 fps, its stillness, the switches, and the first piece.
 * Runs in the lane's take action, before anything is spent; every failure is
 * a reason not to start.
 */
export async function prepareChain(
  admin: Admin,
  input: {
    bucket: string;
    /** Where the prepared window is stored. */
    windowPath: string;
    source: Buffer;
    window: { start: number; end: number };
    sourceSize: { width: number; height: number };
  },
): Promise<PreparedChain | { error: "no-encoder" | "cut-failed" | "no-plan" | "store-failed" }> {
  if (!chainEncoderAvailable()) return { error: "no-encoder" };
  try {
    return await withScratch(async (dir) => {
      const source = path.join(dir, "source");
      const prepared = path.join(dir, "window.mp4");
      const first = path.join(dir, "first.mp4");
      await writeFile(source, input.source);
      await run(chainWindowArgs(source, prepared, input.window, chainWindowSize(input.sourceSize)), "preparing the window");
      const windowBytes = await readFile(prepared);
      const probe = probeMp4(windowBytes);
      if (!probe?.frames) return { error: "cut-failed" as const };

      const gray = await runForBytes(
        ["-v", "error", "-i", prepared, "-vf", `scale=${MOTION_W}:${MOTION_H},format=gray`, "-f", "rawvideo", "-"],
        "measuring the stillness",
      );
      const motion = chainMotion(new Uint8Array(gray), MOTION_W, MOTION_H);
      const frames = Math.min(probe.frames, motion.length);
      const plan = planChain(frames, motion);
      if (!plan) return { error: "no-plan" as const };

      await run(chainFirstPieceArgs(prepared, first, plan.lengths[0]), "cutting the first piece");
      const firstPiece = await readFile(first);

      const { error } = await admin.storage
        .from(input.bucket)
        .upload(input.windowPath, windowBytes, { contentType: "video/mp4", upsert: false });
      if (error) return { error: "store-failed" as const };
      return {
        windowPath: input.windowPath,
        window: { seconds: probe.seconds, frames, width: probe.width, height: probe.height, bytes: windowBytes.length },
        plan,
        firstPiece,
      };
    });
  } catch (err) {
    console.error("[chain] prepare failed:", err instanceof Error ? err.message : err);
    return { error: "cut-failed" };
  }
}

/** Stores the first piece's input under a take's own folder; its signed url is what the engine fetches. */
export async function storeFirstPiece(admin: Admin, bucket: string, folder: string, bytes: Buffer): Promise<string> {
  const at = `${folder}/in-1.mp4`;
  await store(admin, bucket, at, bytes);
  return sign(admin, bucket, at);
}

// --- BETWEEN PIECES -----------------------------------------------------

/**
 * A piece has finished and another follows: its render is kept (the join
 * needs it), and the next piece's input is made from its last second and the
 * window's footage up to the next switch. Everything here is a retryable
 * read-and-write; the paid submit is the runner's, after this returns.
 */
export async function prepareNextPiece(
  admin: Admin,
  chain: ChainState,
  finishedRenderUrl: string,
): Promise<{ inputUrl: string; renderPath: string; renderFrames: number; switchAt: number; lookUrl: string | null }> {
  const k = chain.index;
  return withScratch(async (dir) => {
    const render = path.join(dir, "render.mp4");
    const windowFile = path.join(dir, "window.mp4");
    const next = path.join(dir, "next.mp4");
    const renderBytes = await fetchTo(finishedRenderUrl, render);
    const probe = probeMp4(renderBytes);
    if (!probe?.frames) throw new ChainRetry("the finished piece isn't a readable video");
    const renderPath = `${chain.folder}/out-${k + 1}.mp4`;
    await store(admin, chain.bucket, renderPath, renderBytes);

    // Measured from what the render holds, never from what it was sent
    // (chain.ts, finding 5): it may be a few frames short.
    const start = chain.starts[k];
    const switchAt = chainSwitchAt(chain.switches[k], start, probe.frames);
    if (switchAt - CHAIN_PREFIX_FRAMES < start) throw new ChainRetry(`piece ${k + 1} came back too short to open the next on (${probe.frames} frames)`);
    const planned = k + 1 < chain.switches.length ? chain.switches[k + 1] + CHAIN_TAIL_FRAMES : chain.total;
    const to = Math.min(chain.total, planned, switchAt + CHAIN_PIECE_MAX_FRAMES - CHAIN_PREFIX_FRAMES);

    await download(admin, chain.bucket, chain.window, windowFile);
    await run(
      chainNextPieceArgs({
        previousRender: render,
        prefixFrom: switchAt - CHAIN_PREFIX_FRAMES - start,
        window: windowFile,
        from: switchAt,
        to,
        size: { width: probe.width, height: probe.height },
        output: next,
      }),
      `making piece ${k + 2}`,
    );
    const inputPath = `${chain.folder}/in-${k + 2}.mp4`;
    await store(admin, chain.bucket, inputPath, await readFile(next));

    // THE LOOK (2026-09-20). One second of this render opens the next piece;
    // everything after it is the footage again, and on a take that changed
    // the whole picture that second is not enough — the piece falls back to
    // what the clip shows. So the frame the next piece opens on is kept as a
    // still and bound to it as a reference (chain.ts, ChainState.look).
    let lookUrl: string | null = null;
    if (chain.look) {
      const still = path.join(dir, "look.jpg");
      await run(chainStillArgs(render, switchAt - 1 - start, still), `reading part ${k + 1}'s last look`);
      const lookPath = `${chain.look.prefix}-${k + 2}.jpg`;
      await store(admin, chain.look.bucket, lookPath, await readFile(still), "image/jpeg");
      lookUrl = await sign(admin, chain.look.bucket, lookPath);
    }
    return { inputUrl: await sign(admin, chain.bucket, inputPath), renderPath, renderFrames: probe.frames, switchAt, lookUrl };
  });
}

// --- THE END ------------------------------------------------------------

/**
 * Every piece is in: cut each join where the renders agree best, lay the
 * pieces end to end with the window's sound under them, and store the take
 * where every finished video lives. Returns its media url.
 */
export async function joinChain(
  admin: Admin,
  userId: string,
  generationId: string,
  chain: ChainState,
  lastRenderUrl: string,
): Promise<{ resultUrl: string; offsets: number[] }> {
  return withScratch(async (dir) => {
    const files = chain.lengths.map((_, i) => path.join(dir, `piece-${i + 1}.mp4`));
    const windowFile = path.join(dir, "window.mp4");
    const joined = path.join(dir, "take.mp4");
    await Promise.all([
      ...chain.renders.map((p, i) => download(admin, chain.bucket, p, files[i])),
      fetchTo(lastRenderUrl, files[files.length - 1]),
      download(admin, chain.bucket, chain.window, windowFile),
    ]);

    const lastProbe = probeMp4(await readFile(files[files.length - 1]));
    if (!lastProbe?.frames) throw new ChainRetry("the last piece isn't a readable video");
    const pieces: ChainPiece[] = chain.starts.map((start, i) => ({
      start,
      frames: i < chain.frames.length ? chain.frames[i] : lastProbe.frames!,
    }));

    const size = AGREE_W * AGREE_H;
    const offsets: number[] = [];
    for (let k = 1; k < files.length; k++) {
      // The same moment in both renders: the second before the switch.
      const before = await runForBytes(
        chainAgreementArgs(files[k - 1], chain.switches[k - 1] - CHAIN_PREFIX_FRAMES - pieces[k - 1].start, CHAIN_PREFIX_FRAMES),
        `reading join ${k}`,
      );
      const after = await runForBytes(chainAgreementArgs(files[k], 0, CHAIN_PREFIX_FRAMES), `reading join ${k}`);
      const agreement = Array.from({ length: CHAIN_PREFIX_FRAMES }, (_, j) =>
        chainFrameDistance(before.subarray(j * size, (j + 1) * size), after.subarray(j * size, (j + 1) * size)),
      );
      offsets.push(chainJoinOffset(agreement));
    }

    const firstProbe = probeMp4(await readFile(files[0]));
    if (!firstProbe) throw new ChainRetry("the first piece isn't a readable video");
    const { spans, hold } = chainJoinSpans(pieces, chain.switches, offsets, chain.total);
    await run(
      chainJoinArgs({
        pieces: files,
        spans,
        hold,
        window: windowFile,
        totalFrames: chain.total,
        size: { width: firstProbe.width, height: firstProbe.height },
        output: joined,
      }),
      "joining the pieces",
    );
    const bytes = await readFile(joined);
    if (!probeMp4(bytes)) throw new ChainRetry("the joined take isn't a readable video");

    // Where every finished video lives, under a name a retried pass rewrites
    // rather than duplicates.
    const stored = `${userId}/take-${generationId}.mp4`;
    const { error } = await admin.storage.from("generated-videos").upload(stored, bytes, { contentType: "video/mp4", upsert: true });
    if (error) throw new ChainRetry(`couldn't store the joined take: ${error.message}`);
    return { resultUrl: mediaUrl("generated-videos", stored), offsets };
  });
}

/** A take's working files, gone — once it has finished either way. Best-effort. */
export async function cleanupChain(admin: Admin, chain: Pick<ChainState, "bucket" | "folder" | "look">): Promise<void> {
  try {
    const { data } = await admin.storage.from(chain.bucket).list(chain.folder, { limit: 100 });
    const names = (data ?? []).map((o) => `${chain.folder}/${o.name}`);
    if (names.length) await admin.storage.from(chain.bucket).remove(names);
  } catch (err) {
    console.warn("[chain] cleanup failed; the files stay.", err);
  }
  // The stills live in the image bucket, beside the person's own uploads, so
  // they are cleared by name rather than by folder.
  if (!chain.look) return;
  try {
    const at = chain.look.prefix.lastIndexOf("/");
    const folder = at > 0 ? chain.look.prefix.slice(0, at) : "";
    const name = chain.look.prefix.slice(at + 1);
    const { data } = await admin.storage.from(chain.look.bucket).list(folder, { limit: 200, search: name });
    const names = (data ?? []).map((o) => (folder ? `${folder}/${o.name}` : o.name));
    if (names.length) await admin.storage.from(chain.look.bucket).remove(names);
  } catch (err) {
    console.warn("[chain] the stills stay.", err);
  }
}

/** The progress line while a take is in pieces — mapped for translation in lib/i18n/server-text.ts. */
export function chainProgress(chain: Pick<ChainState, "index" | "lengths">): string {
  return `Rendering part ${chain.index + 1} of ${chain.lengths.length}`;
}
