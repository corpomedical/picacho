// The frame lines are the picture (Helios Cinema, 2026-09-15): a still shot
// in a rig format renders at 3:2 (or 2:3) and is cut here, on the server, to
// the band the stage's frame lines drew — the largest centred rectangle of
// the band's shape — before it is stored. Nothing about the cut is left to
// the image model's reading of words, and nothing the person framed out of
// the picture survives in it. The square is never cut.
//
// Server-only (sharp). Relative imports only: tested as it is.

import sharp from "sharp";

/** The band of `bandAspect` (width ÷ height) cut from the middle of a `w` × `h` picture, pixels. */
export function bandRect(w: number, h: number, bandAspect: number): { left: number; top: number; width: number; height: number } {
  if (!(w > 0) || !(h > 0) || !(bandAspect > 0)) return { left: 0, top: 0, width: Math.max(1, w), height: Math.max(1, h) };
  if (bandAspect >= w / h) {
    const height = Math.max(1, Math.min(h, Math.round(w / bandAspect)));
    return { left: 0, top: Math.floor((h - height) / 2), width: w, height };
  }
  const width = Math.max(1, Math.min(w, Math.round(h * bandAspect)));
  return { left: Math.floor((w - width) / 2), top: 0, width, height: h };
}

/** A base64 picture cut to its centred band, as base64 PNG (what persistGeneratedImage stores). */
export async function cutToBand(base64: string, bandAspect: number): Promise<string> {
  const input = Buffer.from(base64, "base64");
  const image = sharp(input);
  const meta = await image.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return base64;
  const rect = bandRect(w, h, bandAspect);
  if (rect.width === w && rect.height === h) return base64;
  const out = await image.extract(rect).png().toBuffer();
  return out.toString("base64");
}
