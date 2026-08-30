// What a chat turn costs, and what we charge for it (2026-08-30).
//
// Alias-free so it can be unit-tested — same reasoning as refund-rules.ts and
// video-resolution.ts. Every number that decides a charge lives here, and
// this module is the only place that knows the price of a token.
//
// PRICES ARE DATED AND SOURCED. Read from Anthropic's published rates on
// 2026-08-30. They will change; when they do, change them HERE and nowhere
// else, and move the date. The same discipline video-models.ts uses for fal:
// a stale price comment is how a product quietly starts selling below cost.

/** USD per 1M tokens, claude-opus-5, read 2026-08-30. */
export const OPUS_5_INPUT_PER_MTOK = 5.0;
export const OPUS_5_OUTPUT_PER_MTOK = 25.0;

// Cache reads bill about a tenth of input; cache writes about 1.25x. These
// multipliers are what make the chat affordable at all: the project context
// is stable per conversation, so from turn two onward most of the input is a
// cache read. If cache_read_input_tokens is ever zero across a conversation,
// something is invalidating the prefix and this feature costs ~10x what it
// should — see buildAgentContext for the ordering that prevents it.
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

export type TurnUsage = {
  input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  output_tokens?: number | null;
};

/** What this turn actually cost us, in dollars, from the API's own numbers. */
export function costOfTurnUsd(usage: TurnUsage): number {
  const fresh = usage.input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const out = usage.output_tokens ?? 0;
  const inPer = OPUS_5_INPUT_PER_MTOK / 1_000_000;
  return (
    fresh * inPer +
    cacheRead * inPer * CACHE_READ_MULTIPLIER +
    cacheWrite * inPer * CACHE_WRITE_MULTIPLIER +
    out * (OPUS_5_OUTPUT_PER_MTOK / 1_000_000)
  );
}

// The billing unit. Two cents, so a typical Faster turn is ~2 units and a
// typical Smarter turn ~5 — small enough that the cheapest question isn't
// rounded up into something expensive, big enough that the numbers a person
// sees stay whole.
export const AGENT_UNIT_USD = 0.02;

/**
 * Units to charge for a turn. Always at least 1: a turn that reached the
 * model cost something, and rounding it to zero would make the meter
 * lie in the direction that costs us money.
 */
export function unitsForTurn(usage: TurnUsage): number {
  return Math.max(1, Math.ceil(costOfTurnUsd(usage) / AGENT_UNIT_USD));
}

// The worst a single turn can cost, per mode — and therefore what gets
// RESERVED against the allowance before the call runs. The turn is settled
// afterwards at its real cost, so these are ceilings, not prices.
//
// MEASURED 2026-08-31, first live runs against a real account (three
// characters, nineteen brand rules, fifteen renders):
//
//   faster, cold  input 16 fresh + 2,602 written + 1,206 read, output 98
//                 -> $0.019 -> 1 unit
//   faster, warm  input 125 fresh + 3,808 read, output 153
//                 -> $0.006 -> 1 unit
//   smarter       input 22 fresh + 2,602 written + 1,206 read, output 790
//                 (477 of them thinking) -> $0.037 -> 2 units
//
// So a real turn is 1-2 units. The ceilings below are deliberately well
// above that, because a ceiling has to cover the worst case rather than the
// observed one: max_tokens is the only hard stop, and an answer that runs
// all the way to it costs $0.038 (faster) or $0.100 (smarter) in output
// alone, plus input.
//
// An EARLIER version of this comment derived 5 and 8 from an assumed 9,500
// fresh input tokens per turn. That assumption is now known to be wrong by
// about 4x — with three cache breakpoints almost the entire prompt is a
// cache read at a tenth of the price. The numbers stayed; the reasoning is
// replaced with what was actually observed.
//
// The cost of being generous here is a tail: someone with 40 of 45 units
// spent cannot START a Smarter turn (40 + 10 > 45) even though it would
// settle at 2. Worth revisiting once agent_usage has real distribution in
// it, and not before — guessing twice is how the first version got here.
export const MAX_UNITS_PER_TURN = { faster: 6, smarter: 10 } as const;

export type AgentMode = "faster" | "smarter";

export function isAgentMode(value: unknown): value is AgentMode {
  return value === "faster" || value === "smarter";
}
