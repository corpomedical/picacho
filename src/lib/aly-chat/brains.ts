// The brains Aly's chat page can answer with, what each costs, and how a
// turn is charged (2026-09-29, operator: "Claude + GPT + Gemini").
//
// Alias-free (relative imports only) so it is unit-tested directly.
//
// PRICES ARE DATED AND SOURCED, read on 2026-09-29, USD per 1M tokens
// (input / cached input / output):
//
//   Claude Sonnet 5   2.00 / 0.20  / 10.00   platform.claude.com pricing (via
//   Claude Opus 5.5   4.00 / 0.20  / 20.00   lib/producer/prices.ts RATES)
//   Claude Haiku 4.5  1.00 / 0.10  /  5.00   (titles only)
//   GPT-6 Sol         2.00 / 0.20  / 10.00   developers.openai.com/api/docs/pricing
//   Gemini 3.8 Flash  0.75 / 0.075 /  3.75   ai.google.dev/gemini-api/docs/pricing
//
// GPT-6 Luna and GPT-6 Sol, read 2026-10-01 on
// developers.openai.com/api/docs/pricing (Standard), the rows under "Short
// context input | Short context cached input | Short context cache writes |
// Short context output | Long context input | …":
//   "| gpt-6-luna | $0.10 | $0.01 | $0.125 | $0.50 | $0.20 | $0.02 | $0.25 | $0.75 |"
//   "| gpt-6-sol | $2.00 | $0.20 | $2.50 | $10.00 | $4.00 | $0.40 | $5.00 | $15.00 |"
//   "Short context: ≤272K input tokens. Long context: >272K input tokens."
// and the prompt-caching guide: "For GPT-5.6 and later, cache writes cost
// 1.25× the standard, uncached input-token rate." Sol was priced here with
// free writes until 2026-10-01, a little under what OpenAI charges.
//
// Cache WRITES are 1.25x input on Claude and on GPT-6 (the prefix is written
// once, then read at the cached price). Google caches automatically and
// doesn't charge for the write. Reasoning ("thinking") tokens are billed as
// output everywhere, and every brain reports them inside its output count.
//
// "Think harder" keeps the brain and gives it more thinking, except Claude,
// which moves up from Sonnet 5 to Opus 5.5 (operator's pick in the draft).
//
// LUNA IS THE EVERYDAY BRAIN (2026-10-01, operator: "Adopt the round 2
// table", whose everyday chat allowance is costed at $0.0006 a message on
// GPT-6 Luna). New chats answer on GPT-6 Luna with all of Aly's tools
// (luna.ts), labelled as such; "Think harder" on it answers on Claude Opus
// 5.5 (routeBrain); Claude, GPT and Gemini stay in the menu. A blind vote on
// 20 of Aly's turns that day put Luna at 97.8% of Sonnet 5's score at about
// a twentieth of the cost.

export type Brain = "luna" | "claude" | "gpt" | "gemini";
export type BrainChoice = Brain | "all";
/** "Ask all three": the three brains side by side (Luna answers alone). */
export const BRAINS: readonly Brain[] = ["claude", "gpt", "gemini"] as const;
/** Where a chat starts, and what a free account's "all" becomes. */
export const EVERYDAY_BRAIN: Brain = "luna";

export function isBrain(value: unknown): value is Brain {
  return value === "luna" || value === "claude" || value === "gpt" || value === "gemini";
}

export function isBrainChoice(value: unknown): value is BrainChoice {
  return isBrain(value) || value === "all";
}

export const CLAUDE_MODEL = "claude-sonnet-5";
export const CLAUDE_HARDER_MODEL = "claude-opus-5-5";
export const GPT_MODEL = "gpt-6-sol";
export const GEMINI_MODEL = "gemini-3.8-flash";
export const LUNA_MODEL = "gpt-6-luna";
// A new chat's title (2026-10-01): Haiku 4.5 enters its retirement window
// from 2026-10-15 ("Not sooner than October 15, 2026", Anthropic's model
// deprecations page), so titles are named by Luna with no reasoning.
export const TITLE_MODEL = LUNA_MODEL;

export const BRAIN_LABEL: Record<Brain, string> = {
  luna: "Luna",
  claude: "Claude",
  gpt: "GPT",
  gemini: "Gemini",
};

/** The model a brain answers with. "Think harder" on Luna is Claude Opus 5.5 (routeBrain sends it to Claude). */
export function modelFor(brain: Brain, harder: boolean): string {
  if (brain === "luna") return harder ? CLAUDE_HARDER_MODEL : LUNA_MODEL;
  if (brain === "claude") return harder ? CLAUDE_HARDER_MODEL : CLAUDE_MODEL;
  if (brain === "gpt") return GPT_MODEL;
  return GEMINI_MODEL;
}

