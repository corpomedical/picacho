// What an edit costs US, from each provider's own numbers.
//
// PRICES ARE DATED AND SOURCED, the rule lib/agent/prices.ts set: change them
// here and nowhere else, and move the date. Read 2026-09-24:
//  - Claude Opus 5.5 (claude-opus-5-5): $4 / 1M input, $20 / 1M output, cache
//    reads $0.20 / 1M (Anthropic's model table).
//  - Whisper transcription: $0.006 per audio minute (OpenAI pricing page).
//  - HeyGen HyperFrames cloud render: 0.1 credits per output minute at
//    1080p/30 fps, 0.2 at 60 fps, 4K ×1.5 (HeyGen's enterprise pricing page).
//    What one API credit costs in dollars was NOT confirmed at source that
//    day; HEYGEN_USD_PER_CREDIT stays 1 until the operator's wallet shows it.

export const OPUS_55_INPUT_PER_MTOK = 4.0;
export const OPUS_55_OUTPUT_PER_MTOK = 20.0;
export const OPUS_55_CACHE_READ_PER_MTOK = 0.2;
/** Cache writes bill 1.25× input (5-minute TTL), as in lib/agent/prices.ts. */
export const CACHE_WRITE_MULTIPLIER = 1.25;

export const WHISPER_USD_PER_MINUTE = 0.006;

export const HEYGEN_CREDITS_PER_MINUTE_1080P30 = 0.1;
export const HEYGEN_USD_PER_CREDIT = 1;

export type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export function opusCostUsd(usage: Usage): number {
  const per = (rate: number) => rate / 1_000_000;
  return (
    (usage.input_tokens ?? 0) * per(OPUS_55_INPUT_PER_MTOK) +
    (usage.cache_creation_input_tokens ?? 0) * per(OPUS_55_INPUT_PER_MTOK) * CACHE_WRITE_MULTIPLIER +
    (usage.cache_read_input_tokens ?? 0) * per(OPUS_55_CACHE_READ_PER_MTOK) +
    (usage.output_tokens ?? 0) * per(OPUS_55_OUTPUT_PER_MTOK)
  );
}

export function whisperCostUsd(seconds: number): number {
  return (Math.max(0, seconds) / 60) * WHISPER_USD_PER_MINUTE;
}

export function renderCostUsd(outputSeconds: number): number {
  return (Math.max(0, outputSeconds) / 60) * HEYGEN_CREDITS_PER_MINUTE_1080P30 * HEYGEN_USD_PER_CREDIT;
}
