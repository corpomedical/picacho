// The read (cut 2, 2026-09-18): the clip is understood before anything is
// spent. Genjutsu writes a ~600-word director's brief by machine and shows
// it to nobody; ours is read into FIELDS, shown on the door as chips you can
// change, and only then composed into the brief the engines that take one
// are given (recast-brief.ts).
//
// What it answers, in the order the door needs it:
//   who is in the clip      → a chip each: cast them, or leave them
//   what must survive       → the keep list (a caption, a logo, a watch)
//   where it happens        → the world, for the restyle job's words
//   what the performance is → the motion's own name, for the library
//   does anyone speak       → whether re-voicing it is worth offering
//   which jobs suit it      → the door greys out what will disappoint
//
// THE PEOPLE ARE NEVER DESCRIBED. A recast replaces the performer, so the
// reader is told to address them by POSITION and ACTION only — "the person
// on the left, who turns and walks out" — and never by face, body, hair,
// age, skin or clothing. That is the Recce's rule (recce-read.ts) kept for
// the same reason: nothing about a real person in someone's footage travels
// onward, and what does travel is gated as model text before it is sent.
//
// Relative imports only, and client-safe (the browser samples the frames).
// Tested with a fake fetch.

import { cleanText } from "../sets/set-spec";

/** The reader: the same small model the shot words and the Recce use. */
export const RECAST_READ_MODEL = "gpt-5.4-mini";
export const RECAST_READ_TIMEOUT_MS = 45_000;
/** Frames sampled evenly across the clip — dense enough to catch a cut. */
export const RECAST_FRAME_COUNT = 10;
export const RECAST_FRAMES_MIN = 3;
const SEED = 7;

export const RECAST_FRAMINGS = ["close_up", "medium", "full", "wide"] as const;
export const RECAST_SOUNDS = ["speech", "music", "ambient", "none"] as const;
export const RECAST_KEEP_KINDS = ["text", "logo", "accessory", "object"] as const;
export const RECAST_CONFIDENCE = ["low", "medium", "high"] as const;

export type RecastPerson = {
  /** "A", "B", "C" — what the door's chips and the brief call them. */
  tag: string;
  /** Where in frame, in a few words. Position only. */
  where: string;
  /** What they do, in one sentence. Action only. */
  does: string;
  /** True when this one carries the clip — the door casts them first. */
  lead: boolean;
  /**
   * True when this line is MANY people, not one — a crowd, a row, a class.
   * The reader judges it; nothing here looks for words like "crowd". It
   * changes what casting them means: replacing a group is every one of them,
   * which is a far bigger change than replacing a person (2026-09-20, the
   * take where one character was cast over forty students).
   */
  many: boolean;
};

export type RecastKeep = {
  what: string;
  kind: (typeof RECAST_KEEP_KINDS)[number];
};

export type RecastRead = {
  /** A short name for the performance — the motion library's title. */
  title: string;
  /** The performance in one sentence. */
  motion: string;
  /** The place, for the restyle job's words. */
  world: string;
  people: RecastPerson[];
  keeps: RecastKeep[];
  /** Cuts found, in seconds. An edited clip holds its cuts through a recast badly. */
  cuts: number[];
  framing: (typeof RECAST_FRAMINGS)[number];
  sound: (typeof RECAST_SOUNDS)[number];
  /** Head and upper body visible, unobstructed — what every engine asks for. */
  headVisible: boolean;
  confidence: (typeof RECAST_CONFIDENCE)[number];
};

/** Where each sampled frame sits in the clip, in seconds: the middle of its slice. */
export function recastSampleTimes(seconds: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  return Array.from({ length: n }, (_, i) => Math.round(((seconds * (i + 0.5)) / n) * 100) / 100);
}

