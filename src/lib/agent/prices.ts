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
// Derived, not guessed. The input side is the same for both modes: the two
// system blocks (~1k tokens) plus the project context (~2.5k on a busy
// account: twelve characters, thirty rules, fifteen renders) plus twelve
// turns of history capped at 2,000 characters each (~6k) — call it 9,500
// tokens, and price it as a cache WRITE at 1.25x, which is the expensive
// first turn of a conversation:
//
//   input  9,500 tok x $5/Mtok x 1.25  = $0.059
//   faster output 1,500 tok x $25/Mtok = $0.038  ->  $0.097  ->  5 units
//   smarter output 4,000 tok x $25/Mtok = $0.100 ->  $0.159  ->  8 units
//
// One unit of headroom each, because max_tokens is the only hard stop and
// the context sizes above are estimates. If a real turn ever settles above
// these, it is charged what it cost — the ceiling governs the reservation,
// not the bill.
export const MAX_UNITS_PER_TURN = { faster: 6, smarter: 10 } as const;

export type AgentMode = "faster" | "smarter";

export function isAgentMode(value: unknown): value is AgentMode {
  return value === "faster" || value === "smarter";
}
