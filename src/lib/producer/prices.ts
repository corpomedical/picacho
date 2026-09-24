// What a Producer turn costs, and what it is charged (2026-09-24).
//
// Alias-free so it can be unit-tested, like agent/prices.ts — and it bills
// through the same ledger in the same unit (agent_usage, 2 cents), so a
// Producer turn draws on exactly the assistant allowance the plan already has.
//
// PRICES ARE DATED AND SOURCED: read from platform.claude.com/docs/en/about-
// claude/pricing on 2026-09-24. USD per 1M tokens: input, output, and the
// cache-read price (Opus 5.5 reads its cache at 0.05x input, Fable 5.1 at
// 0.025x, the rest at 0.1x). Cache writes are 1.25x input on every model.
//
// A turn is priced by the model that ANSWERED, not the one asked: a refused
// request is re-run on a fallback model inside the same call, and that one
// bills at its own rates. A model this table doesn't know is priced as the
// dearest one — the direction that can't quietly sell below cost.

export const PRODUCER_MODEL = "claude-opus-5-5";

type Rate = { input: number; output: number; cacheRead: number };

export const RATES: Record<string, Rate> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
};

const DEAREST: Rate = { input: 10, output: 50, cacheRead: 1 };
export const CACHE_WRITE_MULTIPLIER = 1.25;

export type CallUsage = {
  input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  output_tokens?: number | null;
};

export function rateFor(model: string | null | undefined): Rate {
  return (model && RATES[model]) || DEAREST;
}

/** One model call, in dollars, from the API's own usage numbers. */
export function costOfCallUsd(usage: CallUsage, model: string | null | undefined): number {
  const r = rateFor(model);
  const perM = 1_000_000;
  return (
    ((usage.input_tokens ?? 0) * r.input) / perM +
    ((usage.cache_creation_input_tokens ?? 0) * r.input * CACHE_WRITE_MULTIPLIER) / perM +
    ((usage.cache_read_input_tokens ?? 0) * r.cacheRead) / perM +
    ((usage.output_tokens ?? 0) * r.output) / perM
  );
}

// Same unit as the chat assistant, on purpose: one ledger, one allowance.
export const PRODUCER_UNIT_USD = 0.02;

export function unitsForCostUsd(costUsd: number): number {
  return Math.max(1, Math.ceil(costUsd / PRODUCER_UNIT_USD));
}

// THE RESERVATION AND THE BRAKE.
//
// A Producer turn is a loop — read the renders, look at a frame, prepare a
// send, answer — so its cost isn't known until it ends. The route reserves
// RESERVE_UNITS before the first call (the ceiling a turn may ever cost) and
// settles to the real cost after. The brake is what makes the ceiling true:
// once the calls so far have cost BRAKE_USD, no further tool round starts and
// the model is asked to answer with what it has. The worst single call after
// the brake — MAX_OUTPUT_TOKENS of output plus a large fresh input at
// Opus 5.5 rates — fits in what's left:
//
//   brake $0.50 + output 8,000 × $20/M ($0.16) + 30,000 fresh × $4/M ($0.12)
//   = $0.78, under the $0.80 reserved (40 units × $0.02).
//
// A fallback onto a dearer model can overshoot that; the settle then writes
// the real cost, which is the honest direction (the ledger shows what it cost).
export const RESERVE_UNITS = 40;
export const BRAKE_USD = 0.5;
export const MAX_OUTPUT_TOKENS = 8000;
// Tool rounds per turn. A plan for three shots is read → three prepares →
// answer, which fits with room for one look at a frame.
export const MAX_CALLS = 6;
