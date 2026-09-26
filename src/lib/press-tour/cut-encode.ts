// The cut's encoder (Cut 4; spec §1.10, constraints §6D): the export preset,
// the ffmpeg command builders, the pictures laid over the film (captions,
// the AI-generated tag) and the end card, all deterministic.
//
// THE PRESET (constraints §6D, one master file for every network): MP4,
// 1080x1920, H.264 High, progressive, closed GOP, constant 30 fps, the moov
// atom at the front, no edit lists; AAC-LC 48 kHz stereo 128 kbps (a silent
// track when the take has no sound, which is always in v1: audio off, music
// off by default); under 25 Mbps.
//
// TWO PHASES (reel-encode.ts's reason): each chosen take is normalised on
// its own into a segment (with its captions, and in the tagged variant the
// tag), then the segments are joined with `-c copy`, which is safe because
// every segment came out of the same arguments. Peak disk is one take plus a
// few segments, never every source at once.
//
// TEXT IS NEVER HANDED TO FFMPEG. No drawtext anywhere: the plan's on-screen
// words and the tag are drawn as SVG and rasterised by sharp. The words are
// drawn as glyph OUTLINES from a bundled OFL font (Archivo, the invoice's
// traced copy: src/lib/billing/fonts), so the picture never depends on the
// server's fonts and a word can never become markup. When the font cannot be
// read, the fallback is an SVG <text> whose content is XML-escaped.
//
// Alias-free (vitest has no "@/"): cut-encode.test.ts runs the builders, and
// the real binary on tiny clips when ffmpeg-static is present.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type { TagCorner } from "./shots";
import { TRAINED_ALGORITHMIC_MEDIA } from "./sign";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// The preset
// ---------------------------------------------------------------------------

export type ExportPreset = {
  width: number;
  height: number;
  fps: number;
  crf: number;
  /** Peak video bitrate (kbps) and its buffer: the master stays under 25 Mbps. */
  maxrateKbps: number;
  bufsizeKbps: number;
  profile: "high";
  level: string;
  x264Preset: string;
  audioRate: number;
  audioKbps: number;
};

/** The master every network takes (constraints §6D). */
export const EXPORT_PRESET: ExportPreset = {
  width: 1080,
  height: 1920,
  fps: 30,
  crf: 20,
  maxrateKbps: 16_000,
  bufsizeKbps: 32_000,
  profile: "high",
  level: "4.1",
  x264Preset: "fast",
  audioRate: 48_000,
  audioKbps: 128,
};

/** Length a delivered ad must have (the overlap of every network's limits: constraints §6D). */
export const MASTER_MIN_SECONDS = 3;
export const MASTER_MAX_SECONDS = 90;
/** Bytes a delivered file may have (the press-kit bucket's own limit is 100 MB; constraints say under 300 MB). */
export const MASTER_MAX_BYTES = 100 * 1024 * 1024;
/** The brand's end card on the tagged rendition (spec §1.10 step 7). */
export const END_CARD_SECONDS = 1.5;

/** One segment's encode may take this long (a 5 s take at 1080x1920). */
export const SEGMENT_TIMEOUT_MS = 75_000;
/** A join is a copy: seconds. */
export const JOIN_TIMEOUT_MS = 30_000;

/** The encode half every segment shares, so the join can copy them (identical codec parameters). */
export function encodeArgs(preset: ExportPreset = EXPORT_PRESET): string[] {
  return [
    "-c:v",
    "libx264",
    "-preset",
    preset.x264Preset,
    "-profile:v",
    preset.profile,
    "-level:v",
    preset.level,
    "-pix_fmt",
    "yuv420p",
    "-crf",
    String(preset.crf),
    "-maxrate",
    `${preset.maxrateKbps}k`,
    "-bufsize",
    `${preset.bufsizeKbps}k`,
    // A keyframe every second, none moved by scene cuts, closed GOPs: every
    // segment starts on a keyframe and the copy-join never starts mid-GOP.
    "-g",
    String(preset.fps),
    "-keyint_min",
    String(preset.fps),
    "-sc_threshold",
    "0",
    "-flags",
    "+cgop",
    "-r",
    String(preset.fps),
    "-fps_mode",
    "cfr",
    "-c:a",
    "aac",
    "-profile:a",
    "aac_low",
    "-b:a",
    `${preset.audioKbps}k`,
    "-ar",
    String(preset.audioRate),
    "-ac",
    "2",
    // Nothing of the source's metadata rides along (provider tags, a stale manifest).
    "-map_metadata",
    "-1",
    "-movflags",
    "+faststart",
    "-use_editlist",
    "0",
  ];
}