/**
 * Where a message really goes. A free account (limited) has no Think harder
 * and no Ask all three: "all" becomes the everyday brain. Think harder on
 * Luna answers on Claude Opus 5.5, with Claude's lane (operator, 2026-10-01:
 * "Think harder" stays Opus 5.5). The page and the route both use it, so the
 * answer arrives in the lane the page is waiting on.
 */
export function routeBrain(choice: BrainChoice, harder: boolean, limited: boolean): { choice: BrainChoice; harder: boolean } {
  if (limited) return { choice: choice === "all" ? EVERYDAY_BRAIN : choice, harder: false };
  if (choice === "luna" && harder) return { choice: "claude", harder: true };
  return { choice, harder };
}

/** What people see under an answer: "GPT-6 Luna", "Claude Sonnet 5"… */
export function modelLabel(model: string): string {
  switch (model) {
    case LUNA_MODEL:
      return "GPT-6 Luna";
    case CLAUDE_MODEL:
      return "Claude Sonnet 5";
    case CLAUDE_HARDER_MODEL:
      return "Claude Opus 5.5";
    case GPT_MODEL:
      return "GPT-6 Sol";
    case GEMINI_MODEL:
      return "Gemini 3.8 Flash";
    default:
      return model;
  }
}

type BaseRate = { input: number; cachedInput: number; output: number; cacheWrite: number };
/** `long` applies to the whole call once its input passes `longAbove` tokens (OpenAI's long context). */
type Rate = BaseRate & { longAbove?: number; long?: BaseRate };

export const RATES: Record<string, Rate> = {
  "claude-sonnet-5": { input: 2, cachedInput: 0.2, output: 10, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, cachedInput: 0.2, output: 20, cacheWrite: 5 },
  "claude-haiku-4-5": { input: 1, cachedInput: 0.1, output: 5, cacheWrite: 1.25 },
  "gpt-6-sol": { input: 2, cachedInput: 0.2, output: 10, cacheWrite: 2.5, longAbove: 272_000, long: { input: 4, cachedInput: 0.4, output: 15, cacheWrite: 5 } },
  "gemini-3.8-flash": { input: 0.75, cachedInput: 0.075, output: 3.75, cacheWrite: 0.75 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5, cacheWrite: 0.125, longAbove: 272_000, long: { input: 0.2, cachedInput: 0.02, output: 0.75, cacheWrite: 0.25 } },
};

// A model this table doesn't know (a fallback the API chose) is priced as the
// dearest one we know of, Fable 5.1 — the direction that can't sell below cost.
const DEAREST: Rate = { input: 10, cachedInput: 1, output: 50, cacheWrite: 12.5 };

export function rateFor(model: string | null | undefined): Rate {
  return (model && RATES[model]) || DEAREST;
}

/**
 * One model call's usage, normalised: `input` is fresh (uncached) input,
 * `cached` read from cache, `cacheWrite` written to it, `output` includes
 * any thinking.
 */
export type Usage = { input: number; cached: number; cacheWrite: number; output: number };

export const NO_USAGE: Usage = { input: 0, cached: 0, cacheWrite: 0, output: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    cached: a.cached + b.cached,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  };
}

export function costUsd(usage: Usage, model: string | null | undefined): number {
  const base = rateFor(model);
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  const inputTotal = n(usage.input) + n(usage.cached) + n(usage.cacheWrite);
  const r = base.long && base.longAbove !== undefined && inputTotal > base.longAbove ? base.long : base;
  return (
    (n(usage.input) * r.input +
      n(usage.cached) * r.cachedInput +
      n(usage.cacheWrite) * r.cacheWrite +
      n(usage.output) * r.output) /
    1_000_000
  );
}

// Claude reports fresh input WITHOUT the cached parts; the other two report
// a total that INCLUDES them. Normalised here so costUsd never double-counts.
export function fromClaude(u: {
  input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  output_tokens?: number | null;
} | null | undefined): Usage {
  return {
    input: u?.input_tokens ?? 0,
    cached: u?.cache_read_input_tokens ?? 0,
    cacheWrite: u?.cache_creation_input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
  };
}

