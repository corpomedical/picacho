// The small reader model's prices, in code (Helios Cut 4, step B4,
// 2026-09-26 — operator: "resume").
//
// gpt-5.4-mini reads a set's chat (shot-words.ts) and, since step B4, names
// a set's things and parts (name-actions.ts). Until now only its input and
// output rates were in code, inside the identity checker's route
// (app/api/tools/identity-check/route.ts THE MONEY, read 2026-09-22); the
// cached rate was only in the phrase check's prices.json. These are that
// file's three rates, with the date they were read, so a paid call that
// says its price reads it from here (reader-prices.test.ts holds the two
// equal). Re-read the page before quoting a cost past the date.
//
// Pure, relative imports only.

import { SHOT_WORDS_MODEL } from "./shot-words";

/** gpt-5.4-mini, per 1M tokens (scripts/helios-reader-check/prices.json, read 2026-09-25). */
export const READER_PRICES = {
  model: SHOT_WORDS_MODEL,
  inputPer1M: 0.75,
  cachedInputPer1M: 0.075,
  outputPer1M: 4.5,
  read: "2026-09-25",
  source: "https://developers.openai.com/api/docs/models/gpt-5.4-mini",
} as const;

/**
 * What one answered call cost, from the usage it reported: uncached input,
 * cached input and output (hidden reasoning is inside the output) at their
 * own rates. Null when the prompt or completion count is missing.
 */
export function readerCallUsd(usage: { prompt: number | null; cached: number | null; completion: number | null }): number | null {
  if (usage.prompt === null || usage.completion === null) return null;
  const cached = Math.min(usage.cached ?? 0, usage.prompt);
  return ((usage.prompt - cached) * READER_PRICES.inputPer1M + cached * READER_PRICES.cachedInputPer1M + usage.completion * READER_PRICES.outputPer1M) / 1_000_000;
}
