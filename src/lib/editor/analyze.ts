// Reading a raw clip on our side before the editor gets it: what it is
// (probe) and what is said in it (the speech track for the transcriber).
// Everything visual — frames, shot changes, the edit itself — is the
// editing agent's job in its own sandbox (agent.ts).
//
// Argument builders and a stderr parser only; work.ts runs them. Pure, so the
// suite pins the flags (the ffmpeg 6 vs 7 lesson in chain.ts: an argument list
// is a contract with a binary we do not control).

export type ProbeResult = {
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
  fps: number;
};

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

/** The speech track for the transcriber: mono 16 kHz, 32 kb/s — ten minutes is ~2.4 MB, far under its 25 MB door. */
export function speechArgs(input: string, output: string): string[] {
  return ["-hide_banner", "-nostats", "-y", "-i", input, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", output];
}
