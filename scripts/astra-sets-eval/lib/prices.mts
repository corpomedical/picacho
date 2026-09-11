// The eval's price book. EVERY NUMBER COMES FROM A FILE, never from memory:
//
//   Astra per token     src/lib/astra/prices.ts (costOfAstraUsageUsd,
//                       worstCaseAstraUsd; read 2026-09-10)
//   Astra caps          src/lib/sets/set-config.ts, the text caps and the
//                       photo caps (a photo build: 4,800 input tokens and
//                       16,000 output, its closing retry 12,500 input:
//                       $0.86 + $0.95625 = $1.81625, set-config.ts shows the
//                       arithmetic). Photos are never on Batch, so a photo
//                       build is always priced at standard. A Match-this-shot
//                       read: 3,300 input tokens and 2,500 output, $0.16625
//                       (set-config.ts), at standard price too.
//   Batch 0.5           docs/ASTRA_SETS.md §1.2 "Price modifiers" (checked
//                       at run start: batchSentenceLine)
//   GPT Image 2 still   IMAGE_COST_USD, src/lib/admin/economics.ts — injected
//                       by run.mts, because that module needs the "@/" alias
//   credit peg          COST_BASIS_USD_PER_CREDIT, video-models.ts
//   everything else     external-prices.json: null until the operator reads
//                       the named page and writes the figure with its date
//
// Two rules about rates nobody has written down:
//   - Cached input with no price of its own bills at the FULL input rate:
//     an unknown sub-rate never under-counts.
//   - A cache write with no price of its own makes the call unpriced (null),
//     rather than inventing a multiplier.

import { costOfAstraUsageUsd, worstCaseAstraUsd, ASTRA_PRICES_READ_ON, type AstraUsage } from "../../../src/lib/astra/prices.ts";
import {
  SET_BUILD_INPUT_TOKENS,
  SET_BUILD_MAX_OUTPUT_TOKENS,
  SET_CLOSE_RETRY_INPUT_TOKENS,
  SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS,
  SET_BRIEF_MAX_CHARS,
  SET_PHOTO_BUILD_INPUT_TOKENS,
  SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS,
  SET_PHOTO_CLOSE_RETRY_INPUT_TOKENS,
  SET_MATCH_INPUT_TOKENS,
  SET_MATCH_MAX_OUTPUT_TOKENS,
} from "../../../src/lib/sets/set-config.ts";
import { MATCH_SHOT_INPUT_TEXT, MATCH_SHOT_INSTRUCTIONS, MATCH_SHOT_JSON_SCHEMA } from "../../../src/lib/sets/match-shot.ts";
import { COST_BASIS_USD_PER_CREDIT } from "../../../src/lib/generations/providers/video-models.ts";
import { SET_BUILDER_INSTRUCTIONS, SET_SPEC_JSON_SCHEMA } from "../../../src/lib/sets/set-builder-prompt.ts";
import { closeRetryInput, RETRY_SMALLER } from "../../../src/lib/sets/build-retry.ts";
import { describeOpenSides } from "../../../src/lib/sets/closure.ts";
import { normaliseSetSpec, type SetSpec } from "../../../src/lib/sets/set-spec.ts";
import { setBuildInput } from "../../../src/lib/sets/set-builder-prompt.ts";
import { isRecord } from "./util.mts";

export const BATCH_MULTIPLIER = 0.5;
export const BATCH_DOC_SENTENCE = "Batch and Flex are half price";
export const BATCH_SOURCE =
  'docs/ASTRA_SETS.md §1.2 "Price modifiers": "Batch and Flex are half price" (https://developers.openai.com/api/docs/pricing, read 2026-09-10)';

/** Builder → the model name its requests carry. Astra's comes from providers/astra.ts only. */
export const BASELINE_MODELS = { "sonnet-5": "claude-sonnet-5", "mini-5.4": "gpt-5.4-mini" } as const;
export const IMAGE_KEYS = { flux: "flux-2-pro-edit", seedream: "seedream-v4-edit" } as const;
export const JUDGEMENT_KEYS = ["prompt-gate", "output-gate", "identity-scorer", "drafter"] as const;
export type JudgementKey = (typeof JUDGEMENT_KEYS)[number];