// Chat Completions (GPT-6 Sol) reports the cache writes OpenAI charges as
// prompt_tokens_details.cache_write_tokens (its streaming reference, read
// 2026-10-01: "The unadjusted number of prompt tokens written to cache."). A
// response without the field counts every uncached token as written: that
// can only overcharge a little, never undercharge.
export function fromOpenAI(u: {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  prompt_tokens_details?: { cached_tokens?: number | null; cache_write_tokens?: number | null } | null;
} | null | undefined): Usage {
  const total = u?.prompt_tokens ?? 0;
  const cached = Math.min(total, u?.prompt_tokens_details?.cached_tokens ?? 0);
  const written = u?.prompt_tokens_details?.cache_write_tokens;
  const cacheWrite = typeof written === "number" && Number.isFinite(written) ? Math.max(0, Math.min(total - cached, written)) : total - cached;
  return { input: total - cached - cacheWrite, cached, cacheWrite, output: u?.completion_tokens ?? 0 };
}

// The Responses API (GPT-6 Luna): input_tokens is the whole input, cached
// and cache-written parts included, and output_tokens includes reasoning.
export function fromResponses(u: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  input_tokens_details?: { cached_tokens?: number | null; cache_write_tokens?: number | null } | null;
} | null | undefined): Usage {
  const total = u?.input_tokens ?? 0;
  const cached = Math.min(total, u?.input_tokens_details?.cached_tokens ?? 0);
  const cacheWrite = Math.min(total - cached, u?.input_tokens_details?.cache_write_tokens ?? 0);
  return { input: total - cached - cacheWrite, cached, cacheWrite, output: u?.output_tokens ?? 0 };
}

export function fromGemini(u: {
  promptTokenCount?: number | null;
  cachedContentTokenCount?: number | null;
  candidatesTokenCount?: number | null;
  thoughtsTokenCount?: number | null;
} | null | undefined): Usage {
  const total = u?.promptTokenCount ?? 0;
  const cached = Math.min(total, u?.cachedContentTokenCount ?? 0);
  return {
    input: total - cached,
    cached,
    cacheWrite: 0,
    output: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Units: the assistant ledger's own unit (agent_usage, lib/agent/prices.ts),
// two cents, so a chat message draws on exactly the allowance the plan shows.

export const UNIT_USD = 0.02;

export function unitsForCost(cost: number): number {
  return Math.max(1, Math.ceil((Number.isFinite(cost) ? cost : 0) / UNIT_USD - 1e-9));
}

// THE RESERVATION. Taken before the first call, settled to the real cost
// after. It must cover the worst a turn can cost:
//
//   One lane, everyday: a 60,000-token fresh input (a long PDF) × $2/M
//   = $0.12, plus 8,000 output × $10/M = $0.08, plus a tool round or two and
//   up to 3 searches ($0.03) — the brake below stops new rounds at $0.40.
//   25 units = $0.50.
//
//   Think harder on Claude is Opus 5.5 at twice the rates and 16,000 output:
//   brake $0.80, 50 units = $1.00.
//
//   Luna, everyday: the same 60,000 fresh tokens written to her cache at
//   $0.125/M = $0.0075, 8,000 output × $0.50/M = $0.004, three searches with
//   their results ($0.03 + ~60,000 × $0.125/M) — under $0.05 a round. Her
//   own brake stops new rounds at $0.15, so the last round lands under
//   $0.20: 10 units. (Think harder on Luna is Opus 5.5 on Claude's lane,
//   reserved as Claude's.)
//
//   "Ask all three" reserves the three lanes together.
export const MAX_OUTPUT: Record<"everyday" | "harder", number> = { everyday: 8000, harder: 16000 };
export const RESERVE_UNITS: Record<Brain, { everyday: number; harder: number }> = {
  luna: { everyday: 10, harder: 50 },
  claude: { everyday: 25, harder: 50 },
  gpt: { everyday: 25, harder: 40 },
  gemini: { everyday: 10, harder: 15 },
};
export const BRAKE_USD = { everyday: 0.4, harder: 0.8 } as const;
export const LUNA_BRAKE_USD = 0.15;
export const MAX_TOOL_ROUNDS = 6;

export function reserveUnits(choice: BrainChoice, harder: boolean): number {
  const lanes: readonly Brain[] = choice === "all" ? BRAINS : [choice];
  return lanes.reduce((sum, b) => sum + RESERVE_UNITS[b][harder ? "harder" : "everyday"], 0);
}

// Web search on Claude: $10 per 1,000 searches (Anthropic's web search tool
// page, read 2026-09-28 for Aly — lib/producer/prices.ts), on top of the
// tokens the results add. At most three searches a question here.
export const WEB_SEARCH_USD = 0.01;
export const WEB_SEARCH_MAX_USES = 3;
