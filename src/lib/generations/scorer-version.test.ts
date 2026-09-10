import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCORER_MODEL,
  IDENTITY_PROMPT_REVISION,
  identityScorerVersion,
} from "./scorer-version";

// Provenance for identity scores (2026-09-07).
//
// Every score written before today is a bare number: the model came from an
// env var that can change under us and the prompt has been edited more than
// once, so scores from different months were never guaranteed comparable and
// nothing recorded which was which.
//
// What this file exists to catch: a stamp that stops distinguishing the things
// it exists to distinguish. A version that is constant across models, or
// across prompt revisions, is worse than no version at all — it would assert
// comparability that is not there.

describe("the stamp stored beside every score", () => {
  it("names the model and the prompt revision", () => {
    expect(identityScorerVersion("gpt-5.4-mini")).toBe(`gpt-5.4-mini/p${IDENTITY_PROMPT_REVISION}`);
  });

  it("distinguishes two models", () => {
    expect(identityScorerVersion("model-a")).not.toBe(identityScorerVersion("model-b"));
  });

  // The whole point: a prompt change must split the dataset rather than pool
  // incomparable numbers under one label.
  it("carries the revision, so a prompt change splits the data", () => {
    expect(identityScorerVersion("m")).toContain(`/p${IDENTITY_PROMPT_REVISION}`);
    expect(identityScorerVersion("m")).toMatch(/\/p\d+$/);
  });

  it("falls back to the documented default rather than an empty stamp", () => {
    // An unset env var must not produce "/p1", which would read as a real
    // version and pool every unstamped score together.
    for (const missing of [undefined, null, "", "   "]) {
      expect(identityScorerVersion(missing)).toBe(`${DEFAULT_SCORER_MODEL}/p${IDENTITY_PROMPT_REVISION}`);
    }
  });

  it("is stable for the same input, so a score can be grouped by it", () => {
    expect(identityScorerVersion("m")).toBe(identityScorerVersion("m"));
  });
});

// The fallback is duplicated in providers/openai.ts, which reads the same env
// var to build its request. If the two drift, a score is stamped with a model
// that did not produce it — the exact failure this whole record exists to
// prevent. Pinned by reading the source, the way truth-contracts.test.ts does
// for modules a test cannot import.
describe("the fallback model matches the one actually called", () => {
  it("agrees with providers/openai-model.ts, which openai.ts uses for both the request and the stamp", async () => {
    const { DEFAULT_UTILITY_MODEL } = await import("./providers/openai-model");
    expect(DEFAULT_UTILITY_MODEL).toBe(DEFAULT_SCORER_MODEL);
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./providers/openai.ts", import.meta.url), "utf8");
    // The scorer asks utilityModel() for its model and stamps the same call's
    // answer — never the raw env var, which can name a model it refused.
    expect(src).toContain("const model = utilityModel();");
    expect(src).toContain("scorerVersion: identityScorerVersion(utilityModel())");
    expect(src).not.toContain("process.env.OPENAI_MODEL");
  });
});

describe("GPT-6 models never become the utility reader", () => {
  it("refuses a gpt-6 value and falls back to the default", async () => {
    const { utilityModel, DEFAULT_UTILITY_MODEL } = await import("./providers/openai-model");
    const prev = process.env.OPENAI_MODEL;
    try {
      process.env.OPENAI_MODEL = "gpt-6-astra";
      expect(utilityModel()).toBe(DEFAULT_UTILITY_MODEL);
      process.env.OPENAI_MODEL = "gpt-5.4";
      expect(utilityModel()).toBe("gpt-5.4");
      delete process.env.OPENAI_MODEL;
      expect(utilityModel()).toBe(DEFAULT_UTILITY_MODEL);
    } finally {
      if (prev === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = prev;
    }
  });

  it("no reader reads OPENAI_MODEL directly any more", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["./providers/openai.ts", "./output-policy.ts", "./content-policy.ts", "./providers/describe-image.ts"]) {
      expect(readFileSync(new URL(f, import.meta.url), "utf8"), f).not.toContain("process.env.OPENAI_MODEL");
    }
  });
});