export type ModelPrice = {
  inputPerMTok: number;
  cachedInputPerMTok: number | null;
  cacheWritePerMTok: number | null;
  outputPerMTok: number;
  source: string;
  readOn: string;
};
export type ImagePrice = { usdPerImage: number; source: string; readOn: string; note?: string };
export type JudgementCeiling = { usd: number; derivation: string };
export type ExternalPrices = {
  models: Record<string, ModelPrice | null>;
  images: Record<string, ImagePrice | null>;
  judgementCeilings: Record<string, JudgementCeiling | null>;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const price = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;

export function validateExternalPrices(raw: unknown): { ok: true; prices: ExternalPrices } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (!isRecord(raw)) return { ok: false, problems: ["external-prices.json is not an object"] };
  const out: ExternalPrices = { models: {}, images: {}, judgementCeilings: {} };
  const section = (name: keyof ExternalPrices) => {
    const s = raw[name];
    if (!isRecord(s)) {
      problems.push(`${name} must be an object`);
      return {};
    }
    return Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith("_")));
  };
  for (const [k, v] of Object.entries(section("models"))) {
    if (v === null) {
      out.models[k] = null;
      continue;
    }
    if (
      !isRecord(v) ||
      !price(v.inputPerMTok) ||
      !price(v.outputPerMTok) ||
      !(v.cachedInputPerMTok === null || price(v.cachedInputPerMTok)) ||
      !(v.cacheWritePerMTok === null || price(v.cacheWritePerMTok)) ||
      typeof v.source !== "string" ||
      !/^https?:\/\//.test(v.source) ||
      typeof v.readOn !== "string" ||
      !DATE.test(v.readOn)
    ) {
      problems.push(
        `models.${k}: needs inputPerMTok, cachedInputPerMTok (number or null), cacheWritePerMTok (number or null), outputPerMTok, source (the page's URL) and readOn (YYYY-MM-DD)`,
      );
      continue;
    }
    out.models[k] = v as unknown as ModelPrice;
  }
  for (const [k, v] of Object.entries(section("images"))) {
    if (v === null) {
      out.images[k] = null;
      continue;
    }
    if (!isRecord(v) || !price(v.usdPerImage) || typeof v.source !== "string" || !/^https?:\/\//.test(v.source) || typeof v.readOn !== "string" || !DATE.test(v.readOn)) {
      problems.push(`images.${k}: needs usdPerImage, source (the page's URL) and readOn (YYYY-MM-DD)`);
      continue;
    }
    out.images[k] = v as unknown as ImagePrice;
  }
  for (const [k, v] of Object.entries(section("judgementCeilings"))) {
    if (v === null) {
      out.judgementCeilings[k] = null;
      continue;
    }
    if (!isRecord(v) || !price(v.usd) || typeof v.derivation !== "string" || v.derivation.trim().length < 20) {
      problems.push(`judgementCeilings.${k}: needs usd and a derivation (the arithmetic, from sourced prices)`);
      continue;
    }
    out.judgementCeilings[k] = v as unknown as JudgementCeiling;
  }
  return problems.length ? { ok: false, problems } : { ok: true, prices: out };
}

export type Provider = "openai" | "anthropic";
export type TokenCounts = { freshInput: number; cachedInput: number; cacheWrite: number; output: number; reasoning: number };

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * One shape for every usage block the runner meets:
 *   OpenAI Responses   input_tokens (total), input_tokens_details.{cached_tokens,cache_write_tokens}, output_tokens
 *   OpenAI Chat        prompt_tokens (total), prompt_tokens_details.cached_tokens, completion_tokens
 *   Anthropic          input_tokens (uncached only), cache_read_input_tokens, cache_creation_input_tokens, output_tokens
 */
export function tokenCounts(usage: unknown, provider: Provider): TokenCounts | null {
  if (!isRecord(usage)) return null;
  if (provider === "anthropic") {
    return {
      freshInput: n(usage.input_tokens),
      cachedInput: n(usage.cache_read_input_tokens),
      cacheWrite: n(usage.cache_creation_input_tokens),
      output: n(usage.output_tokens),
      reasoning: isRecord(usage.output_tokens_details) ? n(usage.output_tokens_details.thinking_tokens) : 0,
    };
  }
  const chat = "prompt_tokens" in usage || "completion_tokens" in usage;
  const total = n(chat ? usage.prompt_tokens : usage.input_tokens);
  const details = (chat ? usage.prompt_tokens_details : usage.input_tokens_details) as Record<string, unknown> | undefined;
  const cached = Math.min(total, n(details?.cached_tokens));
  const written = Math.min(total - cached, n(details?.cache_write_tokens));
  const outDetails = (chat ? usage.completion_tokens_details : usage.output_tokens_details) as Record<string, unknown> | undefined;
  return {
    freshInput: total - cached - written,
    cachedInput: cached,
    cacheWrite: written,
    output: n(chat ? usage.completion_tokens : usage.output_tokens),
    reasoning: n(outDetails?.reasoning_tokens),
  };
}

