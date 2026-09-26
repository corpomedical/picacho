import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mp4TopLevelBoxes } from "../media/c2pa-probe";
import {
  AI_MARK_COMMENT,
  AI_MARK_DESCRIPTION,
  EXPORT_PRESET,
  END_CARD_SECONDS,
  captionGeometry,
  encodeArgs,
  endCardArgs,
  escapeXml,
  inkFor,
  joinArgs,
  joinList,
  loadCutFont,
  overlaySvg,
  rasterise,
  renderEndCard,
  runFfmpeg,
  segmentArgs,
  tagGeometry,
  textSvg,
  textWidth,
  wrapWords,
  type ExportPreset,
} from "./cut-encode";
import { renditionProblem } from "./cut";
import { AI_TAG_TEXT } from "./film-messages";
import { TRAINED_ALGORITHMIC_MEDIA } from "./sign";

// The cut's encoder (Cut 4): the export preset every network takes
// (constraints §6D), the command builders, the words drawn as outlines
// (never markup, never drawtext), the tag's size and place, and — when
// ffmpeg-static is there — the real binary on tiny clips.

describe("the export preset (constraints §6D)", () => {
  it("1080x1920, H.264 High, constant 30 fps, closed GOP, faststart, no edit lists, AAC-LC 48 kHz stereo 128 kbps, under 25 Mbps", () => {
    expect(EXPORT_PRESET).toMatchObject({ width: 1080, height: 1920, fps: 30, profile: "high", audioRate: 48000, audioKbps: 128 });
    expect(EXPORT_PRESET.maxrateKbps).toBeLessThan(25_000);
    const a = encodeArgs().join(" ");
    expect(a).toContain("-c:v libx264");
    expect(a).toContain("-profile:v high");
    expect(a).toContain("-pix_fmt yuv420p");
    expect(a).toContain("-r 30 -fps_mode cfr");
    expect(a).toContain("-g 30 -keyint_min 30 -sc_threshold 0 -flags +cgop");
    expect(a).toContain("-c:a aac -profile:a aac_low -b:a 128k -ar 48000 -ac 2");
    expect(a).toContain("-movflags +faststart");
    expect(a).toContain("-use_editlist 0");
    expect(a).toContain("-map_metadata -1");
    expect(a).toContain(`-maxrate ${EXPORT_PRESET.maxrateKbps}k`);
  });

  it("a segment replaces the take's own sound with silence, letterboxes (never squashes), and lays the overlay over the film", () => {
    const withOverlay = segmentArgs({ source: "/t/take.mp4", output: "/t/out.mp4", seconds: 5, overlay: "/t/o.png" });
    const joined = withOverlay.join(" ");
    expect(joined).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    expect(joined).toContain("-map [v] -map 2:a:0");
    expect(joined).toContain("force_original_aspect_ratio=decrease,pad=1080:1920");
    expect(joined).toContain("[base][1:v]overlay=0:0");
    expect(joined).toContain("-t 5.000");
    // The take's own sound is never mapped.
    expect(joined).not.toMatch(/-map 0:a/);
    const plain = segmentArgs({ source: "/t/take.mp4", output: "/t/out.mp4", seconds: 5, overlay: null }).join(" ");
    expect(plain).toContain("-map 1:a:0");
    expect(plain).not.toContain("overlay");
  });

  it("no text ever reaches ffmpeg: no drawtext, no subtitles filter, in any builder", () => {
    const all = [
      ...segmentArgs({ source: "/a", output: "/b", seconds: 5, overlay: "/c.png" }),
      ...endCardArgs({ image: "/card.png", output: "/o.mp4" }),
      ...joinArgs("/l.txt", "/o.mp4"),
    ].join(" ");
    expect(all).not.toMatch(/drawtext|subtitles|ass=|textfile/);
  });

  it("the end card is held 1.5 s and encoded exactly like a segment (so the join can copy it)", () => {
    const a = endCardArgs({ image: "/card.png", output: "/o.mp4" });
    expect(a.join(" ")).toContain(`-t ${END_CARD_SECONDS.toFixed(3)}`);
    expect(a.slice(a.indexOf("-c:v"))).toEqual(expect.arrayContaining(encodeArgs()));
  });

  it("the join writes Picacho's machine-readable AI marking over the sources' stripped metadata (PT-R3-03)", () => {
    const a = joinArgs("/l.txt", "/o.mp4");
    const joined = a.join(" ");
    // The sources' metadata never rides along; the marking is written after that.
    expect(joined).toContain("-map_metadata -1 -metadata");
    expect(a).toContain(`comment=${AI_MARK_COMMENT}`);
    expect(a).toContain(`description=${AI_MARK_DESCRIPTION}`);
    expect(AI_MARK_COMMENT).toBe("AI-generated with Picacho Press Tour");
    expect(AI_MARK_DESCRIPTION).toContain(TRAINED_ALGORITHMIC_MEDIA);
    expect(TRAINED_ALGORITHMIC_MEDIA).toBe("http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia");
  });

  it("the join copies, with faststart and no edit lists; its list takes only our own absolute paths", () => {
    expect(joinArgs("/l.txt", "/o.mp4")).toEqual(expect.arrayContaining(["-c", "copy", "+faststart", "-use_editlist", "0", "-safe", "0"]));
    expect(joinList(["/tmp/a/0.mp4", "/tmp/a/1.mp4"])).toBe("file '/tmp/a/0.mp4'\nfile '/tmp/a/1.mp4'\n");
    expect(() => joinList([])).toThrow();
    expect(() => joinList(["relative.mp4"])).toThrow();
    expect(() => joinList(["/tmp/it's.mp4"])).toThrow();
    expect(() => joinList(["/tmp/a\nfile '/etc/passwd'"])).toThrow();
  });
});

