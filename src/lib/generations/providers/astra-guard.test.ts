import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ASTRA_MODEL, buildAstraRequestBody, type AstraJobRequest } from "./astra";
import { openAiSafetyId } from "../../openai/safety-id";

// The fence around gpt-6-astra (2026-09-10). Astra is the dearest model the
// app calls ($50 per million output tokens), it takes no temperature, and
// its hosted tools can make pictures and run code outside every gate we
// own. So it is reachable from exactly one file, and every request that
// file builds carries the same fixed parts.

const SRC = join(__dirname, "..", "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [p] : [];
  });
}

const req = (over: Partial<AstraJobRequest> = {}): AstraJobRequest => ({
  instructions: "i",
  input: "b",
  schemaName: "s",
  schema: { type: "object" },
  maxOutputTokens: 10_000,
  effort: "low",
  safetyIdentifier: "abc",
  ...over,
});

describe("gpt-6-astra is reachable from one file", () => {
  it("no other source file names the model", () => {
    const offenders = walk(SRC)
      .filter((f) => !f.endsWith("providers/astra.ts") && !f.endsWith(".test.ts"))
      .filter((f) => readFileSync(f, "utf8").includes("gpt-6-astra"))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("the client names it once, as the constant", () => {
    expect(ASTRA_MODEL).toBe("gpt-6-astra");
  });
});

describe("every Astra request", () => {
  const body = buildAstraRequestBody(req());

  it("offers no tools: no hosted image generation, code sandbox or web search", () => {
    expect(body.tools).toEqual([]);
  });

  it("runs in the background and is not stored", () => {
    expect(body.background).toBe(true);
    expect(body.store).toBe(false);
  });

  it("answers in strict structured output", () => {
    expect(body.text).toEqual({ format: { type: "json_schema", name: "s", schema: { type: "object" }, strict: true } });
  });

  it("never sends the sampling parameters the model rejects", () => {
    for (const key of ["temperature", "top_p", "seed", "logprobs", "top_logprobs"]) expect(body).not.toHaveProperty(key);
  });

  it("carries the safety identifier when there is one, and nothing when not", () => {
    expect(body.safety_identifier).toBe("abc");
    expect(buildAstraRequestBody(req({ safetyIdentifier: undefined }))).not.toHaveProperty("safety_identifier");
  });

  it("holds effort to low or medium whatever a caller asks", () => {
    expect(buildAstraRequestBody(req({ effort: "medium" })).reasoning).toEqual({ effort: "medium" });
    for (const e of ["xhigh", "max", "high", "none"]) {
      expect(buildAstraRequestBody(req({ effort: e as AstraJobRequest["effort"] })).reasoning).toEqual({ effort: "low" });
    }
  });

  it("always caps the answer", () => {
    expect(buildAstraRequestBody(req({ maxOutputTokens: 1e9 })).max_output_tokens).toBe(32_000);
    expect(buildAstraRequestBody(req({ maxOutputTokens: 0 })).max_output_tokens).toBe(256);
  });
});

describe("openAiSafetyId", () => {
  it("is stable, opaque and per person", () => {
    const prev = process.env.OPENAI_SAFETY_ID_SECRET;
    process.env.OPENAI_SAFETY_ID_SECRET = "test-secret";
    try {
      const a = openAiSafetyId("11111111-1111-1111-1111-111111111111");
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(openAiSafetyId("11111111-1111-1111-1111-111111111111")).toBe(a);
      expect(openAiSafetyId("22222222-2222-2222-2222-222222222222")).not.toBe(a);
      expect(a).not.toContain("1111");
      expect(openAiSafetyId("")).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.OPENAI_SAFETY_ID_SECRET;
      else process.env.OPENAI_SAFETY_ID_SECRET = prev;
    }
  });
});