export function costOfTokens(p: ModelPrice, t: TokenCounts): number | null {
  if (t.cacheWrite > 0 && p.cacheWritePerMTok === null) return null;
  const cachedRate = p.cachedInputPerMTok ?? p.inputPerMTok;
  return (
    (t.freshInput * p.inputPerMTok + t.cachedInput * cachedRate + t.cacheWrite * (p.cacheWritePerMTok ?? 0) + t.output * p.outputPerMTok) /
    1_000_000
  );
}

// ---------------------------------------------------------------------------
// Input bounds for the baseline builders, 1 token per character (a
// deliberate over-count; real text runs several characters per token) of
// everything the request carries: instructions, schema and input.
// ---------------------------------------------------------------------------

const WIDEST: SetSpec = (() => {
  const r = normaliseSetSpec({ bounds: { x: 200, z: 200, height: 100 }, objects: [{ shape: "box" }] });
  if (!r.ok) throw new Error("bound spec did not normalise");
  return r.spec;
})();

export function baselineInputBoundChars(attempt: "first" | "retry"): number {
  const fixed = SET_BUILDER_INSTRUCTIONS.length + JSON.stringify(SET_SPEC_JSON_SCHEMA).length;
  const brief = "x".repeat(SET_BRIEF_MAX_CHARS);
  const first = setBuildInput(brief).length;
  if (attempt === "first") return fixed + first;
  const mend = closeRetryInput(brief, describeOpenSides(WIDEST, ["+Z", "+X", "-Z", "-X"]), WIDEST);
  const marker = "Previous set: ";
  const at = mend.indexOf(marker);
  const mendOverhead = at >= 0 ? at + marker.length : mend.length;
  const retry = Math.max(mendOverhead + SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS, first + RETRY_SMALLER.length);
  return fixed + retry;
}

/**
 * A baseline's Match-this-shot read (Part E: gpt-5.4-mini): the instructions,
 * the schema and the line at 1 token per character, as for the text
 * baselines, plus the picture at the product's WHOLE match budget,
 * SET_MATCH_INPUT_TOKENS (3,300; set-config.ts puts the picture at about
 * 2,150 of it). The one mini read of a photo on record took 1,821 input
 * tokens in all (docs/ASTRA_SETS.md §1.1, "gpt-5.4-mini, same image"). A
 * read that bills past its reservation is an overshoot: the spend guard
 * records it and stops the run.
 */
export function matchBaselineInputBound(): number {
  return MATCH_SHOT_INSTRUCTIONS.length + JSON.stringify(MATCH_SHOT_JSON_SCHEMA).length + MATCH_SHOT_INPUT_TEXT.length + SET_MATCH_INPUT_TOKENS;
}

export type Transport = "batch" | "background" | "sync";

export type PriceBook = {
  astraFirstWorstUsd: number;
  astraRetryWorstUsd: number;
  astraBuildWorstUsd: number;
  /** A photo build's, at the photo caps: standard price always (photos never go on Batch). */
  astraPhotoFirstWorstUsd: number;
  astraPhotoRetryWorstUsd: number;
  astraPhotoBuildWorstUsd: number;
  /** One Match-this-shot read at the match caps: standard price always (a photo never goes on Batch). */
  astraMatchWorstUsd: number;
  batchMultiplier: number;
  gptImageUsd: number;
  costBasisUsdPerCredit: number;
  external: ExternalPrices;
  model(name: string): ModelPrice | null;
  image(engine: "gpt-image" | "flux" | "seedream"): number | null;
  judgement(key: JudgementKey): number | null;
  astraCost(usage: AstraUsage | null, transport: Transport): { billedUsd: number; standardUsd: number };
  modelCost(model: string, usage: unknown, provider: Provider): number | null;
  baselineAttemptWorstUsd(model: string, attempt: "first" | "retry"): number | null;
  /** A baseline's match read at matchBaselineInputBound and the match output cap; null while the model is unpriced. */
  matchBaselineWorstUsd(model: string): number | null;
  snapshot(): Record<string, unknown>;
};

