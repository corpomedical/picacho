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

describe("an Astra request with a picture in it (Sets from a photo, 2026-09-11)", () => {
  const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w==";
  const withImage = (image_url: string, detail = "high"): AstraJobRequest["input"] => [
    {
      role: "user",
      content: [
        { type: "input_text", text: "rules" },
        { type: "input_image", image_url, detail: detail as "high" },
      ],
    },
  ];

  it("sends the picture inline, with every fixed part still in place", () => {
    const body = buildAstraRequestBody(req({ input: withImage(jpeg) }));
    expect(body.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "rules" },
          { type: "input_image", image_url: jpeg, detail: "high" },
        ],
      },
    ]);
    expect(body.tools).toEqual([]);
    expect(body.store).toBe(false);
    expect(body.background).toBe(true);
    expect(body.text).toEqual({ format: { type: "json_schema", name: "s", schema: { type: "object" }, strict: true } });
  });

  it("reads the picture at detail high whatever the caller wrote", () => {
    const body = buildAstraRequestBody(req({ input: withImage(jpeg, "low") }));
    const parts = (body.input as { content: { detail?: string }[] }[])[0].content;
    expect(parts[1].detail).toBe("high");
  });

  it("accepts PNG and WebP bytes too", () => {
    expect(() => buildAstraRequestBody(req({ input: withImage("data:image/png;base64,iVBORw0KGgo=") }))).not.toThrow();
    expect(() => buildAstraRequestBody(req({ input: withImage("data:image/webp;base64,UklGRg==") }))).not.toThrow();
  });

  it("refuses a link of any kind: no capability URL to a person's file ever leaves", () => {
    for (const url of [
      "https://picacho.io/api/media/generated-images/u/sets/s.photo.jpg?v=abc",
      "/api/media/generated-images/u/sets/s.photo.jpg?v=abc",
      "https://example.supabase.co/storage/v1/object/sign/generated-images/x.jpg",
      "data:text/html;base64,PGgxPg==",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/jpeg;base64,not base64!",
    ]) {
      expect(() => buildAstraRequestBody(req({ input: withImage(url) })), url).toThrow();
    }
  });

  it("refuses a part that is neither text nor a picture, and a message that is not the person's", () => {
    const odd = [{ role: "user", content: [{ type: "input_file", file_url: "https://x" }] }] as unknown as AstraJobRequest["input"];
    expect(() => buildAstraRequestBody(req({ input: odd }))).toThrow();
    const system = [{ role: "system", content: [{ type: "input_text", text: "x" }] }] as unknown as AstraJobRequest["input"];
    expect(() => buildAstraRequestBody(req({ input: system }))).toThrow();
  });

  it("leaves a plain text input exactly as it was", () => {
    expect(buildAstraRequestBody(req({ input: "Brief: a harbour" })).input).toBe("Brief: a harbour");
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
