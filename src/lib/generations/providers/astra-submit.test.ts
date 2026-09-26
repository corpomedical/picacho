import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { submitAstraJob, type AstraJobRequest } from "./astra";

// Which submit failures OpenAI certainly never billed (Helios Cut 4, step
// A2, 2026-09-26 — critic item 1). A caller gives a try back only for
// those: the request is sent with background: true, so a POST that threw
// after sending, a 5xx that is not OpenAI's own error, or a 200 with no
// response id may all have left a job running that bills up to $0.62.

const req: AstraJobRequest = {
  instructions: "i",
  input: "b",
  schemaName: "s",
  schema: { type: "object" },
  maxOutputTokens: 10_000,
  effort: "low",
  safetyIdentifier: "abc",
};

const reply = (status: number, body: string) => async () => new Response(body, { status, headers: { "content-type": "application/json" } });
const openAiError = (code: string) => JSON.stringify({ error: { code, message: "m" } });

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "sk-test-only");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a submit OpenAI never billed", () => {
  it("is one that never left: no key, or a part this client will not send", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await submitAstraJob(req)).toMatchObject({ ok: false, kind: "config", neverBilled: true });
    vi.stubEnv("OPENAI_API_KEY", "sk-test-only");
    const linked = { ...req, input: [{ role: "user" as const, content: [{ type: "input_image" as const, image_url: "https://example.com/a.jpg", detail: "high" as const }] }] };
    expect(await submitAstraJob(linked)).toMatchObject({ ok: false, kind: "bad_request", neverBilled: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is one OpenAI answered without a job: 401/403, 429, another 4xx, a 5xx with its own error body", async () => {
    for (const [status, kind] of [
      [401, "config"],
      [403, "config"],
      [429, "rate_limited"],
      [400, "bad_request"],
      [500, "unavailable"],
      [503, "unavailable"],
    ] as const) {
      vi.stubGlobal("fetch", reply(status, openAiError("server_error")));
      expect(await submitAstraJob(req), String(status)).toMatchObject({ ok: false, kind, neverBilled: true });
    }
  });
});

describe("a submit that may have been billed", () => {
  it("keeps its try: a POST that threw, a 5xx with no OpenAI error, a 200 with no response id, a misalignment refusal", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("socket hang up");
    });
    expect(await submitAstraJob(req)).toMatchObject({ ok: false, kind: "unavailable", neverBilled: false });
    vi.stubGlobal("fetch", reply(502, "<html>Bad gateway</html>"));
    expect(await submitAstraJob(req)).toMatchObject({ ok: false, kind: "unavailable", neverBilled: false });
    vi.stubGlobal("fetch", reply(504, JSON.stringify({ message: "timeout" })));
    expect(await submitAstraJob(req)).toMatchObject({ ok: false, kind: "unavailable", neverBilled: false });
    vi.stubGlobal("fetch", reply(200, JSON.stringify({ status: "queued" })));
    expect(await submitAstraJob(req)).toMatchObject({ ok: false, kind: "unavailable", neverBilled: false });
    // A refusal at submit stays counted (the owner's decision D13).
    vi.stubGlobal("fetch", reply(400, openAiError("misalignment_policy_violation")));
    expect(await submitAstraJob(req)).toMatchObject({ ok: false, kind: "refused", neverBilled: false });
  });

  it("is not a failure when OpenAI hands back a job", async () => {
    vi.stubGlobal("fetch", reply(200, JSON.stringify({ id: "resp_abcdefgh123", status: "queued" })));
    expect(await submitAstraJob(req)).toEqual({ ok: true, responseId: "resp_abcdefgh123" });
  });
});
