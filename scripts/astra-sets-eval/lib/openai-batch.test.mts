import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findBatchByInputFile, lineToTransport, parseBatchResults, reconcileRound, type BatchPage, type BatchRound } from "./openai-batch.mts";
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

  it("a rejected line is the request's fault; a line that never ran is not an attempt", async () => {
    const net = new NetGuard({ mode: "offline", realFetch: prevFetch });
    const m = parseBatchResults(OUTPUT, ERRORS);
    expect(await lineToTransport(m.get("al-int-02-r1-a1"), net, "completed")).toMatchObject({ state: "submit-failed", kind: "bad_request", detail: expect.stringContaining("unsupported_parameter") });
    // batch_expired, batch_cancelled, missing from the files, a per-line 429 or 5xx: billed nothing, sent again.
    expect(await lineToTransport(m.get("al-int-03-r1-a1"), net, "expired")).toMatchObject({ state: "not-run", detail: "batch_expired" });
    const cancelled = parseBatchResults(JSON.stringify({ custom_id: "x-a1", response: null, error: { code: "batch_cancelled", message: "" } })).get("x-a1");
    expect(await lineToTransport(cancelled, net, "cancelled")).toMatchObject({ state: "not-run" });
    expect(await lineToTransport(undefined, net, "expired")).toMatchObject({ state: "not-run" });
    expect(await lineToTransport(undefined, net, "completed")).toMatchObject({ state: "not-run" });
    for (const code of [429, 500, 503]) {
      const line = parseBatchResults(JSON.stringify({ custom_id: "y-a1", response: { status_code: code, body: { error: { code: "x" } } }, error: null })).get("y-a1");
      expect(await lineToTransport(line, net, "completed")).toMatchObject({ state: "not-run" });
    }
    const refused = parseBatchResults(JSON.stringify({ custom_id: "z-a1", response: { status_code: 403, body: { error: { code: "misalignment_policy_violation" } } }, error: null })).get("z-a1");
    expect(await lineToTransport(refused, net, "completed")).toMatchObject({ state: "submit-failed", kind: "refused" });
  });
});

describe("a create that got no answer", () => {
  const page = (data: Record<string, unknown>[], hasMore = false): BatchPage => ({ data, hasMore, lastId: data.length ? String(data[data.length - 1].id) : null });
  const t0 = "2026-09-11T10:00:00.000Z";
  const at = (minutes: number) => Date.parse(t0) / 1000 + minutes * 60;

  it("finds the batch by its input file and adopts it", async () => {
    const r = await findBatchByInputFile("file-mine", t0, async () => page([{ id: "batch_2", input_file_id: "file-other", created_at: at(1) }, { id: "batch_1", input_file_id: "file-mine", created_at: at(0) }], true));
    expect(r).toEqual({ found: { id: "batch_1", input_file_id: "file-mine", created_at: at(0) } });
  });

  it("absence is proven by listing everything, or by reaching batches from before the round (newest first)", async () => {
    expect(await findBatchByInputFile("file-mine", t0, async () => page([{ id: "b", input_file_id: "f", created_at: at(1) }]))).toMatchObject({ absent: expect.any(String) });
    const pages = [page([{ id: "b3", input_file_id: "f", created_at: at(2) }], true), page([{ id: "b2", input_file_id: "f", created_at: at(-60) }], true)];
    let n = 0;
    expect(await findBatchByInputFile("file-mine", t0, async () => pages[n++])).toMatchObject({ absent: expect.stringContaining("before the round") });
    expect(n).toBe(2);
  });

  it("proves nothing when the list fails, is not newest first, or never reaches the round's start", async () => {
    expect(await findBatchByInputFile("file-mine", t0, async () => Promise.reject(new Error("503")))).toMatchObject({ unknown: expect.stringContaining("503") });
    // Oldest first: an old batch on the first page proves nothing.
    const asc = [page([{ id: "b1", input_file_id: "f", created_at: at(-600) }, { id: "b2", input_file_id: "f", created_at: at(-500) }], true), page([], true)];
    let n = 0;
    expect(await findBatchByInputFile("file-mine", t0, async () => asc[Math.min(n++, 1)])).toMatchObject({ unknown: expect.any(String) });
    expect(await findBatchByInputFile("file-mine", t0, async () => page([{ id: "b", input_file_id: "f", created_at: at(5) }], true), 3)).toMatchObject({ unknown: expect.any(String) });
  });

  it("a round with no input file never sent a create", async () => {
    const dir = mkdtempSync(join(tmpdir(), "astra-batch-"));
    try {
      const rec: BatchRound = { round: 1, batchId: null, inputFileId: null, status: "uploading", lines: [], outputFileId: null, errorFileId: null, createdAt: t0, endedAt: null, collected: false, errors: [] };
      const lookup = async () => {
        throw new Error("must not look");
      };
      expect(await reconcileRound({ runDir: dir, rec, batches: { rounds: [rec] }, lookup })).toBe("absent");
      const withFile = { ...rec, inputFileId: "file-mine" };
      expect(await reconcileRound({ runDir: dir, rec: withFile, batches: { rounds: [withFile] }, lookup: async () => ({ found: { id: "batch_9", status: "in_progress" } }) })).toBe("attached");
      expect(withFile).toMatchObject({ batchId: "batch_9", status: "in_progress" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
