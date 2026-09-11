import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAstraRequestBody } from "../../../src/lib/generations/providers/astra.ts";
import { photoBuildRequest, retryBuildRequest } from "../../../src/lib/sets/astra-request.ts";
import { SET_PHOTO_RULES, SET_SPEC_JSON_SCHEMA } from "../../../src/lib/sets/set-builder-prompt.ts";
import { SET_PHOTO_BUILD_EFFORT, SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS } from "../../../src/lib/sets/set-config.ts";
import { normaliseSetSpec } from "../../../src/lib/sets/set-spec.ts";
import { startPhotoBuild, type BuildState } from "./build-flow.mts";
import {
  astraJobRequest,
  batchLine,
  batchLineBody,
  customIdFor,
  evalSafetyId,
  interpretSonnet,
  mapHttpError,
  miniRequestBody,
  parseCustomId,
  photoJobRequest,
  sonnetRequestBody,
} from "./builders.mts";
import { REPO_ROOT } from "./util.mts";

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

describe("a photo build's request", () => {
  // A tiny JPEG-shaped data URL: the product's body builder checks the
  // shape of an image part, not its pixels.
  const photo = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64")}`;
  const notes = "the other half of the room is a bar";
  const build = (n = notes) => startPhotoBuild("al-ph-01-r1", { photoId: "ph-01", notes: n, sha256: "a".repeat(64) });
  const bytes = (req: Parameters<typeof buildAstraRequestBody>[0]) => JSON.stringify(buildAstraRequestBody(req));
  const spec = (() => {
    const n = normaliseSetSpec(JSON.parse(readFileSync(join(REPO_ROOT, "src/lib/sets/fixtures-showroom-open.json"), "utf8")));
    if (!n.ok) throw new Error("fixture");
    return n.spec;
  })();

  it("is byte for byte the product's photoBuildRequest for the same photo and notes", () => {
    for (const n of [notes, ""]) {
      const s = build(n);
      expect(bytes(photoJobRequest(s, photo, SET_PHOTO_BUILD_EFFORT, "a"))).toBe(bytes(photoBuildRequest(photo, n, evalSafetyId("a"))));
    }
  });

  it("carries the photo inline at detail high, the photo caps, store:false and background", () => {
    const body = buildAstraRequestBody(photoJobRequest(build(), photo, "low", "d"));
    expect(body.background).toBe(true);
    expect(body.store).toBe(false);
    expect(body.tools).toEqual([]);
    expect(body.max_output_tokens).toBe(SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS);
    expect(body.safety_identifier).toBe(evalSafetyId("d"));
    const content = (body.input as { content: Record<string, unknown>[] }[])[0].content;
    expect(content[0]).toEqual({ type: "input_text", text: SET_PHOTO_RULES });
    expect(content[1]).toEqual({ type: "input_image", image_url: photo, detail: "high" });
    expect(content[2]).toEqual({ type: "input_text", text: `Notes from the photographer: ${notes}` });
    // Only the arm's effort differs.
    const medium = buildAstraRequestBody(photoJobRequest(build(), photo, "medium", "d"));
    expect({ ...medium, reasoning: body.reasoning }).toEqual(body);
    expect(medium.reasoning).toEqual({ effort: "medium" });
  });

  it("every retry is the product's retryBuildRequest: the photo again, its notes, then the feedback", () => {
    const retries = [
      { kind: "retry-plain" as const, retry: { why: "again" as const, tooLong: false } },
      { kind: "retry-smaller" as const, retry: { why: "again" as const, tooLong: true } },
      { kind: "retry-close-mend" as const, retry: { why: "close" as const, openSides: ["+Z (north)"], previous: spec } },
    ];
    for (const { kind, retry } of retries) {
      const s: BuildState = { ...build(), attempts: 1, next: { input: "", kind, retry } };
      const product = retryBuildRequest({ kind: "photo", notes, photo }, retry, evalSafetyId("a"));
      if (!product) throw new Error("the product would resend a photo in hand");
      expect(bytes(photoJobRequest(s, photo, SET_PHOTO_BUILD_EFFORT, "a"))).toBe(bytes(product));
    }
    expect(() => photoJobRequest({ ...build(), attempts: 1, next: { input: "", kind: "retry-plain" } }, photo, "low", "a")).toThrow(/without its reason/);
  });

  it("never goes on Batch: a Batch line carries plain text only", () => {
    expect(() => batchLineBody(photoJobRequest(build(), photo, "low", "a"))).toThrow(/Files storage/);
    expect(() => batchLineBody(astraJobRequest("Brief: a harbour", "low", "a"))).not.toThrow();
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
