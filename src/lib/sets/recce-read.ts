// The Recce (2026-09-17): a clip of a real place, read into what Helios
// already understands — the place for the photo builder, the one person's
// path for the marks, the light, and which sampled frame shows the place
// best. Board K of the Sets canvas; cut 1 builds the read alone.
//
// The reader is the same small model the shot words and the look's people
// reader use, and this is a READING in the same sense: frames go to it the
// way a still goes to look-people.ts, and the one frame that goes on to
// ASTRA passes the picture check first, exactly as a photo build's
// photograph does (recce-actions.ts holds that order).
//
// WHAT COMES BACK IS FIELDS, never the model's text on the page. The only
// read text that travels further is the tail recceTail composes for the
// build — and the action gates that tail as model text (provider "astra")
// before anything is sent, the way an editor edit's answer is gated.
//
// THE PERSON IN THE CLIP is never described to Astra. The read may say who
// it followed; the tail says "one person" and gives the path alone. What a
// recce keeps of the read (recce-store.ts) is for the set's own page later.
//
// Relative imports only, and client-safe: recce-client.ts shares the frame
// count and the clip bounds. Tested with a fake fetch.

import { cleanText } from "./set-spec";

/** The reader: the shot words' model (shot-words.ts names it too). */
export const RECCE_READ_MODEL = "gpt-5.4-mini";
export const RECCE_READ_TIMEOUT_MS = 45_000;
/** Frames sampled evenly across the clip — dense enough that a walk reads as one. */
export const RECCE_FRAME_COUNT = 12;
export const RECCE_FRAMES_MIN = 4;
/** The clip itself never leaves the browser; these bound what may be filmed into a read. */
export const SET_CLIP_MIN_SECONDS = 3;
export const SET_CLIP_MAX_SECONDS = 30;
const SEED = 7;

export const RECCE_HEIGHTS = ["low", "eye", "high"] as const;
export const RECCE_SIZES = ["close_up", "medium", "full", "wide"] as const;
export const RECCE_POSES = ["stand", "sit", "walk", "lean"] as const;
export const RECCE_CONFIDENCE = ["low", "medium", "high"] as const;

export type RecceShot = {
  fromS: number;
  toS: number;
  place: string;
  height: (typeof RECCE_HEIGHTS)[number];
  size: (typeof RECCE_SIZES)[number];
  /** One sentence saying what the camera really does — kept for cut 2's move. */
  cameraWords: string;
};

export type ReccePerson = {
  /** The read's own words for who it followed. Never sent to Astra. */
  who: string;
  pose: (typeof RECCE_POSES)[number];
  /** Metres from where the clip's camera stands: x to its right, z ahead of it. */
  start: { x: number; z: number };
  end: { x: number; z: number };
};

export type RecceRead = {
  shots: RecceShot[];
  person: ReccePerson | null;
  light: string;
  /** Index of the sampled frame that shows the place broadest — the photo build's frame. */
  placeFrame: number;
  confidence: (typeof RECCE_CONFIDENCE)[number];
};

/** Where each sampled frame sits in the clip, in seconds: the middle of its slice. */
export function sampleTimes(seconds: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  return Array.from({ length: n }, (_, i) => Math.round(((seconds * (i + 0.5)) / n) * 100) / 100);
}

/**
 * The reading, asked for as fields. The camera's true motion goes into one
 * plain sentence (`camera.words`): the move vocabulary is the stage's
 * business, not the reader's, and a follow the vocabulary lacks must not be
 * forced into it (the K1 probe read a follow correctly only when it was
 * allowed to say so in words).
 */
