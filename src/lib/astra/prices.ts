// What a GPT-6 Astra call costs (2026-09-10). The agent/prices.ts pattern:
// alias-free so it unit-tests, and the only module that knows the price of
// an Astra token.
//
// PRICES ARE DATED AND SOURCED. Read from https://developers.openai.com/api/docs/pricing
// on 2026-09-10. When they change, change them HERE and move the date.

export const ASTRA_PRICES_READ_ON = "2026-09-10";

/** USD per 1M tokens, GPT-6 Astra, standard tier. */
export const ASTRA_INPUT_PER_MTOK = 10;
export const ASTRA_CACHED_INPUT_PER_MTOK = 1;
export const ASTRA_CACHE_WRITE_PER_MTOK = 12.5;
export const ASTRA_OUTPUT_PER_MTOK = 50;

// Above this many input tokens the WHOLE request bills at 2x input and 1.5x
// output. Nothing Picacho sends comes near it (a set build is ~1,700 input
// tokens); the multiplier is here so the arithmetic stays true if that ever
// changes.
export const ASTRA_LONG_PROMPT_TOKENS = 272_000;
export const ASTRA_LONG_INPUT_MULTIPLIER = 2;
export const ASTRA_LONG_OUTPUT_MULTIPLIER = 1.5;

/** The Responses API usage block, as the API returns it. */
export type AstraUsage = {
  input_tokens?: number | null;
  input_tokens_details?: { cached_tokens?: number | null; cache_write_tokens?: number | null } | null;
  output_tokens?: number | null;
  output_tokens_details?: { reasoning_tokens?: number | null } | null;
};

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * What this call cost, from the API's own numbers. input_tokens is the
 * total; cached and cache-write tokens are parts of it, billed at their own
 * rates, and the rest is plain input. Reasoning tokens are part of
 * output_tokens and bill as output.
 */
export function costOfAstraUsageUsd(usage: AstraUsage | null | undefined): number {
  if (!usage) return 0;
  const input = n(usage.input_tokens);
  const cached = Math.min(input, n(usage.input_tokens_details?.cached_tokens));
  const written = Math.min(input - cached, n(usage.input_tokens_details?.cache_write_tokens));
  const fresh = input - cached - written;
  const long = input > ASTRA_LONG_PROMPT_TOKENS;
  const inMul = long ? ASTRA_LONG_INPUT_MULTIPLIER : 1;
  const outMul = long ? ASTRA_LONG_OUTPUT_MULTIPLIER : 1;
  return (
    (fresh * ASTRA_INPUT_PER_MTOK * inMul +
      cached * ASTRA_CACHED_INPUT_PER_MTOK * inMul +
      written * ASTRA_CACHE_WRITE_PER_MTOK * inMul +
      n(usage.output_tokens) * ASTRA_OUTPUT_PER_MTOK * outMul) /
    1_000_000
  );
}

/**
 * The most one call can cost: every input token billed as a cache write
 * (the dearest input class) and the answer running all the way to its cap.
 * A ceiling, not a price.
 */
export function worstCaseAstraUsd(inputTokens: number, maxOutputTokens: number): number {
  return costOfAstraUsageUsd({
    input_tokens: inputTokens,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: inputTokens },
    output_tokens: maxOutputTokens,
  });
}
