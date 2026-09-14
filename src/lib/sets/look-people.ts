// Where the people are in a still (Astra Sets, 2026-09-14): asked of a vision
// model, never assumed from the sketch.
//
// WHY. The look must carry nothing of a person (look-cutout.ts, NEVER THE
// PERSON), and until today the person's region was worked out from where the
// grey figure stood in the sketch. The operator's fourth race-track still
// (generation 44ed7657) showed what that misses: the sketch had the figure
// standing behind the car's middle, and GPT Image drew the person sitting on
// the track to its right, a metre and more from the mark. The region cleared
// the car's middle and left the person alone, and the cut of that still — a
// strip at the right edge, the only part of the car "clear of the person" —
// carried her arm and legs onto the grey. A figure says where a person was
// asked to stand; only the picture says where they are.
//
// HOW. The still goes to the same vision model the output gate reads
// pictures with (output-policy.ts readVision: chat completions, the picture
// inline at full detail, temperature 0, a fixed seed), asked for one thing —
// a box round every person, as fractions of the frame — in JSON with no
// free-text field, so nothing about anyone is written down. Each box is
// grown by LOOK_PEOPLE_GROW of the frame on every side, because a model's
// boxes are approximate and a hand a few pixels outside one is still a hand.
// The regions cleared are the figure's (from the sketch, as before) AND every
// box read here: whichever of them is wrong, the other stands.
//
// FAIL CLOSED. No key, a refusal, a timeout, an unreadable answer: null, and
// the shot goes without its look (look-cutout-store.ts "people unknown"). A
// look whose person could not be located is not a look worth sending. An
// answer of no people at all is an answer — the figure's region still holds.
//
// THE MONEY. One reading a cut (a still is cut once). gpt-5.4-mini with a
// 1024² picture at full detail: about 1,100 input tokens and under 100 out
// (the first reading, 2026-09-14) — well under a cent at its rates
// (admin/economics.ts quotes them).
//
// Relative imports only: tested with a fake fetch.

import type { FrameBox } from "./look-cutout";

/** The model that reads the still: the output gate's reader (scorer-version.ts DEFAULT_SCORER_MODEL). */
export const LOOK_PEOPLE_MODEL = "gpt-5.4-mini";
/** Every box the model gives grows by this share of the frame on each side. */
export const LOOK_PEOPLE_GROW = 0.05;
/** The picture and the answer, headers to body, past this and the cut is off. */
export const LOOK_PEOPLE_TIMEOUT_MS = 25_000;
/** At most this many people are read; a crowd is a crowd. */
export const LOOK_PEOPLE_MAX = 8;
const SEED = 7;

export const LOOK_PEOPLE_INSTRUCTIONS =
  "You locate people in a photograph. Answer with JSON only, of exactly this shape and nothing else: " +
  '{"people":[{"x0":0.00,"y0":0.00,"x1":0.00,"y1":0.00}]}. ' +
  "One entry for every person in the picture — any human figure, whole or partial, near or far, standing, seated or lying, " +
  "in a mirror or a poster too. x0,y0 is the top-left corner and x1,y1 the bottom-right corner of a box round the whole person, " +
  "as fractions of the picture's width and height from 0 to 1. Make each box generous: include the hair, the hands, the feet, " +
  "and anything the person holds, sits on or leans on. With no person at all, answer {\"people\":[]}. " +
  "Never name, identify or describe anyone: only the numbers.";

const frac = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
/** Inside the frame, to four decimals: the boxes are approximate, and a float's tail is nothing. */
const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10_000) / 10_000;

/** The answer's boxes, grown and clipped — or null when it is not an answer. Exported for the tests. */
export function readPeople(text: string): FrameBox[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const people = (parsed as { people?: unknown } | null)?.people;
  if (!Array.isArray(people)) return null;
  const out: FrameBox[] = [];
  for (const p of people.slice(0, LOOK_PEOPLE_MAX)) {
    const b = p as Record<string, unknown> | null;
    if (!b || !frac(b.x0) || !frac(b.y0) || !frac(b.x1) || !frac(b.y1) || b.x1 <= b.x0 || b.y1 <= b.y0) return null;
    out.push({
      u0: clamp(b.x0 - LOOK_PEOPLE_GROW),
      v0: clamp(b.y0 - LOOK_PEOPLE_GROW),
      u1: clamp(b.x1 + LOOK_PEOPLE_GROW),
      v1: clamp(b.y1 + LOOK_PEOPLE_GROW),
    });
  }
  return out;
}

/**
 * Where the people are in `still` (its bytes, of `mime`), as regions of the
 * frame grown past them — [] when the model sees none — or null when it
 * could not be asked or did not answer (the header: fail closed).
 */
export async function findPeople(still: Buffer, mime: string, opts: { timeoutMs?: number } = {}): Promise<FrameBox[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[sets] look people skipped: OPENAI_API_KEY is not set");
    return null;
  }
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), opts.timeoutMs ?? LOOK_PEOPLE_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: LOOK_PEOPLE_MODEL,
        messages: [
          { role: "system", content: LOOK_PEOPLE_INSTRUCTIONS },
          {
            role: "user",
            content: [
              { type: "text", text: "Where are the people in this picture?" },
              { type: "image_url", image_url: { url: `data:${mime};base64,${still.toString("base64")}`, detail: "high" } },
            ],
          },
        ],
        max_completion_tokens: 400,
        temperature: 0,
        seed: SEED,
      }),
      signal: deadline.signal,
    });
    if (!res.ok) {
      console.warn(`[sets] look people failed: ${LOOK_PEOPLE_MODEL} answered ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] } | null;
    const text = String(data?.choices?.[0]?.message?.content ?? "");
    const people = readPeople(text);
    if (!people) console.warn("[sets] look people failed: the answer was not boxes");
    return people;
  } catch (err) {
    console.warn(`[sets] look people failed: ${err instanceof Error ? err.name : "error"}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