export function recceReadInstructions(times: number[], seconds: number): string {
  return `You read location footage for a film previz tool. You are given ${times.length} frames sampled from one clip of ${seconds} seconds, in order, with their timestamps.

Return ONLY a JSON object:
{
 "shots": [            // one entry per continuous shot; a hard cut starts a new one
   { "from_s": number, "to_s": number,
     "place": string,  // the location in one short sentence
     "camera": { "height": "low"|"eye"|"high", "size": "close_up"|"medium"|"full"|"wide",
                 "words": string } } // one sentence saying what the camera really does
 ],
 "person": {           // the one person the clip follows, or null if there is no one
   "who": string,
   "pose": "stand"|"sit"|"walk"|"lean",
   "start": { "x": number, "z": number },  // metres from the first shot's camera: x to its right, z ahead
   "end": { "x": number, "z": number }
 },
 "light": string,      // the light in one sentence: sources, direction, colour
 "place_frame": number, // index of the frame that shows the place broadest and clearest — a wide view, never a close-up
 "confidence": "low"|"medium"|"high"
}

Judge motion from differences between frames. First decide the cuts: if two adjacent frames cannot be one continuous camera path (the subject flips side, the whole composition and distance change at once, a close-up sits between two wide views), a cut lies between them — expect cuts in edited footage. A camera travelling with a person who stays the same size in frame while the background streams past is following them, not holding still. Estimate the person's start and end from how the place recedes around them; rough metres are fine.`;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;

/** The answer bounded into fields, or null: a shape the page never guesses at. */
export function parseRecceRead(answer: string, frameCount: number, seconds: number): RecceRead | null {
  let raw: unknown;
  try {
    raw = JSON.parse(answer);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const shotsRaw = Array.isArray(r.shots) ? r.shots.slice(0, 6) : [];
  const shots: RecceShot[] = [];
  for (const s of shotsRaw) {
    if (typeof s !== "object" || s === null) continue;
    const o = s as Record<string, unknown>;
    const cam = (typeof o.camera === "object" && o.camera !== null ? o.camera : {}) as Record<string, unknown>;
    const fromS = clamp(num(o.from_s) ?? 0, 0, seconds);
    const toS = clamp(num(o.to_s) ?? seconds, fromS, seconds);
    shots.push({
      fromS,
      toS,
      place: cleanText(typeof o.place === "string" ? o.place : "", 200),
      height: pick(cam.height, RECCE_HEIGHTS, "eye"),
      size: pick(cam.size, RECCE_SIZES, "wide"),
      cameraWords: cleanText(typeof cam.words === "string" ? cam.words : "", 240),
    });
  }
  if (shots.length === 0 || !shots[0].place) return null;

  let person: ReccePerson | null = null;
  if (typeof r.person === "object" && r.person !== null) {
    const p = r.person as Record<string, unknown>;
    const start = (typeof p.start === "object" && p.start !== null ? p.start : {}) as Record<string, unknown>;
    const end = (typeof p.end === "object" && p.end !== null ? p.end : {}) as Record<string, unknown>;
    const sx = num(start.x);
    const sz = num(start.z);
    const ex = num(end.x);
    const ez = num(end.z);
    if (sx !== null && sz !== null && ex !== null && ez !== null) {
      person = {
        who: cleanText(typeof p.who === "string" ? p.who : "", 120),
        pose: pick(p.pose, RECCE_POSES, "stand"),
        start: { x: clamp(sx, -30, 30), z: clamp(sz, 0.5, 40) },
        end: { x: clamp(ex, -30, 30), z: clamp(ez, 0.5, 40) },
      };
    }
  }

  const pf = num(r.place_frame);
  return {
    shots,
    person,
    light: cleanText(typeof r.light === "string" ? r.light : "", 240),
    placeFrame: pf === null ? 0 : clamp(Math.floor(pf), 0, Math.max(0, frameCount - 1)),
    confidence: pick(r.confidence, RECCE_CONFIDENCE, "low"),
  };
}

/** The tail may not grow past this: it rides inside the photo build's input budget. */
export const RECCE_TAIL_MAX_CHARS = 700;

const m = (v: number) => String(Math.round(v * 10) / 10);

/**
 * What the build is told about the clip, appended after the photo and the
 * notes the way a retry's feedback already is. The person is "one person",
 * never the read's description: Astra is told nothing about anyone, only
 * where the path begins and ends, so the marks land on it.
 */
export function recceTail(read: RecceRead, seconds: number): string {
  const parts: string[] = [
    `This photograph is one frame of a ${m(seconds)}-second clip filmed in this location; a machine read the whole clip.`,
    `The location, as the clip shows it: ${read.shots[0].place}`,
  ];
  if (read.light) parts.push(`The light: ${read.light}`);
  if (read.person) {
    const { pose, start, end } = read.person;
    const still = Math.abs(start.x - end.x) < 0.75 && Math.abs(start.z - end.z) < 0.75;
    const at = (p: { x: number; z: number }) =>
      `${m(Math.abs(p.x))} m to the photographer's ${p.x < 0 ? "left" : "right"} and ${m(p.z)} m ahead of them`;
    if (still) {
      parts.push(`One person ${pose === "stand" ? "stands" : pose + "s"} about ${at(start)}. Put mark 1 there.`);
    } else {
      parts.push(
        `One person moves from about ${at(start)} to about ${at(end)}. Put mark 1 where they start, facing the way they travel, and mark 2 where they end.`,
      );
    }
  }
  parts.push(`Build the whole place the clip moves through, not only what this one frame shows.`);
  return cleanText(parts.join(" "), RECCE_TAIL_MAX_CHARS);
}

/**
 * The reader call. Fail open as null — no key, a refusal, a timeout, a bad
 * status — and the action answers with its own sentence; nothing is spent.
 */
export async function askRecceRead(
  instructions: string,
  frameUrls: string[],
  times: number[],
  opts: { timeoutMs?: number; fetchFn?: typeof fetch } = {},
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[sets] recce read skipped: OPENAI_API_KEY is not set");
    return null;
  }
  const content: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "high" } })[] = [
    { type: "text", text: `Frame timestamps: ${times.join(", ")} s.` },
  ];
  frameUrls.forEach((url, i) => {
    content.push({ type: "text", text: `Frame ${i} at ${times[i]} s:` });
    content.push({ type: "image_url", image_url: { url, detail: "high" } });
  });
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), opts.timeoutMs ?? RECCE_READ_TIMEOUT_MS);
  try {
    const res = await (opts.fetchFn ?? fetch)("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: RECCE_READ_MODEL,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content },
        ],
        max_completion_tokens: 700,
        temperature: 0,
        seed: SEED,
        response_format: { type: "json_object" },
      }),
      signal: deadline.signal,
    });
    if (!res.ok) {
      console.warn(`[sets] recce read failed: ${RECCE_READ_MODEL} answered ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] } | null;
    const answer = data?.choices?.[0]?.message?.content;
    return typeof answer === "string" ? answer : null;
  } catch (err) {
    console.warn(`[sets] recce read failed: ${err instanceof Error ? err.name : "error"}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