describe("the tag (operator, 2026-09-26)", () => {
  it("about 2% of the frame height, in a bottom corner, clear of the edges", () => {
    const left = tagGeometry(EXPORT_PRESET, 120, "left");
    expect(left.h).toBe(38); // 2% of 1920
    expect(left.x).toBe(32);
    expect(left.y + left.h).toBeLessThanOrEqual(1920 - 40);
    expect(left.y).toBeGreaterThan(1920 * 0.9);
    const right = tagGeometry(EXPORT_PRESET, 120, "right");
    expect(right.x + right.w).toBe(1080 - 32);
    expect(right.y).toBe(left.y);
  });

  it("its words are the design's, one per language", () => {
    expect(AI_TAG_TEXT).toEqual({ en: "AI-generated", es: "Generado por IA", pt: "Gerado por IA", it: "Generato con l'IA" });
  });
});

describe("words as pictures, never markup", () => {
  it("escapes XML", () => {
    expect(escapeXml(`<script>alert("x")</script> & 'y'`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &apos;y&apos;");
  });

  it("with the font: glyph outlines only, the words themselves never in the SVG", async () => {
    const font = await loadCutFont();
    expect(font).not.toBeNull();
    const svg = textSvg(font, `</g><script>x</script>`, { x: 10, baseline: 50, size: 30, fill: "#ffffff" });
    expect(svg).not.toContain("script");
    expect(svg).not.toContain("</g><");
    expect(svg).toMatch(/^<g transform="translate\(10\.00 50\.00\) scale\([\d.]+ -[\d.]+\)" fill="#ffffff"><path /);
  });

  it("without the font: an SVG <text> whose content is escaped", () => {
    const svg = textSvg(null, `a<b>&"c"`, { x: 1, baseline: 2, size: 10, fill: "#fff" });
    expect(svg).toContain(">a&lt;b&gt;&amp;&quot;c&quot;</text>");
  });

  it("captions wrap to at most 2 lines inside the safe zone (clear of the bottom 20% and the right 12%)", async () => {
    const font = await loadCutFont();
    const c = captionGeometry(EXPORT_PRESET);
    expect(c.bottom).toBeLessThanOrEqual(1920 * 0.8);
    expect(c.centerX + c.maxWidth / 2).toBeLessThanOrEqual(1080 * 0.88);
    const lines = wrapWords(font, "Mornings made calm with one cold brew can", c.size, c.maxWidth);
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const l of lines) expect(textWidth(font, l, c.size)).toBeLessThanOrEqual(c.maxWidth);
  });

  it("the overlay: nothing to lay is null; captions and the tag draw into one full frame", async () => {
    const font = await loadCutFont();
    expect(overlaySvg({ font, caption: null, tag: null })).toBeNull();
    expect(overlaySvg({ font, caption: "   ", tag: null })).toBeNull();
    const svg = overlaySvg({ font, caption: "Cold <b>brew</b>", tag: { text: AI_TAG_TEXT.en, corner: "right" } })!;
    expect(svg).not.toMatch(/<b>|brew|AI-generated/);
    const png = await rasterise(svg);
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height, meta.channels]).toEqual([1080, 1920, 4]);
    // The chip is drawn in the bottom-right corner; the bottom-left stays clear.
    const g = tagGeometry(EXPORT_PRESET, textWidth(font, AI_TAG_TEXT.en, 21), "right");
    const alpha = async (left: number) => (await sharp(await sharp(png).extract({ left, top: g.y + 4, width: 10, height: 10 }).toBuffer()).stats()).channels[3].mean;
    expect(await alpha(g.x + 2)).toBeGreaterThan(80);
    expect(await alpha(40)).toBe(0);
  });

  it("the end card's words take the ink that reads on the brand's colour", async () => {
    expect(inkFor("#ffffff")).toBe("#111111");
    expect(inkFor("#101010")).toBe("#ffffff");
    expect(inkFor("not a colour")).toBe("#ffffff");
    const logo = await sharp({ create: { width: 200, height: 100, channels: 4, background: "#e0a468" } }).png().toBuffer();
    const card = await renderEndCard({ font: await loadCutFont(), logo, background: "#101010", cta: "Try it <today>" });
    const meta = await sharp(card).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1920]);
  });
});

