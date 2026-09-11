import { describe, expect, it } from "vitest";
import { worstCaseAstraUsd } from "../../../src/lib/astra/prices.ts";
import { SET_BUILD_INPUT_TOKENS, SET_BUILD_MAX_OUTPUT_TOKENS, SET_CLOSE_RETRY_INPUT_TOKENS } from "../../../src/lib/sets/set-config.ts";
import { COST_BASIS_USD_PER_CREDIT } from "../../../src/lib/generations/providers/video-models.ts";
import { baselineInputBoundChars, costOfTokens, makePriceBook, tokenCounts, validateExternalPrices, type ExternalPrices } from "./prices.mts";
import { ceilingOf, planA, planC, planCanary, planD, planProbeA } from "./plan.mts";
import { checkPlan } from "./spend-guard.mts";
import { partE, E_BLOCKED } from "../parts/e.mts";
import type { RunContext } from "./context.mts";
import { REPO_ROOT } from "./util.mts";

// Neutral injected prices: round numbers that make the arithmetic readable.
// They are NOT any provider's price — the real ones live in external-prices.json.
const NEUTRAL = { inputPerMTok: 1, cachedInputPerMTok: null, cacheWritePerMTok: null, outputPerMTok: 10, source: "https://example.test/prices", readOn: "2026-01-01" };
const EMPTY: ExternalPrices = { models: { "claude-sonnet-5": null, "gpt-5.4-mini": null }, images: { "flux-2-pro-edit": null, "seedream-v4-edit": null }, judgementCeilings: {} };
const book = makePriceBook({ external: EMPTY, gptImageUsd: 0.17 });

describe("the price book", () => {
  it("prices Astra's worst cases from prices.ts over set-config.ts's caps", () => {
    expect(book.astraFirstWorstUsd).toBe(worstCaseAstraUsd(SET_BUILD_INPUT_TOKENS, SET_BUILD_MAX_OUTPUT_TOKENS));
    expect(book.astraRetryWorstUsd).toBe(worstCaseAstraUsd(SET_CLOSE_RETRY_INPUT_TOKENS, SET_BUILD_MAX_OUTPUT_TOKENS));
    expect(book.astraFirstWorstUsd).toBeCloseTo(0.53, 12);
    expect(book.astraRetryWorstUsd).toBeCloseTo(0.625, 12);
    expect(book.costBasisUsdPerCredit).toBe(COST_BASIS_USD_PER_CREDIT);
  });

  it("halves only the billed cost on Batch", () => {
    const usage = { input_tokens: 1000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 1000 };
    const bg = book.astraCost(usage, "background");
    const batch = book.astraCost(usage, "batch");
    expect(batch.standardUsd).toBe(bg.standardUsd);
    expect(batch.billedUsd).toBeCloseTo(bg.standardUsd / 2, 12);
  });

  it("reads every usage shape", () => {
    expect(tokenCounts({ input_tokens: 100, input_tokens_details: { cached_tokens: 30, cache_write_tokens: 20 }, output_tokens: 7 }, "openai")).toEqual({ freshInput: 50, cachedInput: 30, cacheWrite: 20, output: 7, reasoning: 0 });
    expect(tokenCounts({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens: 9 }, "openai")).toEqual({ freshInput: 60, cachedInput: 40, cacheWrite: 0, output: 9, reasoning: 0 });
    expect(tokenCounts({ input_tokens: 100, cache_read_input_tokens: 40, cache_creation_input_tokens: 0, output_tokens: 9 }, "anthropic")).toEqual({ freshInput: 100, cachedInput: 40, cacheWrite: 0, output: 9, reasoning: 0 });
  });

  it("never under-counts an unknown sub-rate", () => {
    // Cached input with no price of its own bills at the full input rate.
    expect(costOfTokens(NEUTRAL, { freshInput: 0, cachedInput: 1_000_000, cacheWrite: 0, output: 0, reasoning: 0 })).toBe(1);
    // A cache write with no price makes the call unpriced rather than guessed.
    expect(costOfTokens(NEUTRAL, { freshInput: 0, cachedInput: 0, cacheWrite: 5, output: 0, reasoning: 0 })).toBeNull();
  });

  it("prices a dated snapshot by its model name, and never a longer name by a shorter one", () => {
    const b = makePriceBook({ external: { ...EMPTY, models: { "gpt-5.4": NEUTRAL, "gpt-5.4-mini": null } }, gptImageUsd: 0.17 });
    expect(b.model("gpt-5.4-2026-03-01")).toEqual(NEUTRAL);
    expect(b.model("gpt-5.4-mini")).toBeNull();
    expect(b.model("gpt-5.4-mini-2026-03-01")).toBeNull();
  });

  it("bounds a baseline attempt at 1 token per character and the output cap", () => {
    expect(baselineInputBoundChars("first")).toBeGreaterThan(8000);
    expect(baselineInputBoundChars("retry")).toBeGreaterThan(baselineInputBoundChars("first") + 16_000);
    const b = makePriceBook({ external: { ...EMPTY, models: { "gpt-5.4-mini": NEUTRAL } }, gptImageUsd: 0.17 });
    expect(b.baselineAttemptWorstUsd("gpt-5.4-mini", "first")).toBeCloseTo((baselineInputBoundChars("first") * 1 + 10_000 * 10) / 1e6, 12);
    expect(book.baselineAttemptWorstUsd("gpt-5.4-mini", "first")).toBeNull();
  });

  it("validates external-prices.json", () => {
    expect(validateExternalPrices({ models: { a: null }, images: {}, judgementCeilings: {} }).ok).toBe(true);
    expect(validateExternalPrices({ models: { a: { inputPerMTok: 1 } }, images: {}, judgementCeilings: {} }).ok).toBe(false);
    expect(validateExternalPrices({ models: { a: { ...NEUTRAL, source: "claude pricing page" } }, images: {}, judgementCeilings: {} }).ok).toBe(false);
    expect(validateExternalPrices({ models: {}, images: {}, judgementCeilings: { g: { usd: 0.01, derivation: "short" } } }).ok).toBe(false);
  });
});

