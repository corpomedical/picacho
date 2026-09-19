// THE LONG TAKE (2026-09-19): "If the video is 30s, can we make it 15+15s and
// our software would perfectly make them 30s?" Pure and alias-free — the door
// prices with it, the action plans with it, the runner joins with it, the
// tests pin it. chain-run.ts runs what this describes.
//
// No engine renders more than 15 s of a clip with a saved character in it
// (the 2026-09-19 survey of fal's 206 video-to-video engines: Kling O3 Edit
// 15 s, Happy Horse 15 s out of 60 in, Wan 2.7 10 s, SCAIL-2 10 s). So a
// longer clip is rendered in PIECES. What was measured on the operator's own
// 30 s clip before and while this was written:
//
//   1. Two pieces rendered apart never meet: each re-draws the character, so
//      the outfit, the pose and the people beside her jump at the join.
//   2. CHAINED, they do. Each later piece's input OPENS on the last second of
//      the previous piece's actual render, then carries on with the source.
//      Where that second is still, Kling re-draws it almost pixel for pixel
//      (1.6 across the picture, 2.3 on her), and a join cut there is
//      invisible (0.6–1.0x the ordinary change between two frames).
//   3. Where that second is NOT still — the first shipped chain opened a
//      piece on the performer fixing his tie — the re-draw loosens (5–6 on
//      her) and a hard cut shows her hand vanish. So the stillness a switch
//      is chosen by is measured over the WHOLE second the next piece opens
//      on, not the switch alone, and every join is a short dissolve centred
//      where the two renders agree best: invisible when they agree, a soft
//      movement when they drift.
//   4. The switch from the render to the source must fall at a still moment
//      too: mid-gesture it snapped (3.0x), at the stillest frame in reach it
//      did not (0.8x).
//   5. Kling's render is time-aligned with its input frame for frame (start,
//      middle and end all matched) but may come back a few frames SHORT of
//      it — 346→345, 133→129, 283→281 on that run, where earlier renders had
//      come back one long. So every piece but the last renders half a second
//      past its switch, and everything after a render is measured from what
//      the render actually holds, never from what it was sent.
//
// Everything below works in frames of the prepared window at CHAIN_FPS, the
// rate Kling O3 Edit delivers at, so a frame number means the same moment in
// the source, in every piece's input and in every piece's render.

export const CHAIN_FPS = 24;
/** One second of the previous piece's render opens every later piece. */
export const CHAIN_PREFIX_FRAMES = CHAIN_FPS;
/** Half a second rendered past every switch, for the frames a render may come back without. */
export const CHAIN_TAIL_FRAMES = 12;
/** Kling O3 Edit's own ceiling on a clip (3–15.05 s in its schema). */
export const CHAIN_PIECE_MAX_FRAMES = 15 * CHAIN_FPS;
/** Every piece brings at least this much new footage — and every input is over Kling's 3 s floor. */
export const CHAIN_MIN_NEW_FRAMES = 3 * CHAIN_FPS;
/** A join dissolves the two renders over this many frames (a quarter of a second). */
export const CHAIN_DISSOLVE_FRAMES = 6;
/**
 * The longest take. Three pieces hold 42 s; the product stops at 30, Genjutsu's
 * own ceiling — and a longer take also waits longer, each piece in turn.
 */
export const CHAIN_MAX_SECONDS = 30;

const SLACK = 0.05;
const FIRST_NEW_MAX = CHAIN_PIECE_MAX_FRAMES - CHAIN_TAIL_FRAMES;
const MIDDLE_NEW_MAX = CHAIN_PIECE_MAX_FRAMES - CHAIN_PREFIX_FRAMES - CHAIN_TAIL_FRAMES;
const LAST_NEW_MAX = CHAIN_PIECE_MAX_FRAMES - CHAIN_PREFIX_FRAMES;

/**
 * How many pieces a take of this length is rendered in. Counted in frames,
 * because that is what a piece holds: one piece takes the engine's 15.05 s
 * (361 frames); in a chain the first brings 348 new frames (its tail is
 * spent past the switch), a middle one 324, the last 336.
 */
export function chainPieceCount(seconds: number): number {
  const frames = Math.round(seconds * CHAIN_FPS);
  if (frames <= CHAIN_PIECE_MAX_FRAMES + 1) return 1;
  if (frames <= FIRST_NEW_MAX + LAST_NEW_MAX) return 2;
  return 2 + Math.ceil((frames - FIRST_NEW_MAX - LAST_NEW_MAX) / MIDDLE_NEW_MAX);
}