/** The picture scaled into the frame (letterboxed, never squashed), constant frame rate. */
function frameFilter(preset: ExportPreset): string {
  const { width: w, height: h, fps } = preset;
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps},setsar=1`;
}

/** A silent stereo track of `seconds` (the take's own sound is never used: audio off, critique #18). */
function silence(preset: ExportPreset, seconds: number): string[] {
  return ["-f", "lavfi", "-t", seconds.toFixed(3), "-i", `anullsrc=channel_layout=stereo:sample_rate=${preset.audioRate}`];
}

/**
 * One chosen take, normalised to the preset, `seconds` long, its own sound
 * replaced by silence, with an optional full-frame PNG laid over it (the
 * captions, and in the tagged variant the tag).
 */
export function segmentArgs(input: { source: string; output: string; seconds: number; overlay: string | null; preset?: ExportPreset }): string[] {
  const preset = input.preset ?? EXPORT_PRESET;
  const seconds = Math.max(0.5, input.seconds);
  const args = ["-y", "-v", "error", "-i", input.source];
  if (input.overlay) args.push("-i", input.overlay);
  args.push(...silence(preset, seconds));
  const audioIndex = input.overlay ? 2 : 1;
  const filter = input.overlay
    ? `[0:v]${frameFilter(preset)}[base];[base][1:v]overlay=0:0,format=yuv420p[v]`
    : `[0:v]${frameFilter(preset)},format=yuv420p[v]`;
  args.push("-filter_complex", filter, "-map", "[v]", "-map", `${audioIndex}:a:0`, "-t", seconds.toFixed(3), ...encodeArgs(preset), "-shortest", input.output);
  return args;
}

/** The end card: one still picture held END_CARD_SECONDS, encoded exactly like a segment. */
export function endCardArgs(input: { image: string; output: string; seconds?: number; preset?: ExportPreset }): string[] {
  const preset = input.preset ?? EXPORT_PRESET;
  const seconds = input.seconds ?? END_CARD_SECONDS;
  return [
    "-y",
    "-v",
    "error",
    "-loop",
    "1",
    "-framerate",
    String(preset.fps),
    "-t",
    seconds.toFixed(3),
    "-i",
    input.image,
    ...silence(preset, seconds),
    "-filter_complex",
    `[0:v]${frameFilter(preset)},format=yuv420p[v]`,
    "-map",
    "[v]",
    "-map",
    "1:a:0",
    "-t",
    seconds.toFixed(3),
    ...encodeArgs(preset),
    "-shortest",
    input.output,
  ];
}

/**
 * The machine-readable AI marking every finished file carries (fixer
 * 2026-09-26, PT-R3-03; EU AI Act Art. 50(2)), written by the join into the
 * file's own metadata (moov/udta: ©cmt and desc): the plain words and IPTC's
 * digital source type for media made by a trained model. It stands in until
 * C2PA signing is live (sign.ts), and stays after: the clean TikTok file has
 * no visible tag, so this is its only mark of its own.
 */
export const AI_MARK_COMMENT = "AI-generated with Picacho Press Tour";
export const AI_MARK_DESCRIPTION = `AI-generated. IPTC digital source type: ${TRAINED_ALGORITHMIC_MEDIA}`;

/**
 * The segments joined without re-encoding (they share every codec
 * parameter). The sources' own metadata never rides along; Picacho's AI
 * marking is written instead.
 */
export function joinArgs(listPath: string, output: string): string[] {
  return [
    "-y",
    "-v",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    "-map_metadata",
    "-1",
    "-metadata",
    `comment=${AI_MARK_COMMENT}`,
    "-metadata",
    `description=${AI_MARK_DESCRIPTION}`,
    "-movflags",
    "+faststart",
    "-use_editlist",
    "0",
    output,
  ];
}

/** The concat demuxer's list: one absolute path per line, ours only (never user input). */
export function joinList(paths: readonly string[]): string {
  if (paths.length === 0) throw new Error("joinList: no segments");
  for (const p of paths) {
    if (!path.isAbsolute(p) || p.includes("'") || p.includes("\n")) throw new Error(`joinList: unsafe path ${p}`);
  }
  return `${paths.map((p) => `file '${p}'`).join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Running the binary
// ---------------------------------------------------------------------------

/** ffmpeg-static's binary, or null (a route without it traced: next.config.ts). */
export async function ffmpegBinary(): Promise<string | null> {
  try {
    const mod = (await import("ffmpeg-static")) as unknown as { default?: string | null } | string | null;
    const p = typeof mod === "string" ? mod : (mod?.default ?? null);
    return typeof p === "string" && p ? p : null;
  } catch {
    return null;
  }
}

export type RunResult = { ok: true } | { ok: false; error: string };

/** One ffmpeg run. Never throws: no binary, a timeout or a non-zero exit is an error with ffmpeg's own words (for Admin). */
export async function runFfmpeg(args: readonly string[], timeoutMs: number): Promise<RunResult> {
  const binary = await ffmpegBinary();
  if (!binary) return { ok: false, error: "ffmpeg-static resolved no binary (is the route traced in next.config.ts?)" };
  try {
    await execFileAsync(binary, [...args], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true };
  } catch (err) {
    const e = err as { stderr?: string; message?: string; killed?: boolean };
    const detail = (e.stderr || e.message || "ffmpeg failed").toString().trim().slice(-400);
    return { ok: false, error: e.killed ? `ffmpeg timed out after ${timeoutMs} ms` : detail };
  }
}

// ---------------------------------------------------------------------------
// Words as pictures (never markup)
// ---------------------------------------------------------------------------

/** XML-escape for anything that must go inside SVG as text (the fallback, and attribute values). */
export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** The drawing font: the invoice's traced OFL copy (src/lib/billing/fonts/README.md). */
export const CUT_FONT_PATH = path.join(process.cwd(), "src/lib/billing/fonts/Archivo-SemiBold.ttf");

type GlyphRun = { glyphs: { id: number; path: { toSVG(): string } }[]; positions: { xAdvance: number; xOffset: number; yOffset: number }[]; advanceWidth: number };
export type OutlineFont = { unitsPerEm: number; layout(text: string): GlyphRun };

let fontPromise: Promise<OutlineFont | null> | null = null;

/** The drawing font, read once; null when it cannot be read (the escaped <text> fallback is used). */
export function loadCutFont(file: string = CUT_FONT_PATH): Promise<OutlineFont | null> {
  if (file !== CUT_FONT_PATH) return readFont(file);
  fontPromise ??= readFont(file);
  return fontPromise;
}

async function readFont(file: string): Promise<OutlineFont | null> {
  try {
    const bytes = await readFile(file);
    const fontkit = (await import("@pdf-lib/fontkit")) as unknown as { default?: { create(b: Uint8Array): unknown }; create?(b: Uint8Array): unknown };
    const create = fontkit.create ?? fontkit.default?.create;
    if (!create) return null;
    const font = create(new Uint8Array(bytes)) as OutlineFont;
    return typeof font?.layout === "function" && font.unitsPerEm > 0 ? font : null;
  } catch {
    return null;
  }
}

/** The width of `text` at `size` px. With no font: a conservative estimate (0.6 em a character). */
export function textWidth(font: OutlineFont | null, text: string, size: number): number {
  if (!font) return Array.from(text).length * size * 0.6;
  return (font.layout(text).advanceWidth * size) / font.unitsPerEm;
}

/**
 * `text` drawn at (x, baseline), `size` px, as SVG: glyph outlines when the
 * font is there (a glyph the font lacks is left out, never a box), else an
 * escaped <text>.
 */
export function textSvg(font: OutlineFont | null, text: string, o: { x: number; baseline: number; size: number; fill: string; opacity?: number }): string {
  const opacity = o.opacity === undefined ? "" : ` fill-opacity="${o.opacity}"`;
  if (!font) {
    return `<text x="${o.x.toFixed(1)}" y="${o.baseline.toFixed(1)}" font-family="sans-serif" font-size="${o.size}" fill="${escapeXml(o.fill)}"${opacity}>${escapeXml(text)}</text>`;
  }
  const run = font.layout(text);
  const scale = o.size / font.unitsPerEm;
  let pen = 0;
  const parts: string[] = [];
  run.glyphs.forEach((g, i) => {
    const pos = run.positions[i];
    const d = g.id === 0 ? "" : g.path.toSVG();
    // Path data is numbers and command letters only: nothing of the words themselves reaches the SVG.
    if (d && /^[MLHVCSQTAZmlhvcsqtaz0-9.,\-\s e]*$/.test(d)) {
      parts.push(`<path transform="translate(${(pen + pos.xOffset).toFixed(1)} ${pos.yOffset.toFixed(1)})" d="${d}"/>`);
    }
    pen += pos.xAdvance;
  });
  return `<g transform="translate(${o.x.toFixed(2)} ${o.baseline.toFixed(2)}) scale(${scale.toFixed(6)} ${(-scale).toFixed(6)})" fill="${escapeXml(o.fill)}"${opacity}>${parts.join("")}</g>`;
}

// ---------------------------------------------------------------------------
// The tag (operator, 2026-09-26: a SMALL visible "AI-generated" on every ad
// rendition except TikTok's; about 2% of the frame height, in a bottom corner
// holding neither product nor face)
// ---------------------------------------------------------------------------

export type Box = { x: number; y: number; w: number; h: number };

/** The tag's chip and its words, in pixels. */
export function tagGeometry(preset: Pick<ExportPreset, "width" | "height">, textPx: number, corner: TagCorner) {
  const h = Math.round(preset.height * 0.02); // 38 px on 1920
  const size = Math.round(h * 0.55);
  const padX = Math.round(h * 0.42);
  const w = Math.round(textPx + padX * 2);
  const marginX = Math.round(preset.width * 0.03);
  const marginBottom = Math.round(preset.height * 0.025);
  const x = corner === "left" ? marginX : preset.width - marginX - w;
  const y = preset.height - marginBottom - h;
  return { x, y, w, h, size, textX: x + padX, baseline: y + Math.round(h * 0.69), radius: Math.round(h * 0.25) };
}

function tagSvg(font: OutlineFont | null, preset: ExportPreset, text: string, corner: TagCorner): string {
  const probe = Math.round(preset.height * 0.02 * 0.55);
  const g = tagGeometry(preset, textWidth(font, text, probe), corner);
  return (
    `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="${g.radius}" fill="#000000" fill-opacity="0.45"/>` +
    textSvg(font, text, { x: g.textX, baseline: g.baseline, size: g.size, fill: "#ffffff", opacity: 0.9 })
  );
}

// ---------------------------------------------------------------------------
// Captions (the plan's on-screen words: spec §1.10 step 5). Clear of the
// platforms' own buttons and captions: the bottom 20% and the right 12%.
// ---------------------------------------------------------------------------

/** Words wrapped into at most `maxLines` lines that fit `maxWidth` px; a word too long for any line is dropped. */
export function wrapWords(font: OutlineFont | null, text: string, size: number, maxWidth: number, maxLines = 2): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (textWidth(font, word, size) > maxWidth) continue;
    const next = line ? `${line} ${word}` : word;
    if (textWidth(font, next, size) <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.slice(0, maxLines);
}

export function captionGeometry(preset: Pick<ExportPreset, "width" | "height">) {
  const size = Math.round(preset.height * 0.034); // 65 px on 1920
  const safeLeft = preset.width * 0.06;
  const safeRight = preset.width * 0.88; // the right 12% holds the platforms' buttons
  return {
    size,
    maxWidth: Math.round((safeRight - safeLeft) * 0.9),
    centerX: (safeLeft + safeRight) / 2,
    bottom: Math.round(preset.height * 0.78), // the bottom 20% holds the platforms' captions
    lineHeight: Math.round(size * 1.3),
    padX: Math.round(size * 0.35),
    padY: Math.round(size * 0.18),
  };
}

function captionSvg(font: OutlineFont | null, preset: ExportPreset, text: string): string {
  const c = captionGeometry(preset);
  const lines = wrapWords(font, text, c.size, c.maxWidth);
  const out: string[] = [];
  lines.forEach((line, i) => {
    const w = textWidth(font, line, c.size);
    const baseline = c.bottom - (lines.length - 1 - i) * c.lineHeight - c.padY - Math.round(c.size * 0.22);
    const x = c.centerX - w / 2;
    const top = baseline - Math.round(c.size * 0.8) - c.padY;
    out.push(`<rect x="${(x - c.padX).toFixed(1)}" y="${top}" width="${(w + c.padX * 2).toFixed(1)}" height="${c.lineHeight}" rx="${Math.round(c.size * 0.2)}" fill="#000000" fill-opacity="0.55"/>`);
    out.push(textSvg(font, line, { x, baseline, size: c.size, fill: "#ffffff" }));
  });
  return out.join("");
}

/** The full-frame picture laid over one segment: captions and/or the tag; null when there is nothing to lay. */
export function overlaySvg(input: {
  font: OutlineFont | null;
  preset?: ExportPreset;
  caption: string | null;
  tag: { text: string; corner: TagCorner } | null;
}): string | null {
  const preset = input.preset ?? EXPORT_PRESET;
  const caption = input.caption?.trim() ? captionSvg(input.font, preset, input.caption.trim()) : "";
  const tag = input.tag ? tagSvg(input.font, preset, input.tag.text, input.tag.corner) : "";
  if (!caption && !tag) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${preset.width}" height="${preset.height}" viewBox="0 0 ${preset.width} ${preset.height}">${caption}${tag}</svg>`;
}

/** An SVG as the PNG ffmpeg lays over the film. */
export async function rasterise(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg), { limitInputPixels: 50_000_000 }).png().toBuffer();
}