describe("the plans", () => {
  it("A's Batch ceiling is 180 × (first + retry) × 0.5 = $103.95", () => {
    const plan = planA({ briefs: 30, runs: 3, builders: ["astra-low", "astra-medium", "sonnet-5", "mini-5.4"], transport: "batch", wordsGate: true, book });
    const { ceilingUsd, unpriced } = ceilingOf(plan);
    expect(ceilingUsd).toBeCloseTo(180 * (book.astraFirstWorstUsd + book.astraRetryWorstUsd) * 0.5, 9);
    expect(Math.abs(ceilingUsd - 103.95)).toBeLessThan(1e-9);
    expect(unpriced.sort()).toEqual(["gates", "mini-5.4", "sonnet-5"]);
    expect(plan.find((l) => l.kind === "gates")?.count).toBe(720);
  });

  it("lists every unpriced kind, and checkPlan wants each acknowledged", () => {
    const plan = planA({ briefs: 30, runs: 3, builders: ["astra-low", "sonnet-5"], transport: "batch", wordsGate: true, book });
    expect(checkPlan(plan, 200, []).ok).toBe(false);
    expect(checkPlan(plan, 200, []).unacknowledged.sort()).toEqual(["gates", "sonnet-5"]);
    expect(checkPlan(plan, 200, ["gates", "sonnet-5"]).ok).toBe(true);
    expect(checkPlan(plan, 10, ["gates", "sonnet-5"]).excessUsd).toBeGreaterThan(0);
  });

  it("C: GPT Image 80 stills × 2 renders × $0.17 reserved; FLUX 160 and Seedream 60 renders", () => {
    const plan = planC({ sets: 10, cameras: 3, characters: 2, engines: ["gpt-image", "flux", "seedream"], control: true, book });
    const renders = (k: string) => plan.filter((l) => l.kind === k).reduce((s, l) => s + l.count, 0);
    expect(renders("gpt-image")).toBe(160);
    expect(renders("flux")).toBe(160);
    expect(renders("seedream")).toBe(60);
    expect(ceilingOf(plan.filter((l) => l.kind === "gpt-image")).ceilingUsd).toBeCloseTo(27.2, 9);
    const count = (label: string) => plan.find((l) => l.label.startsWith(label))?.count;
    expect(count("entry prompt gate")).toBe(220);
    expect(count("pipeline prompt gate")).toBe(220);
    expect(count("output gate")).toBe(220);
    expect(count("identity score")).toBe(220);
    expect(count("drafter")).toBe(40);
  });

  it("D: 40 × $1.155 standard, plus stills once the stills leg exists", () => {
    const noStills = planD({ briefs: 40, runs: 1, dCameras: 1, transport: "background", stills: false, book });
    expect(ceilingOf(noStills).ceilingUsd).toBeCloseTo(46.2, 9);
    const withStills = planD({ briefs: 40, runs: 1, dCameras: 1, transport: "background", stills: true, book });
    expect(ceilingOf(withStills).ceilingUsd).toBeCloseTo(59.8, 9);
  });

  it("the canary is 10 first attempts on Batch = $2.65; the A probe's priced line is $0.265", () => {
    expect(ceilingOf(planCanary({ briefs: 10, transport: "batch", book })).ceilingUsd).toBeCloseTo(2.65, 9);
    expect(ceilingOf(planProbeA(book)).ceilingUsd).toBeCloseTo(0.265, 9);
  });

  it("E is blocked until its calls are built: its plan has no calls", () => {
    const plan = partE.plan({ repoRoot: REPO_ROOT } as RunContext);
    expect(plan).toMatchObject({ blocked: E_BLOCKED });
    expect("lines" in plan).toBe(false);
  });
});
