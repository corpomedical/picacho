import { describe, expect, it } from "vitest";
import { worstCaseAstraUsd } from "../../../src/lib/astra/prices.ts";
import {
  SET_BUILD_INPUT_TOKENS,
  SET_BUILD_MAX_OUTPUT_TOKENS,
  SET_CLOSE_RETRY_INPUT_TOKENS,
  SET_MATCH_INPUT_TOKENS,
  SET_MATCH_MAX_OUTPUT_TOKENS,
  SET_PHOTO_BUILD_INPUT_TOKENS,
  SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS,
  SET_PHOTO_CLOSE_RETRY_INPUT_TOKENS,
} from "../../../src/lib/sets/set-config.ts";
import { MATCH_SHOT_INPUT_TEXT, MATCH_SHOT_INSTRUCTIONS, MATCH_SHOT_JSON_SCHEMA } from "../../../src/lib/sets/match-shot.ts";
import { COST_BASIS_USD_PER_CREDIT } from "../../../src/lib/generations/providers/video-models.ts";
import { defaultCredits } from "./pass-bars.mts";
import { baselineInputBoundChars, costOfTokens, makePriceBook, matchBaselineInputBound, tokenCounts, validateExternalPrices, type ExternalPrices } from "./prices.mts";
import { ceilingOf, planA, planAPhotos, planC, planCanary, planD, planDPhotos, planE, planProbeA, planProbeC } from "./plan.mts";
import { checkPlan } from "./spend-guard.mts";
import { partE } from "../parts/e.mts";
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

  it("prices a photo build at the photo caps: $0.86 + $0.95625 = $1.81625, and 4 credits → $1.12", () => {
    expect(book.astraPhotoFirstWorstUsd).toBe(worstCaseAstraUsd(SET_PHOTO_BUILD_INPUT_TOKENS, SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS));
    expect(book.astraPhotoRetryWorstUsd).toBe(worstCaseAstraUsd(SET_PHOTO_CLOSE_RETRY_INPUT_TOKENS, SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS));
    // 4,800 × $12.50/1M + 16,000 × $50/1M; 12,500 × $12.50/1M + 16,000 × $50/1M (set-config.ts).
    expect(book.astraPhotoFirstWorstUsd).toBeCloseTo(0.86, 12);
    expect(book.astraPhotoRetryWorstUsd).toBeCloseTo(0.95625, 12);
    expect(book.astraPhotoBuildWorstUsd).toBeCloseTo(1.81625, 12);
    // Section 4's "$1.12 for photos": ceil(0.86 / 0.28) = 4 credits, as the words' 2 is ceil(0.53 / 0.28).
    expect(defaultCredits(book.astraPhotoFirstWorstUsd, book.costBasisUsdPerCredit)).toBe(4);
    expect(4 * book.costBasisUsdPerCredit).toBeCloseTo(1.12, 12);
    expect(defaultCredits(book.astraFirstWorstUsd, book.costBasisUsdPerCredit)).toBe(2);
    expect(book.snapshot().astraPhoto).toMatchObject({ firstWorstUsd: book.astraPhotoFirstWorstUsd, retryWorstUsd: book.astraPhotoRetryWorstUsd });
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

  const renders = (plan: ReturnType<typeof planC>, k: string) => plan.filter((l) => l.kind === k).reduce((s, l) => s + l.count, 0);
  const countOf = (plan: ReturnType<typeof planC>, label: string) => plan.find((l) => l.label.startsWith(label))?.count;

  it("C: 60 set + 40 look + 20 control GPT Image stills × 2 renders × $0.17 = $40.80 reserved; FLUX 240 and Seedream 60 renders", () => {
    const plan = planC({ sets: 10, cameras: 3, characters: 2, engines: ["gpt-image", "flux", "seedream"], control: true, look: true, book });
    expect(renders(plan, "gpt-image")).toBe(240);
    expect(renders(plan, "flux")).toBe(240);
    expect(renders(plan, "seedream")).toBe(60);
    // (60 + 40 + 20) × 2 × $0.17 (IMAGE_COST_USD, GENERATE_RETRIES = 2)
    expect(ceilingOf(plan.filter((l) => l.kind === "gpt-image")).ceilingUsd).toBeCloseTo(120 * 2 * 0.17, 9);
    expect(ceilingOf(plan).ceilingUsd).toBeCloseTo(40.8, 9);
    expect(plan.find((l) => l.kind === "gpt-image" && l.label.startsWith("look shots"))?.count).toBe(80);
    expect(plan.some((l) => l.kind === "seedream" && l.label.startsWith("look shots"))).toBe(false);
    for (const g of ["entry prompt gate", "pipeline prompt gate", "output gate", "identity score"]) expect(countOf(plan, g)).toBe(300);
    expect(countOf(plan, "drafter")).toBe(40);
    expect(ceilingOf(plan).unpriced.sort()).toEqual(["drafter", "flux", "gates", "scorer", "seedream"]);
  });

  it("C without the look is section 4's 60 + 20 controls: $27.20 reserved on GPT Image; the look adds 40 × 2 × $0.17 = $13.60", () => {
    const plan = planC({ sets: 10, cameras: 3, characters: 2, engines: ["gpt-image", "flux", "seedream"], control: true, look: false, book });
    expect(renders(plan, "gpt-image")).toBe(160);
    expect(renders(plan, "flux")).toBe(160);
    expect(ceilingOf(plan).ceilingUsd).toBeCloseTo(27.2, 9);
    expect(countOf(plan, "entry prompt gate")).toBe(220);
    const look = planC({ sets: 10, cameras: 3, characters: 2, engines: ["gpt-image"], control: true, look: true, book });
    expect(ceilingOf(look).ceilingUsd - ceilingOf(planC({ sets: 10, cameras: 3, characters: 2, engines: ["gpt-image"], control: true, look: false, book })).ceilingUsd).toBeCloseTo(13.6, 9);
  });

  it("c --probe: camera 1 on each engine and camera 2 with the look on GPT Image and FLUX, no twin, no control: 2 × 2 × $0.17 = $0.68", () => {
    const plan = planProbeC({ engines: ["gpt-image", "flux", "seedream"], look: true, book });
    // (1 set shot + 1 look shot) × GENERATE_RETRIES 2 × $0.17 (IMAGE_COST_USD)
    expect(ceilingOf(plan).ceilingUsd).toBeCloseTo(2 * 2 * 0.17, 9);
    expect(renders(plan, "flux")).toBe(4);
    expect(renders(plan, "seedream")).toBe(1);
    expect(plan.find((l) => l.kind === "gpt-image" && l.label.startsWith("look shots"))?.count).toBe(2);
    expect(plan.some((l) => l.label.startsWith("controls"))).toBe(false);
    for (const g of ["entry prompt gate", "pipeline prompt gate", "output gate", "identity score"]) expect(countOf(plan, g)).toBe(5);
    // --no-look: one still per engine, $0.34.
    const bare = planProbeC({ engines: ["gpt-image", "flux", "seedream"], look: false, book });
    expect(ceilingOf(bare).ceilingUsd).toBeCloseTo(0.34, 9);
    expect(countOf(bare, "entry prompt gate")).toBe(3);
  });

  it("D: 40 × $1.155 standard, plus 2 GPT Image renders a still for every harmful brief run that may get a set", () => {
    const noStills = planD({ briefs: 40, runs: 1, dCameras: 1, transport: "background", stills: 0, book });
    expect(ceilingOf(noStills).ceilingUsd).toBeCloseTo(46.2, 9);
    expect(noStills.some((l) => l.kind === "gpt-image")).toBe(false);
    // Every brief harmful: 46.20 + 40 × 2 × $0.17 = $59.80.
    const withStills = planD({ briefs: 40, runs: 1, dCameras: 1, transport: "background", stills: 40, book });
    expect(ceilingOf(withStills).ceilingUsd).toBeCloseTo(59.8, 9);
    // 20 harmful × 3 runs × 2 cameras: 138.60 + 120 × 2 × $0.17 = $179.40.
    const two = planD({ briefs: 40, runs: 3, dCameras: 2, transport: "background", stills: 20 * 3, book });
    expect(ceilingOf(two).ceilingUsd).toBeCloseTo(138.6 + 120 * 0.34, 9);
    expect(two.find((l) => l.label.startsWith("output gate on the stills"))?.count).toBe(120);
  });

  it("A photos: 20 photos × 3 runs at standard price (never Batch) = 60 × $1.81625 = $108.975; Astra only", () => {
    const plan = planAPhotos({ photos: 20, runs: 3, builders: ["astra-low", "sonnet-5", "mini-5.4"], wordsGate: true, book });
    const { ceilingUsd, unpriced } = ceilingOf(plan);
    expect(ceilingUsd).toBeCloseTo(60 * (book.astraPhotoFirstWorstUsd + book.astraPhotoRetryWorstUsd), 9);
    expect(Math.abs(ceilingUsd - 108.975)).toBeLessThan(1e-9);
    expect(plan.filter((l) => l.kind === "astra")).toHaveLength(1);
    expect(plan.some((l) => l.kind === "sonnet-5" || l.kind === "mini-5.4")).toBe(false);
    expect(plan.find((l) => l.kind === "astra")?.label).toMatch(/standard \(background; photos never go on Batch\)/);
    expect(unpriced).toEqual(["gates"]);
    expect(plan.find((l) => l.kind === "gates")?.count).toBe(120);
    const both = planAPhotos({ photos: 20, runs: 3, builders: ["astra-low", "astra-medium"], wordsGate: false, book });
    expect(ceilingOf(both).ceilingUsd).toBeCloseTo(217.95, 9);
    expect(both.some((l) => l.kind === "gates")).toBe(false);
  });

  it("D photos: 10 × 3 runs = 30 × $1.81625 = $54.4875; the gates are metered", () => {
    const plan = planDPhotos({ photos: 10, withNotes: 4, runs: 3, book });
    expect(ceilingOf(plan).ceilingUsd).toBeCloseTo(54.4875, 9);
    expect(ceilingOf(planDPhotos({ photos: 10, withNotes: 0, runs: 1, book })).ceilingUsd).toBeCloseTo(18.1625, 9);
    const count = (label: string) => plan.find((l) => l.label.startsWith(label))?.count;
    expect(count("notes gate")).toBe(12);
    expect(count("picture check")).toBe(30);
    expect(count("words gate")).toBe(60);
    expect(ceilingOf(plan).unpriced).toEqual(["gates"]);
  });

  it("the canary is 10 first attempts on Batch = $2.65; the A probe's priced line is $0.265", () => {
    expect(ceilingOf(planCanary({ briefs: 10, transport: "batch", book })).ceilingUsd).toBeCloseTo(2.65, 9);
    expect(ceilingOf(planProbeA(book)).ceilingUsd).toBeCloseTo(0.265, 9);
  });

  it("E: 30 photos × 3 runs on Astra at standard price (never Batch) = 90 × $0.16625 = $14.9625; mini and the picture check unpriced", () => {
    // 3,300 × $12.50/1M + 2,500 × $50/1M (set-config.ts).
    expect(book.astraMatchWorstUsd).toBe(worstCaseAstraUsd(SET_MATCH_INPUT_TOKENS, SET_MATCH_MAX_OUTPUT_TOKENS));
    expect(book.astraMatchWorstUsd).toBeCloseTo(0.16625, 12);
    const plan = planE({ photos: 30, runs: 3, book });
    const { ceilingUsd, unpriced } = ceilingOf(plan);
    expect(Math.abs(ceilingUsd - 14.9625)).toBeLessThan(1e-9);
    expect(unpriced.sort()).toEqual(["gates", "mini-5.4"]);
    const line = (kind: string) => plan.find((l) => l.kind === kind);
    expect(line("astra")).toMatchObject({ count: 90, unitUsd: book.astraMatchWorstUsd, metered: false });
    expect(line("astra")?.label).toMatch(/standard \(background; photos never go on Batch\)/);
    expect(line("mini-5.4")).toMatchObject({ count: 90, unitUsd: null });
    expect(line("gates")).toMatchObject({ count: 30, metered: true });
    expect(book.snapshot().astraMatch).toMatchObject({ worstUsd: book.astraMatchWorstUsd });
  });

  it("E's mini, once priced, is reserved at 1 token/char of its text plus the product's whole match budget for the picture, and the match cap", () => {
    const bound = matchBaselineInputBound();
    expect(bound).toBe(MATCH_SHOT_INSTRUCTIONS.length + JSON.stringify(MATCH_SHOT_JSON_SCHEMA).length + MATCH_SHOT_INPUT_TEXT.length + SET_MATCH_INPUT_TOKENS);
    const b = makePriceBook({ external: { ...EMPTY, models: { "gpt-5.4-mini": NEUTRAL } }, gptImageUsd: 0.17 });
    expect(b.matchBaselineWorstUsd("gpt-5.4-mini")).toBeCloseTo((bound * 1 + SET_MATCH_MAX_OUTPUT_TOKENS * 10) / 1e6, 12);
    expect(book.matchBaselineWorstUsd("gpt-5.4-mini")).toBeNull();
    expect(ceilingOf(planE({ photos: 30, runs: 3, book: b })).unpriced).toEqual(["gates"]);
  });

  it("E's plan is the part's: every photo of match.json × the runs, with the doc's own figures quoted by line", () => {
    const corpus = { data: { match: Array.from({ length: 30 }, (_, i) => ({ id: `mt-${i}` })) } };
    const plan = partE.plan({ repoRoot: REPO_ROOT, book, flags: { only: null, runs: null, fromRun: null }, corpus } as unknown as RunContext);
    if (!("lines" in plan)) throw new Error("E has calls to plan");
    expect(ceilingOf(plan.lines).ceilingUsd).toBeCloseTo(90 * book.astraMatchWorstUsd, 9);
    expect(plan.notes.join("\n")).toMatch(/docs\/ASTRA_SETS\.md:\d+ {2}E match:/);
    expect(plan.notes.join("\n")).toMatch(/90 reads = \$14\.96/);
  });
});
