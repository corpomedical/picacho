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
// Cache WRITES are 1.25x input on Claude (the prefix is written once, then
// read at the cached price). OpenAI and Google cache automatically and don't
// charge for the write. Reasoning ("thinking") tokens are billed as output on
// all three, and all three report them inside their output count.
//
// "Think harder" keeps the brain and gives it more thinking, except Claude,
// which moves up from Sonnet 5 to Opus 5.5 (operator's pick in the draft).

export type Brain = "claude" | "gpt" | "gemini";
export type BrainChoice = Brain | "all";
export const BRAINS: readonly Brain[] = ["claude", "gpt", "gemini"] as const;

export function isBrain(value: unknown): value is Brain {
  return value === "claude" || value === "gpt" || value === "gemini";
}

export function isBrainChoice(value: unknown): value is BrainChoice {
  return isBrain(value) || value === "all";
}

export const CLAUDE_MODEL = "claude-sonnet-5";
export const CLAUDE_HARDER_MODEL = "claude-opus-5-5";
export const TITLE_MODEL = "claude-haiku-4-5";
export const GPT_MODEL = "gpt-6-sol";
export const GEMINI_MODEL = "gemini-3.8-flash";

export const BRAIN_LABEL: Record<Brain, string> = {
  claude: "Claude",
  gpt: "GPT",
  gemini: "Gemini",
};

/** The model a brain answers with. */
export function modelFor(brain: Brain, harder: boolean): string {
  if (brain === "claude") return harder ? CLAUDE_HARDER_MODEL : CLAUDE_MODEL;
  if (brain === "gpt") return GPT_MODEL;
  return GEMINI_MODEL;
}

/** What people see under an answer: "Claude Sonnet 5", "GPT-6 Sol"… */
export function modelLabel(model: string): string {
  switch (model) {
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

type Rate = { input: number; cachedInput: number; output: number; cacheWrite: number };

export const RATES: Record<string, Rate> = {
  "claude-sonnet-5": { input: 2, cachedInput: 0.2, output: 10, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, cachedInput: 0.2, output: 20, cacheWrite: 5 },
  "claude-haiku-4-5": { input: 1, cachedInput: 0.1, output: 5, cacheWrite: 1.25 },
  "gpt-6-sol": { input: 2, cachedInput: 0.2, output: 10, cacheWrite: 2 },
  "gemini-3.8-flash": { input: 0.75, cachedInput: 0.075, output: 3.75, cacheWrite: 0.75 },
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
  const r = rateFor(model);
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
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

export function fromOpenAI(u: {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
} | null | undefined): Usage {
  const total = u?.prompt_tokens ?? 0;
  const cached = Math.min(total, u?.prompt_tokens_details?.cached_tokens ?? 0);
  return { input: total - cached, cached, cacheWrite: 0, output: u?.completion_tokens ?? 0 };
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
//   "Ask all three" reserves the three lanes together.
export const MAX_OUTPUT: Record<"everyday" | "harder", number> = { everyday: 8000, harder: 16000 };
export const RESERVE_UNITS: Record<Brain, { everyday: number; harder: number }> = {
  claude: { everyday: 25, harder: 50 },
  gpt: { everyday: 25, harder: 40 },
  gemini: { everyday: 10, harder: 15 },
};
export const BRAKE_USD = { everyday: 0.4, harder: 0.8 } as const;
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