// ---------------------------------------------------------------------------

const ffmpegPath = join(__dirname, "..", "..", "..", "node_modules", "ffmpeg-static", "ffmpeg");
const HAS_FFMPEG = existsSync(ffmpegPath);
const TINY: ExportPreset = { ...EXPORT_PRESET, width: 108, height: 192, crf: 30, x264Preset: "veryfast" };
let dir = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "press-encode-test-"));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!HAS_FFMPEG)("the real encoder", () => {
  it(
    "a 16:9 take letterboxed into the frame, joined with the end card: the preset's frame, faststart, the right length",
    async () => {
      const take = join(dir, "wide.mp4");
      execFileSync(ffmpegPath, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=s=160x90:r=25:d=2", "-pix_fmt", "yuv420p", "-c:v", "libx264", take]);
      const overlay = join(dir, "o.png");
      writeFileSync(overlay, await rasterise(overlaySvg({ font: await loadCutFont(), preset: TINY, caption: "Hi", tag: { text: "AI-generated", corner: "left" } })!));
      const seg = join(dir, "seg.mp4");
      expect(await runFfmpeg(segmentArgs({ source: take, output: seg, seconds: 3, overlay, preset: TINY }), 30_000)).toEqual({ ok: true });
      const card = join(dir, "card.png");
      writeFileSync(card, await sharp({ create: { width: 108, height: 192, channels: 4, background: "#101010" } }).png().toBuffer());
      const end = join(dir, "end.mp4");
      expect(await runFfmpeg(endCardArgs({ image: card, output: end, preset: TINY }), 30_000)).toEqual({ ok: true });
      const list = join(dir, "l.txt");
      writeFileSync(list, joinList([seg, end]));
      const out = join(dir, "out.mp4");
      expect(await runFfmpeg(joinArgs(list, out), 30_000)).toEqual({ ok: true });
      const bytes = readFileSync(out);
      // The take was only 2 s long: the segment is what it had; with the card, 3.5 s: a real ad.
      expect(renditionProblem(bytes, TINY)).toBeNull();
      const boxes = mp4TopLevelBoxes(bytes);
      expect(boxes.indexOf("moov")).toBeGreaterThan(-1);
      expect(boxes.indexOf("moov")).toBeLessThan(boxes.indexOf("mdat"));
      const info = spawnSync(ffmpegPath, ["-hide_banner", "-i", out], { encoding: "utf8" }).stderr;
      expect(info).toMatch(/Video: h264 \(High\)/);
      expect(info).toMatch(/Audio: aac \(LC\).*48000 Hz, stereo/);
      // The AI marking is in the file itself, readable by any tool (PT-R3-03).
      expect(info).toContain(`comment         : ${AI_MARK_COMMENT}`);
      expect(info).toContain("trainedAlgorithmicMedia");
      expect(bytes.includes(Buffer.from(AI_MARK_COMMENT))).toBe(true);
      expect(statSync(out).size).toBeGreaterThan(0);
    },
    60_000,
  );

  it("a failing run answers with ffmpeg's own words and never throws", async () => {
    const r = await runFfmpeg(["-v", "error", "-i", join(dir, "missing.mp4"), join(dir, "x.mp4")], 10_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it("a rendition outside 3-90 s, or not the preset's frame, is refused", async () => {
    const short = join(dir, "short.mp4");
    execFileSync(ffmpegPath, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=108x192:r=30:d=1", "-pix_fmt", "yuv420p", "-c:v", "libx264", short]);
    expect(renditionProblem(readFileSync(short), TINY)).toMatch(/outside 3-90 s/);
    expect(renditionProblem(readFileSync(short), EXPORT_PRESET)).toMatch(/not 1080x1920/);
    expect(renditionProblem(Buffer.from("not a video"), TINY)).toBe("the file couldn't be read back");
  });
});
