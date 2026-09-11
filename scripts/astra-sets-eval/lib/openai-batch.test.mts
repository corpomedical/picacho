import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lineToTransport, parseBatchResults } from "./openai-batch.mts";
import { NetGuard } from "./net-guard.mts";

// A Batch line is read by the product's own pollAstraJob, served from memory
// by the net guard: no network, and one interpreter.

const OUTPUT = [
  JSON.stringify({
    id: "batch_req_1",
    custom_id: "al-int-01-r1-a1",
    response: {
      status_code: 200,
      body: {
        id: "resp_abcdefgh12345678",
        status: "completed",
        usage: { input_tokens: 1800, output_tokens: 5000 },
        output: [{ type: "message", content: [{ type: "output_text", text: '{"title":"x"}' }] }],
      },
    },
    error: null,
  }),
  JSON.stringify({
    id: "batch_req_2",
    custom_id: "al-int-02-r1-a1",
    response: { status_code: 400, body: { error: { code: "unsupported_parameter", message: "background is not supported" } } },
    error: null,
  }),
].join("\n");
const ERRORS = JSON.stringify({ id: "batch_req_3", custom_id: "al-int-03-r1-a1", response: null, error: { code: "batch_expired", message: "expired" } });

let prevKey: string | undefined;
let prevFetch: typeof fetch;
beforeEach(() => {
  prevKey = process.env.OPENAI_API_KEY;
  prevFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key-not-real";
});
afterEach(() => {
  if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevKey;
  globalThis.fetch = prevFetch;
});

describe("Batch results", () => {
  it("parses output and error files by custom id", () => {
    const m = parseBatchResults(OUTPUT, ERRORS);
    expect([...m.keys()]).toEqual(["al-int-01-r1-a1", "al-int-02-r1-a1", "al-int-03-r1-a1"]);
    expect(m.get("al-int-03-r1-a1")?.error?.code).toBe("batch_expired");
  });

  it("reads a completed line through pollAstraJob, offline", async () => {
    const calls: string[] = [];
    const net = new NetGuard({ mode: "offline", realFetch: (async (u: RequestInfo | URL) => (calls.push(String(u)), new Response("no"))) as typeof fetch });
    globalThis.fetch = net.fetch;
    const m = parseBatchResults(OUTPUT, ERRORS);
    const done = await lineToTransport(m.get("al-int-01-r1-a1"), net, "completed");
    expect(done).toEqual({ state: "done", text: '{"title":"x"}', usage: { input_tokens: 1800, output_tokens: 5000 } });
    expect(calls).toEqual([]);
    expect(net.blocked).toEqual([]);
  });

  it("maps a rejected line, an expired line and a missing one", async () => {
    const net = new NetGuard({ mode: "offline", realFetch: prevFetch });
    const m = parseBatchResults(OUTPUT, ERRORS);
    expect(await lineToTransport(m.get("al-int-02-r1-a1"), net, "completed")).toMatchObject({ state: "submit-failed", kind: "bad_request", detail: expect.stringContaining("unsupported_parameter") });
    expect(await lineToTransport(m.get("al-int-03-r1-a1"), net, "expired")).toMatchObject({ state: "failed", kind: "expired" });
    expect(await lineToTransport(undefined, net, "expired")).toMatchObject({ state: "failed", kind: "expired" });
    expect(await lineToTransport(undefined, net, "failed", ["invalid_request: bad line"])).toMatchObject({ state: "submit-failed", kind: "bad_request", detail: expect.stringContaining("bad line") });
  });
});
