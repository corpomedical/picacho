// What the live check may spend, from prices.json, and how each call is
// reserved and settled (Helios Cut 2, step 13, 2026-09-25 — operator: "Run,
// keep going."; memory "money numbers from source": never a price from
// recall, the arithmetic shown).
//
// THE PRICE is prices.json, read from the model's own page with its date.
// A live run refuses a price older than PRICE_MAX_AGE_DAYS: the owner
// re-reads developers.openai.com/api/docs/models/gpt-5.4-mini and writes
// the date before he runs it (spec §7.4 precondition 4).
//
// A CALL'S WORST CASE, reserved before it is sent: every input character a
// token's worth of CHARS_PER_TOKEN_WORST (there is no tokenizer here; the
// spec measured 3.5–4 characters a token on these blocks, so 2.5 is well
// on the safe side), none of it cached, at the input price; plus the whole
// answer cap at the output price — hidden reasoning counts against that
// cap, so the cap is the most a call can bill (spec §2.1). Settled from
// the usage the answer reports: uncached input, cached input and output,
// each at its own price. No usage back from a call that went out: booked at
// its worst.
//
// Pure.

import type { ReaderUsage } from "../../../src/lib/sets/shot-words.ts";

export type Prices = {
  model: string;
  /** US dollars per 1M tokens. */
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
  /** YYYY-MM-DD, the day the page was read. */
  read: string;
  source: string;
};

export const PRICE_MAX_AGE_DAYS = 7;
export const CHARS_PER_TOKEN_WORST = 2.5;
/** v1's answer cap (shot-words.ts askShotWords sends 400); the fence refuses a v1 call that asks for more. */
export const V1_MAX_COMPLETION = 400;
/** The typical reading, for the plan's estimate only: 4 characters a token in, nothing cached, 90 tokens out (spec §2.1: 40–90 visible). */
export const TYPICAL = { charsPerToken: 4, output: 90 } as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Why these prices can't be used for a live run on `today`; empty when they can. */
export function priceProblems(p: Prices, model: string, today: Date): string[] {
  const out: string[] = [];
  if (p.model !== model) out.push(`prices.json is for ${p.model}; the reader is ${model}`);
  for (const k of ["inputPer1M", "cachedInputPer1M", "outputPer1M"] as const) if (!(typeof p[k] === "number" && Number.isFinite(p[k]) && p[k] > 0)) out.push(`prices.json ${k} is not a price`);
  const read = Date.parse(`${p.read}T00:00:00Z`);
  if (!Number.isFinite(read)) out.push(`prices.json read date "${p.read}" is not a date`);
  else {
    const age = Math.floor((Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - read) / DAY_MS);
    if (age > PRICE_MAX_AGE_DAYS) out.push(`the prices were read ${age} days ago (${p.read}); re-read ${p.source} and write today's date (at most ${PRICE_MAX_AGE_DAYS} days)`);
    if (age < 0) out.push(`prices.json is dated ${p.read}, after today`);
  }
  return out;
}

/** Characters in the messages one call sends. */
export const charsOf = (messages: readonly { content: string }[]): number => messages.reduce((n, m) => n + Array.from(m.content).length, 0);

/** The most one call can cost: its input as if uncached at CHARS_PER_TOKEN_WORST, and its whole answer cap. */
export function worstUsd(chars: number, cap: number, p: Prices): number {
  return (Math.ceil(chars / CHARS_PER_TOKEN_WORST) * p.inputPer1M + cap * p.outputPer1M) / 1_000_000;
}

/** The plan's estimate of a typical call (not a reservation). */
export function typicalUsd(chars: number, p: Prices): number {
  return (Math.ceil(chars / TYPICAL.charsPerToken) * p.inputPer1M + TYPICAL.output * p.outputPer1M) / 1_000_000;
}

/** What a call cost, from its reported usage; null when it reported none. */
export function actualUsd(u: ReaderUsage | null, p: Prices): number | null {
  if (!u || u.prompt === null || u.completion === null) return null;
  const cached = Math.min(u.cached ?? 0, u.prompt);
  return ((u.prompt - cached) * p.inputPer1M + cached * p.cachedInputPer1M + u.completion * p.outputPer1M) / 1_000_000;
}

export const usd = (n: number, digits = 4): string => `$${n.toFixed(digits)}`;
