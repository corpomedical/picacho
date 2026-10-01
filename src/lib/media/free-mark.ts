// The Picacho "P" on free accounts' pictures and videos (operator,
// 2026-10-02: "The Picacho logo "P" in transparent like gemini"). It is the
// share loop from the go-big plan: a free output that gets posted carries the
// mark; paid plans download clean.
//
// The mark is public/mark-p.png: the "P" and its underline cut from the
// wordmark (public/logo-dark.png, so the letter is the brand's own drawing,
// not a font stand-in), all white, with a soft dark shadow baked in so it
// still reads on a bright frame. Drawn at 55% like the gallery's mark
// (picacho-mark.tsx), bottom right.
//
// Sized from the frame's SHORT side so a vertical 9:16 episode and a 16:9
// clip carry the same-looking mark, never one stretched to a wide frame.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { probeMp4 } from "./mp4-probe";

export const FREE_MARK = {
  file: "public/mark-p.png",
  /** The mark's height (shadow included) as a share of the frame's short side. */
  height: 0.05,
  /** Gap to the right and bottom edges, as a share of the short side. */
  margin: 0.025,
  opacity: 0.55,
} as const;

/** Where the mark lands on a w x h frame, in whole pixels. */
export function freeMarkBox(
  width: number,
  height: number,
  markAspect: number,
): { w: number; h: number; x: number; y: number } {
  const short = Math.min(width, height);
  const h = Math.max(1, Math.round(short * FREE_MARK.height));
  const w = Math.max(1, Math.round(h * markAspect));
  const gap = Math.round(short * FREE_MARK.margin);
  return { w, h, x: width - w - gap, y: height - h - gap };
}

async function markPng(): Promise<Buffer> {
  return readFile(path.join(process.cwd(), FREE_MARK.file));
}

/** The picture with the mark drawn in, in the picture's own format. */
export async function burnFreeMarkImage(input: Buffer): Promise<Buffer> {
  const image = sharp(input, { failOn: "none" }).rotate();
  const meta = await image.metadata();
  const { width, height } = await image.clone().toBuffer({ resolveWithObject: true }).then((r) => r.info);
  const mark = await markPng();
  const markMeta = await sharp(mark).metadata();
  const box = freeMarkBox(width, height, (markMeta.width ?? 1) / (markMeta.height ?? 1));
  const ghost = await sharp(mark)
    .resize({ width: box.w, height: box.h, fit: "fill" })
    // dest-in keeps the mark's own shape and multiplies its alpha by 55%.
    .composite([
      {
        input: Buffer.from([255, 255, 255, Math.round(255 * FREE_MARK.opacity)]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
  const out = image.composite([{ input: ghost, left: box.x, top: box.y }]);
  switch (meta.format) {
    case "png":
      return out.png().toBuffer();
    case "webp":
      return out.webp({ quality: 92 }).toBuffer();
    default:
      return out.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  }
}

/**
 * The ffmpeg filter that draws the mark on input 0 (the video) from input 1
 * (mark-p.png), at the same box a picture of that size gets: sized from the
 * frame we measured, never from ffmpeg's own scale-to-reference expressions
 * (the first sample came out a fraction of the size with those).
 */
export function freeMarkVideoFilter(width: number, height: number, markAspect: number): string {
  const b = freeMarkBox(width, height, markAspect);
  return (
    `[1:v]scale=${b.w}:${b.h},format=rgba,colorchannelmixer=aa=${FREE_MARK.opacity}[mk];` +
    `[0:v][mk]overlay=x=${b.x}:y=${b.y}`
  );
}

/** Burns the mark into a video file; the sound is copied untouched. */
export async function burnFreeMarkVideo(ffmpegPath: string, src: string, dest: string): Promise<void> {
  const probe = probeMp4(await readFile(src));
  if (!probe || probe.width <= 0 || probe.height <= 0) throw new Error("free mark: unreadable video size");
  const markMeta = await sharp(await markPng()).metadata();
  const filter = freeMarkVideoFilter(probe.width, probe.height, (markMeta.width ?? 1) / (markMeta.height ?? 1));
  await promisify(execFile)(
    ffmpegPath,
    [
      "-v", "error", "-y",
      "-i", src,
      "-i", path.join(process.cwd(), FREE_MARK.file),
      "-filter_complex", filter,
      "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-c:a", "copy", "-movflags", "+faststart", "-f", "mp4", dest,
    ],
    { timeout: 120_000 },
  );
}
