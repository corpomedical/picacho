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
// THE PEOPLE ARE ADDRESSED BY POSITION AND ACTION, AND BY ONE MARK.
//
// Until 2026-09-23 there was no mark. Everyone in the clip was named by
// where they stood and what they did and by nothing else at all — "the
// person on the left, who turns and walks out" — never by face, body, hair,
// age, skin or clothing. That is the Recce's rule (recce-read.ts), kept for
// the same reason: nothing about a real person in someone's footage travels
// onward, and what does travel is gated as model text before it is sent.
//
// It cost paid takes. A school courtyard, about forty boys in the same
// blazer, and the one man to be replaced standing among them with his back
// to the camera: all the rule let the brief say was "Person A, centre of
// frame". Forty people answered to that. The engine put the character in
// BESIDE him instead of over him, and in a second run a copy of her turned
// up where a front-row student had stood. The wording was never the whole
// story — the same day proved a load limit (one replacement per render
// holds, a lead swap plus a whole-crowd swap does not) and proved that a
// direction buried at the end of a long brief is ignored. But a brief that
// cannot point at anyone is guessing, and neither of those fixes that.
//
// So one MARK per person is now allowed, and nothing else moved. It may say
// WHAT THEY WEAR (a garment and its colour) and WHERE THEY STAND, and it is
// hard-capped here rather than trusted to the model (recastMark). Face,
// body, build, age, skin, ethnicity, hair and any name stay banned, said in
// the instructions in as many words.
//
// IT IS A PHRASE THAT COMPLETES "the person …" (round 2, the same day). The
// first shape was a bare handle — "white shirt, front of the row" — and the
// brief built "Replace white shirt, front of the row (Person A)" out of it,
// which orders a garment replaced by an engine that edits garments for a
// living. The group form was worse. So the reader is asked for the phrase
// and the brief supplies the noun: "Replace the person in the white shirt at
// the front (Person A)", "Replace every single person in the navy blazers in
// the back rows (Person B’s group)". Eight words, not six: the phrase pays
// for its own preposition and articles, and six cut the very examples above.
//
// The reader writes a mark only where something really does tell someone
// apart, and leaves it out otherwise — forty boys in one blazer have none to
// give. The brief says it only for someone a character has actually been
// cast over (recast-brief.ts's markFor), which is the one place it buys
// anything.
//
// WHAT IS ENFORCED, AND WHAT IS ONLY ASKED. The length and the commas are
// enforced here, on the way in and again on the way back through the door.
// What the mark SAYS is asked of the model and never checked: eight words
// about a face would arrive intact, so everything downstream treats a mark
// as untrusted text, exactly as it treats `where` and `does`.
//
// WHERE IT ENDS UP. In the brief for whoever is replaced — and the composed
// brief is stored on the take's row (store.ts's `brief`) and logged with the
// take, so those words sit on that row for as long as the row does. What the
// recipe has no field for is an account of the PEOPLE: no mark arrives as a
// field of its own, and none is kept for anyone nobody was cast over. Two
// things are owed: the door shows `where` and not the mark, so it is the one
// read field a person cannot correct or delete before it is sent, and
// nothing on the door tells them it is there.
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

/**
 * The mark's bound (RecastPerson.mark). The shortness is the whole point:
 * long enough for a garment, its colour and a place in the frame, too short
 * to become a description of a person. Eight words rather than the six it
 * was written with, because the mark now completes "the person …" and pays
 * for a preposition and two articles out of its own budget: "in the white
 * shirt at the front" is seven. The character bound catches the answer that
 * spends every word on something enormous.
 */
export const RECAST_MARK_MAX_WORDS = 8;
export const RECAST_MARK_MAX_CHARS = 60;

