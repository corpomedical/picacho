// Turning a raw clip into something Opus can read.
//
// Claude sees pictures and text; it does not watch video or hear audio. So
// each clip is decoded ONCE by ffmpeg into four things at the same time:
//
//  - contact sheets: a small frame every `interval` seconds, tiled
//    SHEET_COLS × SHEET_ROWS to a sheet, so the director can see every
//    moment of the footage for a few thousand tokens a sheet;
//  - shot changes (scene detection on the small frames);
//  - silences (the pauses a talking-head recut lives on);
//  - the speech track, mono 16 kHz at 32 kb/s, for the transcript — ten
//    minutes is about 2.4 MB, far under the transcriber's 25 MB door.
//
// Argument builders and stderr parsers only; running them is analyze-run.ts's
// job. Pure, so the suite pins the flags that matter (the ffmpeg 6 vs 7
// lesson in chain.ts: an argument list is a contract with a binary we do not
// control, and the Mac and Vercel builds differ).

export const SHEET_COLS = 5;
export const SHEET_ROWS = 4;
export const TILES_PER_SHEET = SHEET_COLS * SHEET_ROWS;
/** Longest edge of one tile, px. 5 × 300 = 1500 px wide sheets stay under the image downscale threshold. */
export const TILE_EDGE = 300;
/** At most this many tiles per clip; longer footage gets a wider interval instead of more sheets. */
export const MAX_TILES_PER_CLIP = 600;
export const SCENE_THRESHOLD = 0.32;
export const SILENCE_DB = -35;
export const SILENCE_MIN_SECONDS = 0.35;

export type ProbeResult = {
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
  fps: number;
};

export type Silence = { start: number; end: number };

/** Seconds between contact-sheet frames for a clip of this length. */
export function sheetInterval(duration: number): number {
  if (!(duration > 0)) return 1;
  return Math.max(1, Math.ceil(duration / MAX_TILES_PER_CLIP));
}

/**
 * Across ALL of a job's clips, at most this many sheets go to the director
 * (each is ~1.5k image tokens; 60 ≈ 90k tokens ≈ $0.36 of Opus 5.5 input on
 * the first turn, re-read from cache after that).
 */
export const MAX_SHEETS_TOTAL = 60;

/** The interval for one clip when the whole job's footage shares the sheet budget. */
export function sheetIntervalFor(duration: number, totalVideoSeconds: number): number {
  const shared = Math.ceil(totalVideoSeconds / (MAX_SHEETS_TOTAL * TILES_PER_SHEET));
  return Math.max(sheetInterval(duration), shared, 1);
}

/** The source time a tile shows: sheet `sheet`, tile `tile` (row-major). */
export function tileTime(sheet: number, tile: number, interval: number): number {
  return (sheet * TILES_PER_SHEET + tile) * interval;
}

/** `ffmpeg -i file` with no output: the stream list lands on stderr for parseProbe. */
export function probeArgs(input: string): string[] {
  return ["-hide_banner", "-i", input];
}

/**
 * Read duration, picture size, frame rate and which streams exist from
 * ffmpeg's banner. There is no ffprobe in the function bundle, and ffmpeg
 * prints the same facts. Rotation (phone footage) is honoured: a 1920×1080
 * stream with a 90° display matrix is a 1080×1920 picture.
 */
