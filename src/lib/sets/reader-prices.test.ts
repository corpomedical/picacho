import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READER_PRICES, readerCallUsd } from "./reader-prices";
import { SHOT_WORDS_MODEL } from "./shot-words";

// The small reader model's prices in code (Helios Cut 4, step B4,
// 2026-09-26): the phrase check's prices.json, read on its date, and what
// one answered call cost from the usage it reported.

describe("gpt-5.4-mini's prices", () => {
  it("are the phrase check's prices.json, rate for rate and date for date", () => {
    const file = JSON.parse(readFileSync(join(__dirname, "../../../scripts/helios-reader-check/prices.json"), "utf8")) as Record<string, unknown>;
    expect(READER_PRICES).toEqual({
      model: file.model,
      inputPer1M: file.inputPer1M,
      cachedInputPer1M: file.cachedInputPer1M,
      outputPer1M: file.outputPer1M,
      read: file.read,
      source: file.source,
    });
    expect(READER_PRICES.model).toBe(SHOT_WORDS_MODEL);
    expect(READER_PRICES).toMatchObject({ inputPer1M: 0.75, cachedInputPer1M: 0.075, outputPer1M: 4.5, read: "2026-09-25" });
  });

  it("price a call from its usage: uncached, cached and output tokens each at their own rate", () => {
    // 1,000 uncached × $0.75 + 800 cached × $0.075 + 300 out × $4.50, per 1M.
    expect(readerCallUsd({ prompt: 1800, cached: 800, completion: 300 })).toBeCloseTo((1000 * 0.75 + 800 * 0.075 + 300 * 4.5) / 1e6, 12);
    expect(readerCallUsd({ prompt: 1800, cached: null, completion: 300 })).toBeCloseTo((1800 * 0.75 + 300 * 4.5) / 1e6, 12);
    // A cached count past the prompt is held to it.
    expect(readerCallUsd({ prompt: 100, cached: 500, completion: 0 })).toBeCloseTo((100 * 0.075) / 1e6, 12);
    expect(readerCallUsd({ prompt: null, cached: 0, completion: 10 })).toBeNull();
    expect(readerCallUsd({ prompt: 10, cached: 0, completion: null })).toBeNull();
  });
});