export function recastReadInstructions(times: number[], seconds: number): string {
  return `You read performance footage for a tool that replaces the performer with someone else's character, keeping the acting, the timing and the camera. You are given ${times.length} frames sampled from one clip of ${seconds} seconds, in order, with their timestamps.

Return ONLY a JSON object:
{
 "title": string,        // 2-5 words naming the performance, e.g. "slow turn to camera"
 "motion": string,       // one sentence: what the performance actually is
 "world": string,        // one sentence: the place, the light, the look of it
 "people": [             // everyone visible; [] if nobody is
   { "tag": "A",         // "A", "B", "C"... in order of importance
     "where": string,    // WHERE they are: "left of frame", "centre, facing camera", "behind, walks in at 0:04"
     "does": string,     // WHAT they do: "turns and crosses her arms", "walks past and exits right"
     "lead": boolean,    // true for the one the clip is about; exactly one true
     "many": boolean }   // true when this line is SEVERAL people (a crowd, a row, a class), not one
 ],
 "keeps": [              // things that must survive a replacement, [] if none
   { "what": string,     // "a wristwatch on the left wrist", "the caption 'BEFORE' bottom centre"
     "kind": "text"|"logo"|"accessory"|"object" }
 ],
 "cuts": [number],       // seconds where the footage cuts to another shot; [] if one continuous shot
 "framing": "close_up"|"medium"|"full"|"wide",
 "sound": "speech"|"music"|"ambient"|"none",  // your best guess from mouths and setting
 "head_visible": boolean, // is a head and upper body visible and unobstructed for most of the clip
 "confidence": "low"|"medium"|"high"
}

RULES ABOUT PEOPLE. Never describe anyone's face, body, hair, age, skin, or clothing. Refer to them only by where they are in the frame and what they do. "The person on the left who raises a hand" is right; anything about how they look is wrong. Clothing may appear in "keeps" ONLY as a named object that must survive, like a watch or a badge, never as a description of the person.

Judge motion from the differences between frames. A cut is where two adjacent frames cannot be one continuous camera path: the composition, the distance and the subject's side all change at once. Expect no cuts in phone footage and several in edited footage.`;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pick =<T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;

const TAGS = ["A", "B", "C", "D"];

/** The answer bounded into fields, or null: a shape the door never guesses at. */
export function parseRecastRead(answer: string, seconds: number): RecastRead | null {
  let raw: unknown;
  try {
    raw = JSON.parse(answer);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const people: RecastPerson[] = [];
  for (const p of Array.isArray(r.people) ? r.people.slice(0, TAGS.length) : []) {
    if (typeof p !== "object" || p === null) continue;
    const o = p as Record<string, unknown>;
    const does = cleanText(typeof o.does === "string" ? o.does : "", 160);
    const where = cleanText(typeof o.where === "string" ? o.where : "", 90);
    if (!does && !where) continue;
    // The tag is ours, not the reader's: the chips, the brief and the cast
    // all key on it, so it must be A, B, C in order whatever came back.
    people.push({ tag: TAGS[people.length], where, does, lead: o.lead === true, many: o.many === true });
  }
  // Exactly one lead — the first one claimed, or the first person there.
  const leadAt = Math.max(0, people.findIndex((p) => p.lead));
  people.forEach((p, i) => {
    p.lead = i === leadAt;
  });

  const keeps: RecastKeep[] = [];
  for (const k of Array.isArray(r.keeps) ? r.keeps.slice(0, 6) : []) {
    if (typeof k !== "object" || k === null) continue;
    const o = k as Record<string, unknown>;
    const what = cleanText(typeof o.what === "string" ? o.what : "", 120);
    if (what) keeps.push({ what, kind: pick(o.kind, RECAST_KEEP_KINDS, "object") });
  }

  const cuts = (Array.isArray(r.cuts) ? r.cuts : [])
    .map((c) => num(c))
    .filter((c): c is number => c !== null && c > 0.2 && c < seconds - 0.2)
    .map((c) => Math.round(c * 10) / 10)
    .slice(0, 8)
    .sort((a, b) => a - b);

  const motion = cleanText(typeof r.motion === "string" ? r.motion : "", 220);
  if (!motion) return null;
  return {
    title: cleanText(typeof r.title === "string" ? r.title : "", 60),
    motion,
    world: cleanText(typeof r.world === "string" ? r.world : "", 220),
    people,
    keeps,
    cuts,
    framing: pick(r.framing, RECAST_FRAMINGS, "medium"),
    sound: pick(r.sound, RECAST_SOUNDS, "ambient"),
    headVisible: r.head_visible !== false,
    confidence: pick(r.confidence, RECAST_CONFIDENCE, "low"),
  };
}

/**
 * The read, come back from the door.
 *
 * The door is shown the read and can change what is ticked, so the fields
 * that compose the brief make the round trip through a browser. They are
 * therefore UNTRUSTED on the way back and are bounded again here, by the
 * same rules the model's own answer met. Nothing here decides money or who
 * is cast; the worst a forged read can do is write a brief — which is then
 * judged as text before it is sent, exactly as the model's own would be.
 */
export function reboundRecastRead(value: unknown, seconds: number): RecastRead | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  const people: RecastPerson[] = [];
  for (const p of Array.isArray(r.people) ? r.people.slice(0, TAGS.length) : []) {
    if (typeof p !== "object" || p === null) continue;
    const o = p as Record<string, unknown>;
    people.push({
      tag: TAGS[people.length],
      where: cleanText(typeof o.where === "string" ? o.where : "", 90),
      does: cleanText(typeof o.does === "string" ? o.does : "", 160),
      lead: o.lead === true,
      many: o.many === true,
    });
  }
  const keeps: RecastKeep[] = [];
  for (const k of Array.isArray(r.keeps) ? r.keeps.slice(0, 6) : []) {
    if (typeof k !== "object" || k === null) continue;
    const o = k as Record<string, unknown>;
    const what = cleanText(typeof o.what === "string" ? o.what : "", 120);
    if (what) keeps.push({ what, kind: pick(o.kind, RECAST_KEEP_KINDS, "object") });
  }
  const motion = cleanText(typeof r.motion === "string" ? r.motion : "", 220);
  if (!motion) return null;
  return {
    title: cleanText(typeof r.title === "string" ? r.title : "", 60),
    motion,
    world: cleanText(typeof r.world === "string" ? r.world : "", 220),
    people,
    keeps,
    cuts: (Array.isArray(r.cuts) ? r.cuts : [])
      .map((c) => num(c))
      .filter((c): c is number => c !== null && c > 0 && c < seconds)
      .slice(0, 8)
      .map((c) => Math.round(c * 10) / 10),
    framing: pick(r.framing, RECAST_FRAMINGS, "medium"),
    sound: pick(r.sound, RECAST_SOUNDS, "ambient"),
    headVisible: r.headVisible !== false,
    confidence: pick(r.confidence, RECAST_CONFIDENCE, "low"),
  };
}

/**
 * What the read tells the door about whether a job will disappoint — said as
 * a warning, never as a refusal: the person may know better than the reader,
 * and a wrong "no" is worse than a miss they chose.
 */
export type RecastWarning = "cuts" | "no-head" | "crowd" | "wide";

export function recastWarnings(read: RecastRead): RecastWarning[] {
  const out: RecastWarning[] = [];
  // Every engine here transfers ONE continuous performance; a cut inside the
  // clip is the failure their own users report most (media.io's list).
  if (read.cuts.length > 0) out.push("cuts");
  // Kling's schema asks for it in as many words; the others want it too.
  if (!read.headVisible) out.push("no-head");
  // Nothing on offer replaces two people in one pass. Said plainly.
  if (read.people.length > 1) out.push("crowd");
  if (read.framing === "wide") out.push("wide");
  return out;
}

/**
 * The reader call. Fail open as null — no key, a refusal, a timeout, a bad
 * status — and the door carries on without a read: the clip can still be
 * taken, it is simply not understood. Nothing is spent either way.
 */
export async function askRecastRead(
  instructions: string,
  frameUrls: string[],
  times: number[],
  opts: { timeoutMs?: number; fetchFn?: typeof fetch } = {},
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[recast] read skipped: OPENAI_API_KEY is not set");
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
  const timer = setTimeout(() => deadline.abort(), opts.timeoutMs ?? RECAST_READ_TIMEOUT_MS);
  try {
    const res = await (opts.fetchFn ?? fetch)("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: RECAST_READ_MODEL,
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
      console.warn(`[recast] read failed: ${RECAST_READ_MODEL} answered ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] } | null;
    const answer = data?.choices?.[0]?.message?.content;
    return typeof answer === "string" ? answer : null;
  } catch (err) {
    console.warn(`[recast] read failed: ${err instanceof Error ? err.name : "error"}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