/**
 * The most seconds the provider can bill for a take of this length — what the
 * take is QUOTED and CHARGED at, so the button's number is the number charged.
 *
 * Kling bills each piece on its own length rounded up to a whole second (fal's
 * ledger, 2026-09-19: 5.0 s → 6 units, 6.0 s → 7.2, 14.99 s → 18, at 1.2 units
 * a second). Every later piece re-renders the second it opens on, and every
 * piece but the last renders its half-second tail. n ceilings over a total of
 * T seconds come to at most ceil(T) + n − 1; where the switches fall decides
 * how much of that margin is used, and the take is priced before they are
 * chosen.
 */
export function chainBilledSeconds(seconds: number): number {
  const n = chainPieceCount(seconds);
  if (n === 1) return Math.ceil(seconds - SLACK);
  const rendered = seconds + ((n - 1) * (CHAIN_PREFIX_FRAMES + CHAIN_TAIL_FRAMES)) / CHAIN_FPS;
  return Math.ceil(rendered - 1e-9) + (n - 1);
}

/** Minutes a take of this length is likely to take — about a minute a rendered second, pieces in turn. */
export function chainMinutes(seconds: number): number {
  // Measured on Kling O3 Edit Pro, 2026-09-19: 14.4 s in 718 s, 5.5 s in
  // 389 s, 12 s in 601 s, and a single 15 s in 1,182 s — and the pieces of a
  // chain cannot overlap. The re-rendered seconds are rendered too.
  const n = chainPieceCount(seconds);
  const rendered = seconds + ((n - 1) * (CHAIN_PREFIX_FRAMES + CHAIN_TAIL_FRAMES)) / CHAIN_FPS;
  return Math.max(5, Math.ceil(rendered / 5) * 5);
}

/**
 * Frame-to-frame change across a clip: for each frame, the mean absolute
 * difference from the frame before, over the middle of the picture (where the
 * person nearly always is — the edges carry the crowd, the street and the
 * camera's drift). Frame 0 has nothing before it and reads 0.
 */
export function chainMotion(gray: Uint8Array, width: number, height: number): number[] {
  const size = width * height;
  const count = Math.floor(gray.length / size);
  const x0 = Math.floor(width * 0.2);
  const x1 = Math.ceil(width * 0.8);
  const y0 = Math.floor(height * 0.1);
  const y1 = Math.ceil(height * 0.9);
  const out: number[] = [0];
  for (let f = 1; f < count; f++) {
    const a = (f - 1) * size;
    const b = f * size;
    let sum = 0;
    for (let y = y0; y < y1; y++) {
      const row = y * width;
      for (let x = x0; x < x1; x++) sum += Math.abs(gray[a + row + x] - gray[b + row + x]);
    }
    out.push(sum / ((x1 - x0) * (y1 - y0)));
  }
  return out;
}

export type ChainPlan = {
  /** The frame each later piece's NEW footage starts at — where its input switches from render to source. */
  switches: number[];
  /** Each piece's input length in frames: its opening second (not the first), its footage, its tail (not the last). */
  lengths: number[];
  /** How still the second around each switch is, against the clip's typical second (1 = typical, under 1 = stiller). */
  stillness: number[];
};

/**
 * Where to switch. Among every placement the pieces' limits allow, the one
 * whose LEAST still switch is stillest — one visible join is what a person
 * sees, so the worst is what is minimised. A switch's stillness is the change
 * across the whole second the next piece opens on and the switch itself.
 * Near-ties go to the placement whose longest piece is shortest: a 15 s piece
 * took 20 minutes where two of 10 s took 9 each.
 */
