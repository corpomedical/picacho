// THE EDIT, as data (operator, 2026-09-24: "an advanced video editor that
// works with opus 5.5 and hyperframe. You enter raw footage and it does the
// job completely").
//
// Opus 5.5 does not write the video's HTML. It writes THIS: which stretch of
// which clip plays, in what order, how it is framed, what words go on screen.
// compile.ts turns it into a HyperFrames composition. Two reasons for the
// split, both learned elsewhere in this codebase:
//
//  - Every number here can be checked against the footage before a cent is
//    spent on a render. A shot that runs past the end of its clip, a title
//    that outlives the video, a cut in the middle of a word — validatePlan and
//    timeline.ts catch them in plain code, and the director is asked to fix
//    them in the same conversation.
//  - The customer's brief reaches the model. If the model wrote markup, a
//    brief could talk it into a <script> that runs in the renderer. Text in a
//    plan is always escaped on the way out, so the worst a brief can do is
//    put odd words on screen.
//
// Alias-free and pure so the suite can prove it without a network.

export type Aspect = "16:9" | "9:16" | "1:1";
export type Look = "clean" | "bold" | "cinematic";
export type CaptionStyle = "off" | "lines" | "words";
export type TextKind = "title" | "lower-third" | "callout" | "end-card";
export type Transition = "cut" | "fade";

/** One stretch of one source clip, played in order. Times are SOURCE seconds. */
export type Shot = {
  clip: number;
  from: number;
  to: number;
  /** 1 = as shot; up to MAX_ZOOM is a punch-in. */
  zoom: number;
  /** Where the frame is centred when it is cropped (reframing, punch-in): 0..1 of the source. */
  focusX: number;
  focusY: number;
  transitionIn: Transition;
  /** Gain of the clip's own sound, 0..1. */
  volume: number;
  /**
   * "cover" fills the frame (cropping what does not fit); "contain" shows the
   * whole source frame over a blurred fill of itself — for a shot whose
   * burned-in text or wide composition a crop would cut (first paid proof,
   * 2026-09-24: "SEEDANCE 2.0" cropped to "EDANCE 2" in a 9:16 cut).
   */
  fit: Fit;
};

export type Fit = "cover" | "contain";

/** Words on screen. Times are OUTPUT seconds. */
export type TextCard = {
  text: string;
  start: number;
  duration: number;
  kind: TextKind;
};

/** A clip whose sound runs under the whole edit (a song the customer uploaded). */
export type MusicBed = {
  clip: number;
  /** Where in that clip the bed starts, source seconds. */
  from: number;
  volume: number;
};

export type EditPlan = {
  /** One or two sentences: what this cut is, for the history card and the revise turn. */
  summary: string;
  aspect: Aspect;
  look: Look;
  captions: CaptionStyle;
  shots: Shot[];
  texts: TextCard[];
  music: MusicBed | null;
};

/** What the director knows about each uploaded file. */
export type ClipInfo = {
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
};

export const ASPECTS: readonly Aspect[] = ["16:9", "9:16", "1:1"];
export const LOOKS: readonly Look[] = ["clean", "bold", "cinematic"];
export const CAPTION_STYLES: readonly CaptionStyle[] = ["off", "lines", "words"];
export const TEXT_KINDS: readonly TextKind[] = ["title", "lower-third", "callout", "end-card"];

export const MIN_SHOT_SECONDS = 0.4;
/** Shortest time any words may stay on screen, and a title or end card. */
export const MIN_TEXT_SECONDS = 0.8;
export const MIN_CARD_SECONDS = 1.2;
export const MAX_OUTPUT_SECONDS = 180;
export const MAX_SHOTS = 200;
export const MAX_TEXTS = 30;
export const MAX_TEXT_CHARS = 90;
export const MAX_ZOOM = 1.5;
/** How far past a clip's end a shot may reach and be trimmed rather than refused — probe rounding. */
const END_SLACK = 0.15;

/** The canvas each aspect renders on. */
export function canvasFor(aspect: Aspect): { width: number; height: number } {
  if (aspect === "9:16") return { width: 1080, height: 1920 };
  if (aspect === "1:1") return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

export function planDuration(plan: Pick<EditPlan, "shots">): number {
  return round3(plan.shots.reduce((sum, s) => sum + (s.to - s.from), 0));
}

/**
 * The JSON Schema handed to the API as output_config.format. Structured
 * outputs guarantee the SHAPE; they do not know how long clip 2 is, so the
 * ranges are enforced by validatePlan, not here.
 */
export const EDIT_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "aspect", "look", "captions", "shots", "texts", "music"],
  properties: {
    summary: { type: "string" },
    aspect: { type: "string", enum: [...ASPECTS] },
    look: { type: "string", enum: [...LOOKS] },
    captions: { type: "string", enum: [...CAPTION_STYLES] },
    shots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["clip", "from", "to", "zoom", "focusX", "focusY", "transitionIn", "volume", "fit"],
        properties: {
          clip: { type: "integer" },
          from: { type: "number" },
          to: { type: "number" },
          zoom: { type: "number" },
          focusX: { type: "number" },
          focusY: { type: "number" },
          transitionIn: { type: "string", enum: ["cut", "fade"] },
          volume: { type: "number" },
          fit: { type: "string", enum: ["cover", "contain"] },
        },
      },
    },
    texts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "start", "duration", "kind"],
        properties: {
          text: { type: "string" },
          start: { type: "number" },
          duration: { type: "number" },
          kind: { type: "string", enum: [...TEXT_KINDS] },
        },
      },
    },
    music: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["clip", "from", "volume"],
          properties: {
            clip: { type: "integer" },
            from: { type: "number" },
            volume: { type: "number" },
          },
        },
      ],
    },
  },
} as const;

