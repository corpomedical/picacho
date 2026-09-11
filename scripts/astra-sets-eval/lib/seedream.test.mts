import { describe, expect, it } from "vitest";
import { runSeedream, SEEDREAM_EDIT_ENDPOINT, SEEDREAM_SQUARE } from "./seedream.mts";

// The composed route's queue, over a scripted fal: submit, poll the status
// URL until COMPLETED, read the result. Nothing is sent anywhere.

const STATUS = "https://queue.fal.run/fal-ai/bytedance/requests/abc-123/status";
const RESULT = "https://queue.fal.run/fal-ai/bytedance/requests/abc-123";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const input = { prompt: "the composed prompt", imageUrls: ["data:image/jpeg;base64,AAAA", "data:image/jpeg;base64,BBBB"], imageSize: SEEDREAM_SQUARE };

function queue(script: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return script(url, init);
    },
  };
}

const noWait = { apiKey: "test-key", sleep: async () => {}, pollMs: 0 };

describe("runSeedream", () => {
  it("submits to the Angle Stage's endpoint with the composed prompt, the two pictures and the square size, then polls to the picture", async () => {
    let polls = 0;
    const q = queue((url) => {
      if (url === `https://queue.fal.run/${SEEDREAM_EDIT_ENDPOINT}`) return json({ request_id: "abc-123", status_url: STATUS, response_url: RESULT });
      if (url === STATUS) return json({ status: ++polls < 2 ? "IN_PROGRESS" : "COMPLETED" });
      if (url === RESULT) return json({ images: [{ url: "https://v3.fal.media/files/out.png" }] });
      return json({}, 404);
    });
    expect(await runSeedream(input, { ...noWait, fetch: q.fetch })).toEqual({ ok: true, url: "https://v3.fal.media/files/out.png", requestId: "abc-123" });
    const submit = q.calls[0];
    expect(submit.init.method).toBe("POST");
    expect(JSON.parse(String(submit.init.body))).toEqual({ prompt: input.prompt, image_urls: input.imageUrls, image_size: SEEDREAM_SQUARE });
    expect((submit.init.headers as Record<string, string>).authorization).toBe("Key test-key");
    expect(q.calls.map((c) => c.url)).toEqual([`https://queue.fal.run/${SEEDREAM_EDIT_ENDPOINT}`, STATUS, STATUS, RESULT]);
  });

  it("a refused submit keeps fal's status and words, as fal-image.ts words a FLUX error", async () => {
    const q = queue(() => json({ detail: [{ type: "content_policy_violation" }] }, 422));
    const r = await runSeedream(input, { ...noWait, fetch: q.fetch });
    expect(r).toMatchObject({ ok: false, stage: "submit", status: 422 });
    expect(!r.ok && r.detail).toMatch(/^fal\.ai \(Seedream\) error \(422\): .*content_policy_violation/);
  });

  it("never follows a status URL that is not fal's queue, and says when the queue fails or never finishes", async () => {
    const odd = queue(() => json({ request_id: "abc-123", status_url: "https://evil.example/status", response_url: RESULT }));
    expect(await runSeedream(input, { ...noWait, fetch: odd.fetch })).toMatchObject({ ok: false, stage: "submit" });
    expect(odd.calls).toHaveLength(1);
    const failed = queue((url) => (url.includes("/status") ? json({ status: "FAILED" }) : json({ request_id: "abc-123", status_url: STATUS, response_url: RESULT })));
    expect(await runSeedream(input, { ...noWait, fetch: failed.fetch })).toMatchObject({ ok: false, stage: "poll" });
    const slow = queue((url) => (url.includes("/status") ? json({ status: "IN_QUEUE" }) : json({ request_id: "abc-123", status_url: STATUS, response_url: RESULT })));
    expect(await runSeedream(input, { ...noWait, fetch: slow.fetch, timeoutMs: -1 })).toMatchObject({ ok: false, stage: "timeout" });
  });

  it("a submit with no answer may still have queued a job: it says so (the stills leg books it as a render)", async () => {
    const q = queue(() => Promise.reject(new TypeError("socket hang up")));
    expect(await runSeedream(input, { ...noWait, fetch: q.fetch })).toMatchObject({ ok: false, stage: "submit", status: -1 });
    expect(await runSeedream(input, { sleep: async () => {}, fetch: q.fetch, apiKey: "" })).toMatchObject({ ok: false, stage: "config" });
  });
});