export function parseProbe(stderr: string): ProbeResult {
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
  const videoLine = stderr.split("\n").find((l) => /Stream #\d+:\d+.*: Video:/.test(l) && !/attached pic/.test(l));
  const audioLine = stderr.split("\n").find((l) => /Stream #\d+:\d+.*: Audio:/.test(l));
  let width = 0;
  let height = 0;
  let fps = 0;
  if (videoLine) {
    const size = /,\s*(\d{2,5})x(\d{2,5})[\s,[]/.exec(videoLine);
    if (size) {
      width = Number(size[1]);
      height = Number(size[2]);
    }
    const rate = /,\s*(\d+(?:\.\d+)?)\s*fps/.exec(videoLine);
    if (rate) fps = Number(rate[1]);
    const rotation = /rotation of (-?\d+(?:\.\d+)?) degrees|rotate\s*:\s*(-?\d+)/.exec(stderr);
    const deg = rotation ? Math.abs(Number(rotation[1] ?? rotation[2])) % 180 : 0;
    if (deg === 90) [width, height] = [height, width];
  }
  return { duration, hasVideo: Boolean(videoLine), hasAudio: Boolean(audioLine), width, height, fps };
}

/**
 * The one decode. Outputs, in order: contact sheets as `<sheetPattern>`
 * (e.g. /tmp/x/sheet-%03d.jpg), then — when the clip has sound — the speech
 * track to `audioOut` and a silence scan to null. Shot changes and silences
 * arrive on stderr for parseSceneChanges / parseSilences.
 */
export function analyzeArgs(
  input: string,
  opts: { interval: number; hasVideo: boolean; hasAudio: boolean; sheetPattern: string; audioOut: string },
): string[] {
  const args = ["-hide_banner", "-nostats", "-y", "-i", input];
  if (opts.hasVideo) {
    const fit = `scale='if(gt(iw,ih),${TILE_EDGE},-2)':'if(gt(iw,ih),-2,${TILE_EDGE})'`;
    const graph = [
      `[0:v]${fit},split=2[forscene][forsheet]`,
      `[forscene]select='gt(scene,${SCENE_THRESHOLD})',showinfo[scene]`,
      `[forsheet]fps=1/${opts.interval}:round=down,tile=${SHEET_COLS}x${SHEET_ROWS}:padding=4:color=black[sheet]`,
    ].join(";");
    args.push("-filter_complex", graph);
    args.push("-map", "[scene]", "-f", "null", "-");
    args.push("-map", "[sheet]", "-fps_mode", "passthrough", "-q:v", "4", opts.sheetPattern);
  }
  if (opts.hasAudio) {
    args.push("-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", opts.audioOut);
    args.push("-map", "0:a:0", "-vn", "-af", `silencedetect=noise=${SILENCE_DB}dB:d=${SILENCE_MIN_SECONDS}`, "-f", "null", "-");
  }
  return args;
}

/** Shot-change times from showinfo's `pts_time:` lines. */
export function parseSceneChanges(stderr: string): number[] {
  const out: number[] = [];
  for (const line of stderr.split("\n")) {
    if (!line.includes("Parsed_showinfo")) continue;
    const m = /pts_time:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (m) out.push(Math.round(Number(m[1]) * 100) / 100);
  }
  return out;
}

/** Pauses from silencedetect. A silence still open at the end of the clip closes at `duration`. */
export function parseSilences(stderr: string, duration: number): Silence[] {
  const out: Silence[] = [];
  let open: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (s) {
      open = Math.max(0, Number(s[1]));
      continue;
    }
    const e = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (e && open !== null) {
      out.push({ start: round2(open), end: round2(Number(e[1])) });
      open = null;
    }
  }
  if (open !== null && duration > open) out.push({ start: round2(open), end: round2(duration) });
  return out;
}

/**
 * Cut one shot out of a clip for the render bundle: re-encoded (frame-exact,
 * unlike a stream copy that snaps to keyframes), capped to the canvas's long
 * edge, with `pad` seconds of handle either side so the renderer never seeks
 * to the file's very first or last frame.
 */
export function segmentArgs(
  input: string,
  output: string,
  opts: { from: number; to: number; pad: number; maxEdge: number; hasAudio: boolean },
): { args: string[]; mediaStart: number } {
  const start = Math.max(0, opts.from - opts.pad);
  const length = opts.to + opts.pad - start;
  const fit = `scale='if(gt(iw,ih),min(${opts.maxEdge},iw),-2)':'if(gt(iw,ih),-2,min(${opts.maxEdge},ih))'`;
  const args = [
    "-hide_banner", "-nostats", "-y",
    "-ss", start.toFixed(3), "-i", input, "-t", length.toFixed(3),
    "-map", "0:v:0", "-vf", `${fit},format=yuv420p`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "30",
  ];
  if (opts.hasAudio) args.push("-map", "0:a:0", "-c:a", "aac", "-b:a", "160k", "-ac", "2");
  args.push("-movflags", "+faststart", output);
  return { args, mediaStart: Math.round((opts.from - start) * 1000) / 1000 };
}

/** The music bed, trimmed to what the edit uses (plus a tail for the fade). */
export function musicArgs(input: string, output: string, opts: { from: number; length: number }): string[] {
  return [
    "-hide_banner", "-nostats", "-y",
    "-ss", Math.max(0, opts.from).toFixed(3), "-i", input, "-t", (opts.length + 2).toFixed(3),
    "-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "192k", "-ac", "2", output,
  ];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