export function planChain(totalFrames: number, motion: number[]): ChainPlan | null {
  const n = chainPieceCount(totalFrames / CHAIN_FPS);
  if (n === 1) return { switches: [], lengths: [totalFrames], stillness: [] };
  if (n > 3) return null;

  // Prefix sums, so a second's change is two lookups.
  const sums = [0];
  for (let f = 0; f < totalFrames; f++) sums.push(sums[f] + (f === 0 ? 0 : (motion[f] ?? 0)));
  const secondAround = (s: number) => {
    const from = Math.max(1, s - CHAIN_PREFIX_FRAMES);
    const to = Math.min(totalFrames, s + 3);
    return sums[to] - sums[from];
  };
  const everySecond: number[] = [];
  for (let s = CHAIN_PREFIX_FRAMES; s <= totalFrames - 3; s++) everySecond.push(secondAround(s));
  everySecond.sort((a, b) => a - b);
  const typical = Math.max(1e-6, everySecond[Math.floor(everySecond.length / 2)] ?? 1);

  const lengthsOf = (switches: number[]) => {
    const edges = [0, ...switches, totalFrames];
    return edges.slice(1).map((e, i) => {
      const last = i === edges.length - 2;
      return (i === 0 ? 0 : CHAIN_PREFIX_FRAMES) + (e - edges[i]) + (last ? 0 : CHAIN_TAIL_FRAMES);
    });
  };
  const placements = function* (): Generator<number[]> {
    for (let s1 = CHAIN_MIN_NEW_FRAMES; s1 <= Math.min(FIRST_NEW_MAX, totalFrames - CHAIN_MIN_NEW_FRAMES); s1++) {
      if (n === 2) {
        const last = totalFrames - s1;
        if (last >= CHAIN_MIN_NEW_FRAMES && last <= LAST_NEW_MAX) yield [s1];
        continue;
      }
      for (let s2 = s1 + CHAIN_MIN_NEW_FRAMES; s2 <= Math.min(s1 + MIDDLE_NEW_MAX, totalFrames - CHAIN_MIN_NEW_FRAMES); s2++) {
        const last = totalFrames - s2;
        if (last >= CHAIN_MIN_NEW_FRAMES && last <= LAST_NEW_MAX) yield [s1, s2];
      }
    }
  };
  const worstOf = (switches: number[]) => Math.max(...switches.map(secondAround));

  // Pass one: how still the least still switch can possibly be.
  let floor = Number.POSITIVE_INFINITY;
  for (const p of placements()) floor = Math.min(floor, worstOf(p));
  if (!Number.isFinite(floor)) return null;
  // Pass two: within 5 % of that, the shortest longest piece; then the stillest.
  let chosen: number[] | null = null;
  let chosenLongest = Number.POSITIVE_INFINITY;
  let chosenWorst = Number.POSITIVE_INFINITY;
  for (const p of placements()) {
    const worst = worstOf(p);
    if (worst > floor * 1.05 + 1e-9) continue;
    const longest = Math.max(...lengthsOf(p));
    if (longest < chosenLongest || (longest === chosenLongest && worst < chosenWorst)) {
      chosen = p;
      chosenLongest = longest;
      chosenWorst = worst;
    }
  }
  if (!chosen) return null;
  return {
    switches: chosen,
    lengths: lengthsOf(chosen),
    stillness: chosen.map((s) => Math.round((secondAround(s) / typical) * 100) / 100),
  };
}

/**
 * Where a later piece really switches, once the render before it is back. The
 * render starts at source frame `start` and holds `frames` of them; if it came
 * back so short that it no longer reaches the planned switch, the switch moves
 * to where it ends — a hand-over one frame earlier is a lesser harm than a
 * second cut from frames that do not exist.
 */
export function chainSwitchAt(planned: number, start: number, frames: number): number {
  return Math.min(planned, start + frames);
}

/**
 * Where a join is cut. `agreement[j]` is how far the later piece's frame j
 * (inside its opening second) sits from the earlier piece's render of the
 * same moment. The join is centred on the frame where they agree best —
 * never so near either end of the second that the dissolve would reach past
 * it.
 */
export function chainJoinOffset(agreement: number[]): number {
  const half = CHAIN_DISSOLVE_FRAMES / 2;
  const lo = half + 1;
  const hi = Math.min(agreement.length - 1, CHAIN_PREFIX_FRAMES - half - 1);
  let best = lo;
  for (let j = lo; j <= hi; j++) if (agreement[j] < agreement[best] - 1e-9) best = j;
  return best;
}

/** One finished piece: the source frame its input opened on, and how many frames its render holds. */
export type ChainPiece = { start: number; frames: number };

/**
 * The take, as spans of each piece's render (in the render's own frames),
 * overlapping by the dissolve at every join; and how many frames the last
 * render's final frame must be held for, when it came back short of the end,
 * so the picture ends with the sound.
 */