export function makePriceBook(o: { external: ExternalPrices; gptImageUsd: number }): PriceBook {
  const first = worstCaseAstraUsd(SET_BUILD_INPUT_TOKENS, SET_BUILD_MAX_OUTPUT_TOKENS);
  const retry = worstCaseAstraUsd(SET_CLOSE_RETRY_INPUT_TOKENS, SET_BUILD_MAX_OUTPUT_TOKENS);
  // 4,800 × $12.50/1M + 16,000 × $50/1M = $0.06 + $0.80 = $0.86; the closing
  // retry 12,500 × $12.50/1M + $0.80 = $0.95625 (set-config.ts). Every retry
  // is reserved at the closing retry's, the dearer of the two.
  const photoFirst = worstCaseAstraUsd(SET_PHOTO_BUILD_INPUT_TOKENS, SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS);
  const photoRetry = worstCaseAstraUsd(SET_PHOTO_CLOSE_RETRY_INPUT_TOKENS, SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS);
  // 3,300 × $12.50/1M + 2,500 × $50/1M = $0.04125 + $0.125 = $0.16625 (set-config.ts).
  const match = worstCaseAstraUsd(SET_MATCH_INPUT_TOKENS, SET_MATCH_MAX_OUTPUT_TOKENS);
  // Every input token at the dearest input rate a model has a price for, and the output to its cap.
  const worstAt = (p: ModelPrice, input: number, output: number) => (input * Math.max(p.inputPerMTok, p.cacheWritePerMTok ?? 0) + output * p.outputPerMTok) / 1_000_000;
  // A response names a dated snapshot ("gpt-5.4-mini-2026-…"): the longest
  // priced name it starts with prices it.
  const model = (name: string): ModelPrice | null => {
    if (Object.prototype.hasOwnProperty.call(o.external.models, name)) return o.external.models[name] ?? null;
    const keys = Object.keys(o.external.models)
      .filter((k) => name.startsWith(`${k}-`))
      .sort((a, b) => b.length - a.length);
    return keys.length ? (o.external.models[keys[0]] ?? null) : null;
  };
  const book: PriceBook = {
    astraFirstWorstUsd: first,
    astraRetryWorstUsd: retry,
    astraBuildWorstUsd: first + retry,
    astraPhotoFirstWorstUsd: photoFirst,
    astraPhotoRetryWorstUsd: photoRetry,
    astraPhotoBuildWorstUsd: photoFirst + photoRetry,
    astraMatchWorstUsd: match,
    batchMultiplier: BATCH_MULTIPLIER,
    gptImageUsd: o.gptImageUsd,
    costBasisUsdPerCredit: COST_BASIS_USD_PER_CREDIT,
    external: o.external,
    model,
    image(engine) {
      if (engine === "gpt-image") return o.gptImageUsd;
      return o.external.images[IMAGE_KEYS[engine]]?.usdPerImage ?? null;
    },
    judgement(key) {
      return o.external.judgementCeilings[key]?.usd ?? null;
    },
    astraCost(usage, transport) {
      const standardUsd = costOfAstraUsageUsd(usage);
      return { billedUsd: transport === "batch" ? standardUsd * BATCH_MULTIPLIER : standardUsd, standardUsd };
    },
    modelCost(name, usage, provider) {
      const p = model(name);
      const t = tokenCounts(usage, provider);
      if (!p || !t) return null;
      return costOfTokens(p, t);
    },
    baselineAttemptWorstUsd(name, attempt) {
      const p = model(name);
      return p ? worstAt(p, baselineInputBoundChars(attempt), SET_BUILD_MAX_OUTPUT_TOKENS) : null;
    },
    matchBaselineWorstUsd(name) {
      const p = model(name);
      return p ? worstAt(p, matchBaselineInputBound(), SET_MATCH_MAX_OUTPUT_TOKENS) : null;
    },
    snapshot() {
      return {
        astra: {
          source: `src/lib/astra/prices.ts (read ${ASTRA_PRICES_READ_ON})`,
          firstWorstUsd: first,
          retryWorstUsd: retry,
          caps: { SET_BUILD_INPUT_TOKENS, SET_CLOSE_RETRY_INPUT_TOKENS, SET_BUILD_MAX_OUTPUT_TOKENS },
        },
        astraPhoto: {
          source: `src/lib/astra/prices.ts (read ${ASTRA_PRICES_READ_ON}); standard price, never Batch`,
          firstWorstUsd: photoFirst,
          retryWorstUsd: photoRetry,
          caps: { SET_PHOTO_BUILD_INPUT_TOKENS, SET_PHOTO_CLOSE_RETRY_INPUT_TOKENS, SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS },
        },
        astraMatch: {
          source: `src/lib/astra/prices.ts (read ${ASTRA_PRICES_READ_ON}); standard price, never Batch`,
          worstUsd: match,
          caps: { SET_MATCH_INPUT_TOKENS, SET_MATCH_MAX_OUTPUT_TOKENS },
        },
        matchBaselineInputBound: matchBaselineInputBound(),
        batch: { multiplier: BATCH_MULTIPLIER, source: BATCH_SOURCE },
        gptImageUsd: { value: o.gptImageUsd, source: "IMAGE_COST_USD, src/lib/admin/economics.ts" },
        costBasisUsdPerCredit: { value: COST_BASIS_USD_PER_CREDIT, source: "src/lib/generations/providers/video-models.ts" },
        external: o.external,
      };
    },
  };
  return book;
}
