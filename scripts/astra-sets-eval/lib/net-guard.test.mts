import { describe, expect, it } from "vitest";
import { classifyUrl, NetGuard, NetGuardBlocked, withNetContext, type MeterRecord } from "./net-guard.mts";

const live = { mode: "live" as const, loopbackPorts: new Set([4321]) };
const offline = { mode: "offline" as const, loopbackPorts: new Set([4321]) };

describe("classifyUrl", () => {
  it("blocks the database, always", () => {
    for (const u of ["https://abcd.supabase.co/rest/v1/policy_refusals", "https://x.supabase.in/storage/v1/object", "https://supabase.co"]) {
      expect(classifyUrl(u, live).verdict).toBe("blocked");
    }
  });

  it("allows the providers live, and blocks them offline", () => {
    for (const u of ["https://api.openai.com/v1/responses", "https://api.anthropic.com/v1/messages", "https://fal.run/fal-ai/flux-2-pro/edit", "https://queue.fal.run/x", "https://v3.fal.media/files/a.png"]) {
      expect(classifyUrl(u, live).verdict).toBe("live");
      expect(classifyUrl(u, offline).verdict).toBe("blocked");
    }
    expect(classifyUrl("http://api.openai.com/v1/responses", live).verdict).toBe("blocked");
  });

  it("serves eval.invalid locally, passes data:, and blocks unknown hosts and unregistered loopback", () => {
    expect(classifyUrl("https://eval.invalid/ref/abc.jpg", offline)).toEqual({ verdict: "local", key: "ref/abc.jpg" });
    expect(classifyUrl("data:image/png;base64,AAAA", offline).verdict).toBe("data");
    expect(classifyUrl("http://127.0.0.1:4321/", offline).verdict).toBe("loopback");
    expect(classifyUrl("ws://127.0.0.1:4321/devtools", offline).verdict).toBe("loopback");
    expect(classifyUrl("http://127.0.0.1:9999/", live).verdict).toBe("blocked");
    expect(classifyUrl("http://localhost:3000/", live).verdict).toBe("blocked");
    expect(classifyUrl("https://example.com/", live).verdict).toBe("blocked");
    expect(classifyUrl("https://rest.alpha.fal.ai/storage/upload/initiate", live).verdict).toBe("blocked");
    expect(classifyUrl("file:///etc/passwd", live).verdict).toBe("blocked");
  });
});

function fakeFetch(calls: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ model: "gpt-5.4-mini-2026-01-01", usage: { prompt_tokens: 10, completion_tokens: 5 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("NetGuard", () => {
  it("meters JSON usage, except inside a settled context", async () => {
    const calls: string[] = [];
    const g = new NetGuard({ mode: "live", realFetch: fakeFetch(calls) });
    const meters: MeterRecord[] = [];
    g.onMeter = (m) => meters.push(m);
    await g.fetch("https://api.openai.com/v1/chat/completions", { method: "POST", body: "{}" });
    await withNetContext({ settled: true, tag: "astra" }, () => g.fetch("https://api.openai.com/v1/responses", { method: "POST", body: "{}" }));
    await withNetContext({ tag: "words-gate", ref: "b1-a1" }, () => g.fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: "{}" }));
    expect(calls).toHaveLength(3);
    expect(meters).toHaveLength(2);
    expect(meters[0].model).toBe("gpt-5.4-mini-2026-01-01");
    expect(meters[1].ctx).toMatchObject({ tag: "words-gate", ref: "b1-a1" });
  });

  it("throws on a blocked host without calling out, and records it", async () => {
    const calls: string[] = [];
    const g = new NetGuard({ mode: "offline", realFetch: fakeFetch(calls) });
    await expect(g.fetch("https://api.openai.com/v1/responses")).rejects.toBeInstanceOf(NetGuardBlocked);
    await expect(g.fetch("https://db.supabase.co/rest/v1/x")).rejects.toThrow(/db\.supabase\.co/);
    expect(calls).toEqual([]);
    expect(g.blocked.map((b) => b.host)).toEqual(["api.openai.com", "db.supabase.co"]);
    expect(g.liveCalls).toBe(0);
  });

  it("serves stored responses and local routes in any mode", async () => {
    const g = new NetGuard({ mode: "offline", realFetch: fakeFetch([]) });
    g.setOpenAiResponse("resp_abcdefgh1234", { status: "completed" });
    const r = await g.fetch("https://api.openai.com/v1/responses/resp_abcdefgh1234");
    expect(await r.json()).toEqual({ status: "completed" });
    const url = g.setLocalRoute("ref/x.jpg", { body: "bytes", contentType: "image/jpeg" });
    expect(await (await g.fetch(url)).text()).toBe("bytes");
    expect((await g.fetch("https://eval.invalid/missing")).status).toBe(404);
  });

  it("allows the batch upload only from the batch step, and fal.media only for downloads", async () => {
    const g = new NetGuard({ mode: "live", realFetch: fakeFetch([]) });
    await expect(g.fetch("https://api.openai.com/v1/files", { method: "POST", body: "x" })).rejects.toThrow(/file upload/);
    await expect(withNetContext({ tag: "batch-upload" }, () => g.fetch("https://api.openai.com/v1/files", { method: "POST", body: "x" }))).resolves.toBeInstanceOf(Response);
    await expect(g.fetch("https://v3.fal.media/files/upload", { method: "PUT", body: "x" })).rejects.toThrow(/download-only/);
  });

  it("reports each live call's status to an observing context", async () => {
    const g = new NetGuard({ mode: "live", realFetch: fakeFetch([]) });
    const observe = { status: null as number | null };
    await withNetContext({ observe }, () => g.fetch("https://api.openai.com/v1/responses/resp_abcdefgh1234"));
    expect(observe.status).toBe(200);
    const failing = new NetGuard({ mode: "live", realFetch: (async () => { throw new TypeError("socket hang up"); }) as typeof fetch });
    await expect(withNetContext({ observe }, () => failing.fetch("https://api.openai.com/v1/responses/resp_abcdefgh1234"))).rejects.toThrow();
    expect(observe.status).toBe(-1);
  });

  it("taps the prompt sent to an image edit", async () => {
    const g = new NetGuard({ mode: "live", realFetch: fakeFetch([]) });
    const taps: string[] = [];
    g.onPromptTap = (t) => taps.push(t.prompt);
    const form = new FormData();
    form.set("prompt", "the prompt the engine saw");
    await g.fetch("https://api.openai.com/v1/images/edits", { method: "POST", body: form });
    await g.fetch("https://fal.run/fal-ai/flux-2-pro/edit", { method: "POST", body: JSON.stringify({ prompt: "fal prompt" }) });
    expect(taps).toEqual(["the prompt the engine saw", "fal prompt"]);
  });
});