export function chainJoinSpans(
  pieces: ChainPiece[],
  switches: number[],
  offsets: number[],
  totalFrames: number,
): { spans: { piece: number; from: number; to: number }[]; hold: number } {
  const half = CHAIN_DISSOLVE_FRAMES / 2;
  const cuts = switches.map((s, k) => s - CHAIN_PREFIX_FRAMES + offsets[k]);
  let hold = 0;
  const spans = pieces.map((p, k) => {
    const last = k === pieces.length - 1;
    const from = (k === 0 ? 0 : cuts[k - 1] - half) - p.start;
    let to = (last ? totalFrames : cuts[k] + half) - p.start;
    if (last && to > p.frames) {
      hold = to - p.frames;
      to = p.frames;
    }
    return { piece: k, from, to };
  });
  return { spans, hold };
}

/** The encoder's arguments for the prepared window: 24 fps, the engine's size, the source's sound. */
export function chainWindowArgs(
  input: string,
  output: string,
  window: { start: number; end: number },
  size: { width: number; height: number },
): string[] {
  return [
    "-y", "-v", "error",
    "-ss", window.start.toFixed(3), "-i", input,
    "-t", (window.end - window.start).toFixed(3),
    "-vf", `scale=${size.width}:${size.height}:flags=lanczos,fps=${CHAIN_FPS},setsar=1`,
    "-map", "0:v:0", "-map", "0:a:0?",
    ...ENCODE,
    output,
  ];
}

/** The first piece's input: the window's opening frames, as they are. */
export function chainFirstPieceArgs(window: string, output: string, frames: number): string[] {
  return [
    "-y", "-v", "error",
    "-i", window,
    "-t", (frames / CHAIN_FPS).toFixed(3), "-i", window,
    "-filter_complex", `[0:v]trim=end_frame=${frames},setpts=PTS-STARTPTS[v]`,
    "-map", "[v]", "-map", "1:a:0?",
    ...ENCODE,
    output,
  ];
}

/**
 * A later piece's input: one second of the previous piece's render (its own
 * frames from `prefixFrom`), then the window's footage from the switch
 * (`from`) up to `to` — scaled to the render's own size, because the prefix
 * IS the render. The sound is the window's over the same stretch.
 */
export function chainNextPieceArgs(input: {
  previousRender: string;
  prefixFrom: number;
  window: string;
  from: number;
  to: number;
  size: { width: number; height: number };
  output: string;
}): string[] {
  const { width, height } = input.size;
  const soundFrom = (input.from - CHAIN_PREFIX_FRAMES) / CHAIN_FPS;
  const soundFor = (input.to - input.from + CHAIN_PREFIX_FRAMES) / CHAIN_FPS;
  return [
    "-y", "-v", "error",
    "-i", input.previousRender,
    "-i", input.window,
    "-ss", soundFrom.toFixed(3), "-t", soundFor.toFixed(3), "-i", input.window,
    "-filter_complex",
    `[0:v]fps=${CHAIN_FPS},trim=start_frame=${input.prefixFrom}:end_frame=${input.prefixFrom + CHAIN_PREFIX_FRAMES},setpts=PTS-STARTPTS,scale=${width}:${height},setsar=1[pre];` +
      `[1:v]fps=${CHAIN_FPS},trim=start_frame=${input.from}:end_frame=${input.to},setpts=PTS-STARTPTS,scale=${width}:${height}:flags=lanczos,setsar=1[body];` +
      "[pre][body]concat=n=2:v=1:a=0[v]",
    "-map", "[v]", "-map", "2:a:0?",
    ...ENCODE,
    input.output,
  ];
}

/** A second of a render, small and grey, for the join. */
export function chainAgreementArgs(file: string, from: number, frames: number): string[] {
  // setpts and passthrough: trimmed frames keep their own timestamps, and a
  // raw output left to its default pads the gap from zero with copies —
  // the encoder test caught 325 frames coming back for 24.
  return [
    "-v", "error", "-i", file,
    "-vf", `fps=${CHAIN_FPS},trim=start_frame=${from}:end_frame=${from + frames},setpts=PTS-STARTPTS,scale=${AGREE_W}:${AGREE_H},format=gray`,
    "-fps_mode", "passthrough",
    "-f", "rawvideo", "-",
  ];
}

export const AGREE_W = 192;
export const AGREE_H = 108;

/**
 * The finished take: every piece's span in order at the first piece's size,
 * dissolved into the next over CHAIN_DISSOLVE_FRAMES at each join, the last
 * one's final frame held if it came back short, and the window's own sound
 * under all of it.
 */