export type RecastPerson = {
  /** "A", "B", "C" — what the door's chips and the brief call them. */
  tag: string;
  /** Where in frame, in a few words. Position only. */
  where: string;
  /** What they do, in one sentence. Action only. */
  does: string;
  /**
   * The one thing that tells this person apart from the others at a glance
   * — a garment and its colour, and where they stand — written as a phrase
   * that completes "the person …": "in the white shirt at the front". Eight
   * words at most, and never a face, a body, a build, an age, skin,
   * ethnicity, hair or a name (the header says why it exists, why it stops
   * there, and that the door does not yet show it).
   *
   * Absent when the reader offered nothing usable, which is the honest
   * answer for a clip where everyone is dressed the same.
   */
  mark?: string;
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
     "many": boolean,    // true when this line is SEVERAL people (a crowd, a row, a class), not one
     "mark": string }    // OPTIONAL, at most ${RECAST_MARK_MAX_WORDS} words, finishing "the person ...": what tells this one apart at a glance — see below
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

RULES ABOUT PEOPLE. Never describe anyone's face, body, build, age, skin, ethnicity, or hair. In "where", "does" and "mark", never give anyone a name either, not even one written on screen or spoken. In "where" and "does", refer to people only by where they are in the frame and what they do: "the person on the left who raises a hand" is right, and anything about how they look is wrong. Outside "mark", clothing may appear only in "keeps", as a named object that must survive — a watch, a badge — and never as a description of the person.

"mark" is the one exception, and it is narrow. It exists so that ONE person can be pointed at when several are in shot, and it may say only two things: what they are WEARING — a garment and its colour — and WHERE they stand. Write it as a phrase that finishes the sentence "Replace the person ...", and, for a line that is several people, "Replace every single person ..." as well. "in the white shirt at the front" is right. "at the far left" is right. "in the navy blazers in the back rows" is right for a group. At most ${RECAST_MARK_MAX_WORDS} words, and no commas. "tall older man, short hair" is wrong, and so is "Mr Ahmed". Leave "mark" out entirely when nothing they wear or where they stand tells them apart from the others — an answer of "one of forty in the same blazer" helps nobody.

Judge motion from the differences between frames. A cut is where two adjacent frames cannot be one continuous camera path: the composition, the distance and the subject's side all change at once. Expect no cuts in phone footage and several in edited footage.`;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pick =<T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;

const TAGS = ["A", "B", "C", "D"];

/**
 * A mark, cut to its bound — eight words, then sixty characters — or "" when
 * there is nothing there. The words are cut first, so the bound normally
 * lands between words rather than inside one; a SINGLE word longer than the
 * whole bound has nowhere to break and is cut where it must be.
 *
 * Commas go. The mark lands in the TASK's own list of swaps ("Replace the
 * person in the white shirt (Person A) in @Video1 with @Element1, and the
 * person at the far left (Person C) with @Element2"), where a comma inside
 * one mark reads as one more thing to replace. The phrase the instructions
 * ask for needs none, so any that come back are simply dropped rather than
 * argued with.
 *
 * The bound is enforced HERE and not asked of the model, for the reason
 * every other bound in this file is: the read makes a round trip through a
 * browser, so what reaches the brief is whatever came back, not whatever was
 * requested (reboundRecastRead). Only the SHAPE is enforced that way — how
 * long it is, and what punctuation it carries. What it SAYS is asked in the
 * instructions and nothing here checks it, so a mark is untrusted text all
 * the way to the engine, like `where` and `does` before it.
 */
export function recastMark(value: unknown): string {
  const words = cleanText(value, RECAST_MARK_MAX_CHARS * 4)
    .replace(/[,;]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .slice(0, RECAST_MARK_MAX_WORDS);
  while (words.length > 1 && Array.from(words.join(" ")).length > RECAST_MARK_MAX_CHARS) words.pop();
  return cleanText(words.join(" "), RECAST_MARK_MAX_CHARS).replace(/[,;:.—-]+$/, "").trim();
}

/** The mark as a person line carries it: the key is simply absent when empty. */
const markOf = (value: unknown): { mark?: string } => {
  const mark = recastMark(value);
  return mark ? { mark } : {};
};

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
    people.push({ tag: TAGS[people.length], where, does, lead: o.lead === true, many: o.many === true, ...markOf(o.mark) });
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
      ...markOf(o.mark),
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
