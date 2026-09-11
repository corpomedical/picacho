import { describe, expect, it } from "vitest";
import { buildAstraRequestBody } from "../../../src/lib/generations/providers/astra.ts";
import { SET_SPEC_JSON_SCHEMA } from "../../../src/lib/sets/set-builder-prompt.ts";
import { astraJobRequest, batchLine, batchLineBody, customIdFor, evalSafetyId, interpretSonnet, mapHttpError, miniRequestBody, parseCustomId, sonnetRequestBody } from "./builders.mts";

describe("the Batch line", () => {
  const req = astraJobRequest("Brief: a quiet harbour", "low", "a");

  it("is the product body minus `background`, and nothing else", () => {
    const product = buildAstraRequestBody(req);
    const line = batchLineBody(req);
    expect(line).not.toHaveProperty("background");
    const { background, ...rest } = product;
    expect(background).toBe(true);
    expect(line).toEqual(rest);
  });

  it("keeps every fixed part of the product request", () => {
    const line = batchLineBody(req);
    expect(line.tools).toEqual([]);
    expect(line.store).toBe(false);
    expect(line.text).toEqual({ format: { type: "json_schema", name: "picacho_set", schema: SET_SPEC_JSON_SCHEMA, strict: true } });
    expect(line.max_output_tokens).toBe(10_000);
    expect(line.prompt_cache_options).toEqual({ ttl: "30m" });
    expect(line.safety_identifier).toBe(evalSafetyId("a"));
    for (const k of ["temperature", "top_p", "seed", "logprobs"]) expect(line).not.toHaveProperty(k);
    expect(batchLineBody(astraJobRequest("x", "medium", "a")).reasoning).toEqual({ effort: "medium" });
    expect(batchLineBody({ ...req, effort: "max" as never }).reasoning).toEqual({ effort: "low" });
  });

  it("the eval's safety identifier is the production shape, fixed per part, and no secret", () => {
    expect(evalSafetyId("d")).toMatch(/^[0-9a-f]{64}$/);
    expect(evalSafetyId("d")).toBe(evalSafetyId("d"));
    expect(evalSafetyId("d")).not.toBe(evalSafetyId("a"));
  });

  it("custom ids round-trip", () => {
    expect(customIdFor("al-int-01-r2", 2)).toBe("al-int-01-r2-a2");
    expect(parseCustomId("al-int-01-r2-a2")).toEqual({ buildId: "al-int-01-r2", attempt: 2 });
    expect(batchLine("x-a1", { a: 1 })).toEqual({ custom_id: "x-a1", method: "POST", url: "/v1/responses", body: { a: 1 } });
  });

  it("maps line errors the way submitAstraJob maps them", () => {
    expect(mapHttpError(403, "misalignment_policy_violation")).toBe("refused");
    expect(mapHttpError(403, undefined)).toBe("config");
    expect(mapHttpError(401, undefined)).toBe("config");
    expect(mapHttpError(429, undefined)).toBe("rate_limited");
    expect(mapHttpError(503, undefined)).toBe("unavailable");
    expect(mapHttpError(400, "invalid_request_error")).toBe("bad_request");
  });
});

describe("the baselines", () => {
  it("mini: the same instructions and strict schema, no sampling or reasoning fields", () => {
    const b = miniRequestBody("Brief: x");
    expect(b.model).toBe("gpt-5.4-mini");
    expect(b.store).toBe(false);
    expect(b.max_output_tokens).toBe(10_000);
    expect((b.text as { format: { strict: boolean } }).format.strict).toBe(true);
    for (const k of ["temperature", "top_p", "seed", "reasoning", "background"]) expect(b).not.toHaveProperty(k);
  });

  it("sonnet: structured output or the schema in the system prompt; never a temperature", () => {
    const f = sonnetRequestBody("Brief: x", "format");
    expect(f.model).toBe("claude-sonnet-5");
    expect(f.max_tokens).toBe(10_000);
    expect(f.output_config).toEqual({ format: { type: "json_schema", schema: SET_SPEC_JSON_SCHEMA }, effort: "low" });
    const p = sonnetRequestBody("Brief: x", "prompt");
    expect(String(p.system)).toContain(JSON.stringify(SET_SPEC_JSON_SCHEMA));
    expect(p.output_config).toEqual({ effort: "low" });
    for (const b of [f, p]) expect(b).not.toHaveProperty("temperature");
  });

  it("reads Sonnet's stop reasons", () => {
    const usage = { input_tokens: 10, output_tokens: 20 };
    expect(interpretSonnet({ stop_reason: "end_turn", content: [{ type: "text", text: '{"a":' }, { type: "text", text: "1}" }], usage })).toEqual({ state: "done", text: '{"a":1}', usage });
    expect(interpretSonnet({ stop_reason: "max_tokens", content: [], usage })).toMatchObject({ state: "failed", kind: "incomplete" });
    expect(interpretSonnet({ stop_reason: "refusal", content: [], usage })).toMatchObject({ state: "failed", kind: "refused" });
    expect(interpretSonnet({ stop_reason: "tool_use", content: [], usage })).toMatchObject({ state: "failed", kind: "failed" });
    expect(interpretSonnet({ stop_reason: "end_turn", content: [], usage })).toMatchObject({ state: "failed", kind: "failed" });
  });
});