export function chainJoinArgs(input: {
  pieces: string[];
  spans: { piece: number; from: number; to: number }[];
  hold: number;
  window: string;
  totalFrames: number;
  size: { width: number; height: number };
  output: string;
}): string[] {
  const { width, height } = input.size;
  const lastIndex = input.spans.length - 1;
  const chains = input.spans
    .map((s, i) => {
      const hold = i === lastIndex && input.hold > 0 ? `,tpad=stop=${input.hold}:stop_mode=clone` : "";
      // The rate is said AGAIN after setpts: from ffmpeg 7 setpts marks its
      // output's rate unknown (1/0), and xfade refuses to start on anything
      // but a constant rate. The 6.0 build on a Mac keeps the rate, so the
      // join ran there and failed on Vercel's newer build (2026-09-19, the
      // first two real 30 s takes: "Failed to configure output pad on
      // Parsed_xfade", Invalid argument).
      return `[${s.piece}:v]fps=${CHAIN_FPS},trim=start_frame=${s.from}:end_frame=${s.to},setpts=PTS-STARTPTS,fps=${CHAIN_FPS},scale=${width}:${height},setsar=1,format=yuv420p${hold}[v${i}]`;
    })
    .join(";");
  // Each dissolve starts where the take so far ends, less the overlap.
  const dissolve = CHAIN_DISSOLVE_FRAMES / CHAIN_FPS;
  let label = "v0";
  let ran = input.spans[0].to - input.spans[0].from;
  const fades: string[] = [];
  for (let i = 1; i <= lastIndex; i++) {
    const offset = (ran - CHAIN_DISSOLVE_FRAMES) / CHAIN_FPS;
    const out = i === lastIndex ? "v" : `x${i}`;
    fades.push(`[${label}][v${i}]xfade=transition=fade:duration=${dissolve.toFixed(6)}:offset=${offset.toFixed(6)}[${out}]`);
    label = out;
    ran += input.spans[i].to - input.spans[i].from + (i === lastIndex ? input.hold : 0) - CHAIN_DISSOLVE_FRAMES;
  }
  const graph = lastIndex === 0 ? `${chains};[v0]null[v]` : `${chains};${fades.join(";")}`;
  return [
    "-y", "-v", "error",
    ...input.pieces.flatMap((p) => ["-i", p]),
    "-t", (input.totalFrames / CHAIN_FPS).toFixed(3), "-i", input.window,
    "-filter_complex", graph,
    "-map", "[v]", "-map", `${input.pieces.length}:a:0?`,
    "-frames:v", String(input.totalFrames),
    ...ENCODE,
    input.output,
  ];
}

/** The mean absolute difference between two small grey frames. */
export function chainFrameDistance(a: Uint8Array, b: Uint8Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return n > 0 ? s / n : Number.POSITIVE_INFINITY;
}

// Quality high: the engine re-renders every frame of an input, and the join is
// what the person watches. CAPPED at 10 Mbit/s, because recast-sources refuses
// a file over 50 MB at the bucket (recast.sql) and generated-videos sits under
// the project's own limit: 30 s at the cap is about 38 MB, a 15 s piece about
// 19. faststart so playback starts before the download ends. Two encoder
// threads: x264 sizes its threads to the cores it sees, a function's share is
// one vCPU, and every extra thread holds 1080p frames in memory (measured on
// the stuck join, 2026-09-19: 303 MB at 2 threads, 607 at 8, 791 at 32).
const ENCODE = [
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-maxrate", "10M", "-bufsize", "20M", "-threads", "2",
  "-pix_fmt", "yuv420p", "-r", String(CHAIN_FPS),
  "-c:a", "aac", "-b:a", "192k",
  "-movflags", "+faststart",
];

/** The prepared window's size: the engine's floor of 720 on the short side, never more — the render is drawn at its own size anyway. */
export function chainWindowSize(clip: { width: number; height: number }): { width: number; height: number } {
  const short = Math.min(clip.width, clip.height);
  const scale = 720 / short;
  const even = (v: number) => {
    const n = Math.round(v);
    return n % 2 === 0 ? n : n + 1;
  };
  return { width: even(clip.width * scale), height: even(clip.height * scale) };
}

/** Where a take's chain keeps its working files: the inputs it sends and the renders it gets back. */
export function chainFolder(userId: string, generationId: string): string {
  return `${userId}/chain/${generationId}`;
}

/**
 * One piece's request, composed whole when the take starts — the lane that
 * started it knows its engine and its words; the runner does not, and fills
 * in only the clip, once the piece's input exists. Signed urls inside it
 * last a day, and a chain is written off long before (45 minutes a piece).
 */
