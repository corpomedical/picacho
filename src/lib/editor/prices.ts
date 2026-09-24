// What an edit costs US, from each provider's own numbers.
//
// PRICES ARE DATED AND SOURCED, the rule lib/agent/prices.ts set: change them
// here and nowhere else, and move the date.
//  - Whisper transcription: $0.006 per audio minute (OpenAI pricing page, read 2026-09-24).
//  - The editing session itself is NOT priced here: the Managed Agents platform
//    reports each session's list cost (tokens at Opus 5.5's $4 in / $20 out per
//    MTok, cache reads $0.20, plus $0.08 per running session-hour — Anthropic's
//    pricing page, read 2026-09-25) and advance.ts records that figure as-is.

export const WHISPER_USD_PER_MINUTE = 0.006;

export function whisperCostUsd(seconds: number): number {
  return (Math.max(0, seconds) / 60) * WHISPER_USD_PER_MINUTE;
}