// ---------------------------------------------------------------------------
// The end card: the brand's logo over its first colour, and the call to
// action (the tagged rendition only; no Picacho mark anywhere: en.ts:672).
// ---------------------------------------------------------------------------

const HEX = /^#[0-9a-f]{6}$/i;

/** Dark words on a light colour, light words on a dark one (WCAG relative luminance). */
export function inkFor(hex: string): string {
  if (!HEX.test(hex)) return "#ffffff";
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return lum > 0.4 ? "#111111" : "#ffffff";
}

export async function renderEndCard(input: {
  font: OutlineFont | null;
  preset?: ExportPreset;
  logo: Buffer;
  background: string | null;
  cta: string | null;
}): Promise<Buffer> {
  const preset = input.preset ?? EXPORT_PRESET;
  const bg = input.background && HEX.test(input.background) ? input.background.toLowerCase() : "#111111";
  const logo = await sharp(input.logo, { limitInputPixels: 50_000_000 })
    .resize({ width: Math.round(preset.width * 0.6), height: Math.round(preset.height * 0.28), fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = Math.round((preset.width - logo.info.width) / 2);
  const top = Math.round(preset.height * 0.42 - logo.info.height / 2);
  const layers: Parameters<ReturnType<typeof sharp>["composite"]>[0] = [{ input: logo.data, left, top }];
  const cta = input.cta?.trim();
  if (cta) {
    const size = Math.round(preset.height * 0.036);
    const lines = wrapWords(input.font, cta, size, Math.round(preset.width * 0.8));
    const svgLines = lines.map((line, i) =>
      textSvg(input.font, line, {
        x: (preset.width - textWidth(input.font, line, size)) / 2,
        baseline: Math.round(preset.height * 0.62) + i * Math.round(size * 1.3),
        size,
        fill: inkFor(bg),
      }),
    );
    layers.push({
      input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${preset.width}" height="${preset.height}">${svgLines.join("")}</svg>`),
      left: 0,
      top: 0,
    });
  }
  return sharp({ create: { width: preset.width, height: preset.height, channels: 4, background: bg } }).composite(layers).png().toBuffer();
}