export type ChainRequest = {
  endpoint: string;
  label: string;
  body: Record<string, unknown>;
  /** The body's field the piece's input url goes into. */
  clipField: string;
};

/** The placeholder a lane puts where the clip goes, so the field can be found without knowing the engine. */
export const CHAIN_CLIP_PLACEHOLDER = "chain:clip";

/**
 * The placeholder a lane puts where the STILL at the switch goes — the last
 * finished frame, bound to a later piece so it carries the take's look rather
 * than the footage's (see ChainState.look). It sits wherever the engine takes
 * its reference images, so it is found by value, not by field.
 */
export const CHAIN_LOOK_PLACEHOLDER = "chain:look";

/** The request a lane composed, with the placeholder's field named. Null when the body has no placeholder. */
export function chainRequestOf(endpoint: string, label: string, body: Record<string, unknown>): ChainRequest | null {
  const clipField = Object.keys(body).find((k) => body[k] === CHAIN_CLIP_PLACEHOLDER);
  return clipField ? { endpoint, label, body, clipField } : null;
}

/**
 * One piece's body, ready to send: its clip in the field the lane named, and
 * the still in place of every look placeholder. Without a still (the first
 * piece, or a take made before stills) the placeholder is dropped rather than
 * sent as a word — an engine given "chain:look" as an image url would fail
 * the whole piece.
 */
export function chainPieceBody(request: ChainRequest, clipUrl: string, lookUrl: string | null): Record<string, unknown> {
  const body: Record<string, unknown> = { ...request.body, [request.clipField]: clipUrl };
  for (const [key, value] of Object.entries(body)) {
    if (value === CHAIN_LOOK_PLACEHOLDER) {
      if (lookUrl) body[key] = lookUrl;
      else delete body[key];
    } else if (Array.isArray(value) && value.includes(CHAIN_LOOK_PLACEHOLDER)) {
      const filled = value.map((v) => (v === CHAIN_LOOK_PLACEHOLDER ? lookUrl : v)).filter((v): v is string => typeof v === "string");
      if (filled.length > 0) body[key] = filled;
      else delete body[key];
    }
  }
  return body;
}

/** The longest side a still is stored at — inside every engine's reference limits, small enough to send. */
export const CHAIN_STILL_MAX_PX = 1280;

/** One frame of a finished piece, as a still: the look the next piece must carry on. */
export function chainStillArgs(file: string, frame: number, output: string): string[] {
  return [
    "-y",
    "-v",
    "error",
    "-i",
    file,
    "-vf",
    `select='eq(n\\,${Math.max(0, Math.round(frame))})',scale='min(${CHAIN_STILL_MAX_PX},iw)':-2`,
    "-frames:v",
    "1",
    "-fps_mode",
    "passthrough",
    "-q:v",
    "3",
    output,
  ];
}

/**
 * What the job row carries while a take is rendered in pieces. The runner
 * (job-runner.ts) reads `index`, `lengths` and `requests` to know where it is
 * and what to send next, and records each finished piece; the files are
 * chain-run.ts's.
 */
export type ChainState = {
  v: 2;
  /** The storage bucket the window and the working files live in. */
  bucket: string;
  /** The prepared window — every piece is cut from it, and its sound is the take's. */
  window: string;
  folder: string;
  /** The window's length in frames: the take's. */
  total: number;
  /** Where each later piece switches to the footage — planned, then as it really fell. */
  switches: number[];
  /** Each piece's planned input length in frames. */
  lengths: number[];
  /** How still the second around each switch is against the clip's typical second — kept for the record. */
  stillness: number[];
  /** Every piece's request, first to last. */
  requests: ChainRequest[];
  /** The piece rendering now, from 0. */
  index: number;
  /** The source frame each piece's input opened on, as far as pieces have been made. */
  starts: number[];
  /** Each finished piece's render: where it is kept, and how many frames it really holds. */
  renders: string[];
  frames: number[];
  /**
   * WHERE THE LOOK IS KEPT (2026-09-20). Every piece after the first is sent
   * the source footage with only one second of the piece before it in front —
   * so the further a take moves from what the clip shows, the more likely a
   * later piece falls back to the footage. (The operator's Anubis take: parts
   * 1–2 built an Egyptian field, part 3 came back as the school.) The still at
   * the switch is stored here and bound to the piece as a reference, which is
   * what the engines take a look from. Images need their own bucket: the clip
   * bucket takes video only. Absent on takes from before this.
   */
  look?: { bucket: string; prefix: string };
};
