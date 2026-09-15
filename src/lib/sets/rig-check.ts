// The rig check (Helios Cinema, 2026-09-15, canvas page I): after a still
// lands, every look the rig asked for in words — light, focus, palette,
// film stock, lens, era — is read back from the PICTURE and marked landed
// or missed, with the evidence. Cinema Studio's 4.0 reviewers watched
// genre, era, lens, palette and lighting do nothing to the video and never
// be told; here nothing fails silently. What the stage holds (the frame's
// shape, the lens's field of view, where the camera stands) is listed as
// held and not asked about.
//
// HOW. The still goes to the vision model the output gate and the people
// finder read pictures with (look-people.ts: chat completions, the picture
// inline at full detail, temperature 0, a fixed seed), with each look as
// the very words the shot sent. The model judges what the picture SHOWS —
// the operator's standard for every reader here: meaning, never matching
// words — and a look that is only faintly there did not land. It describes
// light, focus, colour, grain and lens traits only: never anyone's face,
// body, age or identity.
//
// FAIL OPEN, QUIETLY. No key, a refusal, a timeout, an unreadable answer:
// null, and the page says the check could not read the still. A check is
// never a gate: the still is kept and charged as it always was.
//
// THE MONEY. One reading a still, stored with it (location_set_shots.
// rig_check), so a page load never asks again. gpt-5.4-mini with a 1024-px
// picture at full detail reads about 1,100 input tokens (look-people.ts,
// measured) plus a few hundred of words, and answers in under 200 — well
// under a cent at its rates (admin/economics.ts quotes them). Included in
// the still's one credit.
//
// Relative imports only: tested with a fake fetch.

import { isRigCheckItem, type RigCheckItem } from "./rig";
import { cleanText } from "./set-spec";

export const RIG_CHECK_MODEL = "gpt-5.4-mini";
export const RIG_CHECK_TIMEOUT_MS = 30_000;
/** An evidence line is one short sentence; anything longer is cut here. */
export const RIG_CHECK_EVIDENCE_MAX = 120;
const SEED = 11;

export type RigCheckAsk = { item: RigCheckItem; words: string };
export type RigCheckVerdict = { item: RigCheckItem; landed: boolean; evidence: string };
export type RigCheck = { checkedAt: string; verdicts: RigCheckVerdict[] };

const LANGUAGE: Record<string, string> = { en: "English", es: "Spanish", pt: "Portuguese", it: "Italian" };

export function rigCheckInstructions(locale: string): string {
  const language = LANGUAGE[locale] ?? "English";
  return (
    "You are a cinematographer checking a finished still against the look it was asked for. " +
    "For each look listed, decide from the picture alone whether it clearly shows that look. " +
    "Judge what the picture actually shows, never what it was meant to show; a look that is only faintly there did not land. " +
    'Answer with JSON only, of exactly this shape and nothing else: {"checks":[{"item":"light","landed":true,"evidence":"…"}]} — ' +
    "one entry per look, in the order given, with the same item names. " +
    `"evidence" is one short sentence, under twelve words, in ${language}, naming what you see in the picture that decides it. ` +
    "Describe only light, focus, colour, grain and lens traits. Never describe anyone's face, body, age, clothing or identity; " +
    "refer to a person only as the person."
  );
}

export function rigCheckQuestion(asks: readonly RigCheckAsk[]): string {
  return ["The looks this still was asked for:", ...asks.map((a) => `- ${a.item}: ${a.words}`)].join("\n");
}

const clean = (s: string) => cleanText(s, RIG_CHECK_EVIDENCE_MAX);

/**
 * The model's answer, held to the looks that were asked: one verdict per
 * asked item, in the asked order, every other entry ignored. Null when it is
 * not an answer or leaves an asked look out. Exported for the tests.
 */
export function readRigCheck(text: string, asked: readonly RigCheckItem[]): RigCheckVerdict[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const checks = (parsed as { checks?: unknown } | null)?.checks;
  if (!Array.isArray(checks)) return null;
  const found = new Map<RigCheckItem, RigCheckVerdict>();
  for (const c of checks) {
    const v = c as Record<string, unknown> | null;
    if (!v || !isRigCheckItem(v.item) || typeof v.landed !== "boolean") continue;
    if (found.has(v.item)) continue;
    found.set(v.item, { item: v.item, landed: v.landed, evidence: clean(typeof v.evidence === "string" ? v.evidence : "") });
  }
  const out: RigCheckVerdict[] = [];
  for (const item of asked) {
    const verdict = found.get(item);
    if (!verdict) return null;
    out.push(verdict);
  }
  return out;
}

/** A stored check through one door: its verdicts, each a known item with a verdict — or null. */
export function normaliseRigCheck(v: unknown): RigCheck | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.verdicts)) return null;
  const verdicts: RigCheckVerdict[] = [];
  for (const x of r.verdicts) {
    const e = x as Record<string, unknown> | null;
    if (!e || !isRigCheckItem(e.item) || typeof e.landed !== "boolean") continue;
    verdicts.push({ item: e.item, landed: e.landed, evidence: clean(typeof e.evidence === "string" ? e.evidence : "") });
  }
  if (verdicts.length === 0) return null;
  return { checkedAt: typeof r.checkedAt === "string" ? r.checkedAt : "", verdicts };
}

/**
 * Read `still` (its bytes, of `mime`) against `asks`. Null when it could not
 * be asked or did not answer (the header: fail open, quietly).
 */
export async function checkRig(
  still: Buffer,
  mime: string,
  asks: readonly RigCheckAsk[],
  locale: string,
  opts: { timeoutMs?: number } = {},
): Promise<RigCheckVerdict[] | null> {
  if (asks.length === 0) return [];
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[sets] rig check skipped: OPENAI_API_KEY is not set");
    return null;
  }
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), opts.timeoutMs ?? RIG_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: RIG_CHECK_MODEL,
        messages: [
          { role: "system", content: rigCheckInstructions(locale) },
          {
            role: "user",
            content: [
              { type: "text", text: rigCheckQuestion(asks) },
              { type: "image_url", image_url: { url: `data:${mime};base64,${still.toString("base64")}`, detail: "high" } },
            ],
          },
        ],
        max_completion_tokens: 600,
        temperature: 0,
        seed: SEED,
      }),
      signal: deadline.signal,
    });
    if (!res.ok) {
      console.warn(`[sets] rig check failed: ${RIG_CHECK_MODEL} answered ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[]; usage?: unknown } | null;
    if (data?.usage) console.info("[sets] rig check usage", data.usage);
    const verdicts = readRigCheck(String(data?.choices?.[0]?.message?.content ?? ""), asks.map((a) => a.item));
    if (!verdicts) console.warn("[sets] rig check failed: the answer was not verdicts");
    return verdicts;
  } catch (err) {
    console.warn(`[sets] rig check failed: ${err instanceof Error ? err.name : "error"}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