export type PlanCheck = { plan: EditPlan; errors: string[] };

/**
 * Check a plan against the footage. Small slips are repaired in place and not
 * reported (a shot 0.1 s past its clip's end, a zoom of 1.6, a title that
 * overhangs the last frame by a hair); anything that changes what the editor
 * meant is reported as an error for the director to fix, in words it can act
 * on. An empty error list means the plan can be compiled as it stands.
 */
export function validatePlan(raw: unknown, clips: ClipInfo[]): PlanCheck {
  const errors: string[] = [];
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const aspect = pick(src.aspect, ASPECTS, "16:9");
  const look = pick(src.look, LOOKS, "clean");
  const captions = pick(src.captions, CAPTION_STYLES, "off");
  const summary = typeof src.summary === "string" ? src.summary.trim().slice(0, 400) : "";

  const shots: Shot[] = [];
  const rawShots = Array.isArray(src.shots) ? src.shots : [];
  if (rawShots.length === 0) errors.push("The plan has no shots.");
  if (rawShots.length > MAX_SHOTS) errors.push(`The plan has ${rawShots.length} shots; the most is ${MAX_SHOTS}.`);
  rawShots.slice(0, MAX_SHOTS).forEach((value, i) => {
    const s = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const clip = Number(s.clip);
    const info = Number.isInteger(clip) ? clips[clip] : undefined;
    if (!info) {
      errors.push(`Shot ${i + 1} names clip ${String(s.clip)}, which does not exist (clips are 0..${clips.length - 1}).`);
      return;
    }
    if (!info.hasVideo) {
      errors.push(`Shot ${i + 1} uses clip ${clip}, which has no picture (audio only) — it can only be the music bed.`);
      return;
    }
    let from = num(s.from, 0);
    let to = num(s.to, 0);
    if (from < 0) from = 0;
    if (to > info.duration && to <= info.duration + END_SLACK) to = info.duration;
    if (to > info.duration) {
      errors.push(`Shot ${i + 1} ends at ${fmt(to)} s but clip ${clip} is only ${fmt(info.duration)} s long.`);
      return;
    }
    if (to - from < MIN_SHOT_SECONDS) {
      errors.push(`Shot ${i + 1} (clip ${clip}, ${fmt(from)}–${fmt(to)} s) is shorter than ${MIN_SHOT_SECONDS} s.`);
      return;
    }
    shots.push({
      clip,
      from: round3(from),
      to: round3(to),
      zoom: clamp(num(s.zoom, 1), 1, MAX_ZOOM),
      focusX: clamp(num(s.focusX, 0.5), 0, 1),
      focusY: clamp(num(s.focusY, 0.5), 0, 1),
      transitionIn: s.transitionIn === "fade" ? "fade" : "cut",
      fit: s.fit === "contain" ? "contain" : "cover",
      volume: clamp(num(s.volume, 1), 0, 1),
    });
  });

  const total = planDuration({ shots });
  if (total > MAX_OUTPUT_SECONDS) {
    errors.push(`The edit runs ${fmt(total)} s; the longest allowed is ${MAX_OUTPUT_SECONDS} s.`);
  }

  const texts: TextCard[] = [];
  const rawTexts = Array.isArray(src.texts) ? src.texts : [];
  if (rawTexts.length > MAX_TEXTS) errors.push(`The plan has ${rawTexts.length} text cards; the most is ${MAX_TEXTS}.`);
  rawTexts.slice(0, MAX_TEXTS).forEach((value, i) => {
    const t = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const text = typeof t.text === "string" ? t.text.replace(/\s+/g, " ").trim() : "";
    if (!text) return;
    if (text.length > MAX_TEXT_CHARS) {
      errors.push(`Text card ${i + 1} is ${text.length} characters; keep on-screen words under ${MAX_TEXT_CHARS}.`);
      return;
    }
    const start = Math.max(0, num(t.start, 0));
    let duration = num(t.duration, 0);
    if (start >= total) {
      errors.push(`Text card ${i + 1} ("${text}") starts at ${fmt(start)} s, after the edit ends at ${fmt(total)} s.`);
      return;
    }
    if (start + duration > total) duration = total - start;
    const kind = pick(t.kind, TEXT_KINDS, "callout");
    // A title or end card has to be READ, not glimpsed (first paid proof,
    // 2026-09-24: a 0.75 s "Picacho" end card that was gone before it landed).
    const least = kind === "title" || kind === "end-card" ? MIN_CARD_SECONDS : MIN_TEXT_SECONDS;
    if (duration < least) {
      errors.push(
        `Text card ${i + 1} ("${text}", ${kind}) is on screen for ${fmt(duration)} s; give it at least ${least} s — ` +
          `start it earlier, or lengthen the shots under it.`,
      );
      return;
    }
    texts.push({ text, start: round3(start), duration: round3(duration), kind });
  });

  let music: MusicBed | null = null;
  if (src.music && typeof src.music === "object") {
    const m = src.music as Record<string, unknown>;
    const clip = Number(m.clip);
    const info = Number.isInteger(clip) ? clips[clip] : undefined;
    if (!info || !info.hasAudio) {
      errors.push(`The music bed names clip ${String(m.clip)}, which has no sound.`);
    } else {
      const from = clamp(num(m.from, 0), 0, Math.max(0, info.duration - 1));
      music = { clip, from: round3(from), volume: clamp(num(m.volume, 0.3), 0, 1) };
    }
  }

  return { plan: { summary, aspect, look, captions, shots, texts, music }, errors };
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}
