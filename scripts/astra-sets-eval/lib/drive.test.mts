import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startBuild, startPhotoBuild, type BuildRecord, type FlowDeps } from "./build-flow.mts";
import { closureOf, type RunContext } from "./context.mts";
import { driveBatch, loadState, personsItems, type BatchApi, type BuildJob } from "./drive.mts";
import type { LedgerInput } from "./ledger.mts";
import { NetGuard } from "./net-guard.mts";
import { BatchCreateUnknown, BatchNotCreated, parseBatchResults, submitRound, type BatchRound, type LineResult } from "./openai-batch.mts";
import { makePriceBook, type ExternalPrices } from "./prices.mts";
import { SpendGuard } from "./spend-guard.mts";
import { REPO_ROOT } from "./util.mts";

// The Batch driver against a scripted Batch API: no network. Lines OpenAI
// never ran cost nothing and are sent again as the same attempt; a batch
// that fails validation stops the run with every attempt still pending; a
// create with no answer keeps its money counted until a batch is proven
// absent; and a photo never gets into a Batch round.

const CLOSED = readFileSync(join(REPO_ROOT, "src/lib/sets/fixtures-showroom-closed.json"), "utf8");
const EMPTY: ExternalPrices = { models: { "claude-sonnet-5": null, "gpt-5.4-mini": null }, images: { "flux-2-pro-edit": null, "seedream-v4-edit": null }, judgementCeilings: {} };
const book = makePriceBook({ external: EMPTY, gptImageUsd: 0.17 });
const usage = { input_tokens: 1800, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1800 }, output_tokens: 5000 };
const deps: FlowDeps = { judgeWords: async () => "allowed", closureOf };

let dir: string;
let prevKey: string | undefined;
let prevFetch: typeof fetch;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "astra-drive-"));
  mkdirSync(join(dir, "answers"), { recursive: true });
  prevKey = process.env.OPENAI_API_KEY;
  prevFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key-not-real";
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevKey;
  globalThis.fetch = prevFetch;
});

function context(maxUsd = 10) {
  const events: LedgerInput[] = [];
  const guard = new SpendGuard({ maxUsd, sink: (e) => events.push(e) });
  const net = new NetGuard({ mode: "offline", realFetch: prevFetch });
  globalThis.fetch = net.fetch;
  const ctx = { part: "a", runId: "a-test", runDir: dir, dry: false, guard, book, net, interrupted: () => false, stopping: () => false, stopReason: () => null, progress: () => {} } as unknown as RunContext;
  return { ctx, guard, events };
}

function job(id = "al-int-01-r1"): BuildJob {
  return { state: startBuild(id, "a quiet showroom with one red car"), builder: "astra-low", effort: "low", provider: "openai", run: 1, briefId: "int-01", category: "interior", index: 0, transport: "batch" };
}

const completedLine = (customId: string): string =>
  JSON.stringify({
    custom_id: customId,
    response: { status_code: 200, body: { id: "resp_abcdefgh12345678", status: "completed", usage, output: [{ type: "message", content: [{ type: "output_text", text: CLOSED }] }] } },
    error: null,
  });

/** A scripted Batch API: round n ends with statuses[n-1] and returns results[n-1]. */
function scripted(statuses: string[], results: Map<string, LineResult>[], o: { errors?: string[] } = {}): BatchApi & { submitted: string[][] } {
  const submitted: string[][] = [];
  return {
    submitted,
    async submitRound(a) {
      submitted.push(a.lines.map((l) => l.customId));
      const rec: BatchRound = { round: a.round, batchId: `batch_${a.round}`, inputFileId: `file-${a.round}`, status: "validating", lines: a.lines, outputFileId: null, errorFileId: null, createdAt: new Date().toISOString(), endedAt: null, collected: false, errors: [] };
      a.batches.rounds.push(rec);
      return rec;
    },
    async awaitRound(a) {
      a.rec.status = statuses[a.rec.round - 1];
      a.rec.errors = o.errors ?? [];
      return true;
    },
    async collectRound(rec) {
      return results[rec.round - 1] ?? new Map();
    },
    async reconcileRound() {
      return "absent";
    },
  };
}

describe("driveBatch", () => {
  it("an expired line costs nothing, keeps its retry, and is sent again as the same attempt", async () => {
    const { ctx, guard, events } = context();
    const j = job();
    const api = scripted(["expired", "completed"], [new Map(), parseBatchResults(completedLine("al-int-01-r1-a1"))]);
    expect(await driveBatch(ctx, [j], [j], deps, { resume: false, api, pollMs: 0 })).toBe("done");
    expect(api.submitted).toEqual([["al-int-01-r1-a1"], ["al-int-01-r1-a1"]]);
    expect(j.state.final).toMatchObject({ status: "delivered", use: "answer", fromAttempt: 1 });
    expect(j.state.log).toHaveLength(1);
    const oneAttempt = book.astraCost(usage, "batch");
    expect(j.state.log[0].standardUsd).toBeCloseTo(oneAttempt.standardUsd, 12);
    expect(guard.settledUsd).toBeCloseTo(oneAttempt.billedUsd, 12);
    expect(guard.outstandingUsd).toBe(0);
    expect(events.filter((e) => e.ev === "release")).toHaveLength(1);
  });

  it("a per-line 5xx is sent again; a per-line 400 on a first attempt is not_run:rejected", async () => {
    const { ctx } = context();
    const a = job("al-a-r1");
    const b = job("al-b-r1");
    const five = JSON.stringify({ custom_id: "al-a-r1-a1", response: { status_code: 500, body: { error: { code: "server_error" } } }, error: null });
    const four = JSON.stringify({ custom_id: "al-b-r1-a1", response: { status_code: 400, body: { error: { code: "unsupported_parameter" } } }, error: null });
    const api = scripted(["completed", "completed"], [parseBatchResults(five + "\n" + four), parseBatchResults(completedLine("al-a-r1-a1"))]);
    await driveBatch(ctx, [a, b], [a, b], deps, { resume: false, api, pollMs: 0 });
    expect(a.state.final).toMatchObject({ status: "delivered" });
    expect(b.state.final).toMatchObject({ status: "failed", failure: "not_run:rejected" });
  });

  it("a batch that failed validation stops the run, releases its money and leaves every attempt pending", async () => {
    const { ctx, guard } = context();
    const j = job();
    const api = scripted(["failed"], [], { errors: ["token_limit_exceeded: enqueued token limit"] });
    await expect(driveBatch(ctx, [j], [j], deps, { resume: false, api, pollMs: 0 })).rejects.toThrow(/failed validation.*nothing was billed/);
    expect(j.state.final).toBeNull();
    expect(j.state.next?.kind).toBe("first");
    expect(j.state.log).toHaveLength(0);
    expect(guard.outstandingUsd).toBe(0);
    expect(loadState(dir)?.[0].state.next?.kind).toBe("first");
  });

  it("a create with no answer keeps its reservation until a batch is proven absent", async () => {
    const unknown = context();
    const j = job();
    const api = scripted([], []);
    const failing = (err: Error): BatchApi => ({
      ...api,
      async submitRound(a) {
        a.batches.rounds.push({ round: a.round, batchId: null, inputFileId: "file-1", status: "create-unanswered", lines: a.lines, outputFileId: null, errorFileId: null, createdAt: new Date().toISOString(), endedAt: null, collected: false, errors: [] });
        throw err;
      },
    });
    await expect(driveBatch(unknown.ctx, [j], [j], deps, { resume: false, api: failing(new BatchCreateUnknown("list failed")), pollMs: 0 })).rejects.toBeInstanceOf(BatchCreateUnknown);
    expect(unknown.guard.outstandingUsd).toBeCloseTo(book.astraFirstWorstUsd * book.batchMultiplier, 12);

    rmSync(join(dir, "batches.json"), { force: true });
    const absent = context();
    const k = job();
    await expect(driveBatch(absent.ctx, [k], [k], deps, { resume: false, api: failing(new BatchNotCreated("none found")), pollMs: 0 })).rejects.toBeInstanceOf(BatchNotCreated);
    expect(absent.guard.outstandingUsd).toBe(0);
    expect(k.state.next?.kind).toBe("first");
  });

  it("refuses a photo build before it reserves or sends anything: photos never go into a Batch input file", async () => {
    const { ctx, guard, events } = context();
    const text = job("al-int-01-r1");
    const photo: BuildJob = { ...job("al-ph-01-r1"), state: startPhotoBuild("al-ph-01-r1", { photoId: "ph-01", notes: "", sha256: "a".repeat(64) }) };
    const api = scripted(["completed"], []);
    await expect(driveBatch(ctx, [text, photo], [text, photo], deps, { resume: false, api, pollMs: 0 })).rejects.toThrow(/photos never go into a Batch input file/);
    expect(api.submitted).toEqual([]);
    expect(events).toEqual([]);
    expect(guard.outstandingUsd).toBe(0);
    expect(photo.state.next?.kind).toBe("first");
  });

  it("the upload step refuses a round whose file would carry an image, before anything is written or sent", async () => {
    const calls: string[] = [];
    const net = new NetGuard({ mode: "live", realFetch: (async (u: RequestInfo | URL) => (calls.push(String(u)), new Response("{}"))) as typeof fetch });
    globalThis.fetch = net.fetch;
    const batches = { rounds: [] as BatchRound[] };
    const line = { customId: "al-ph-01-r1-a1", buildId: "al-ph-01-r1", attempt: 1, kind: "first" as const, ticket: "t1", worstUsd: 0.43 };
    const body = { input: [{ role: "user", content: [{ type: "input_image", image_url: "data:image/jpeg;base64,/9j/", detail: "high" }] }] };
    await expect(submitRound({ runDir: dir, round: 1, lines: [line], bodies: new Map([[line.customId, body]]), metadata: {}, batches })).rejects.toThrow(/would upload an image/);
    expect(calls).toEqual([]);
    expect(batches.rounds).toEqual([]);
    expect(existsSync(join(dir, "batch-round1.jsonl"))).toBe(false);
  });

  it("the persons sheet carries every parsed answer's words: valid ones, and a photo answer set aside for want of its own camera 1", () => {
    const { ctx } = context();
    const noCameras = JSON.stringify({ ...(JSON.parse(CLOSED) as Record<string, unknown>), cameras: [] });
    writeFileSync(join(dir, "answers/a1.txt"), CLOSED);
    writeFileSync(join(dir, "answers/a2.txt"), noCameras);
    writeFileSync(join(dir, "answers/a3.txt"), "{ not json");
    const attempt = (n: number, outcome: string) => ({ attempt: n, kind: "first" as const, transport: "background" as const, outcome, usage: null, billedUsd: 0, standardUsd: 0, answerFile: `answers/a${n}.txt` });
    const rec = { builder: "astra-low", buildId: "al-ph-01-r1", briefId: "ph-01", attempts: [attempt(1, "valid"), attempt(2, "no_first_camera"), attempt(3, "not_json")] } as unknown as BuildRecord;
    const items = personsItems(ctx, [rec], () => true);
    expect(items.map((i) => i.source.attempt)).toEqual([1, 2]);
    expect(items[0].text).toContain(JSON.parse(CLOSED).title);
  });

  it("a round the spend guard cannot reserve stays pending", async () => {
    const { ctx, guard } = context(0.1);
    const j = job();
    const api = scripted(["completed"], []);
    expect(await driveBatch(ctx, [j], [j], deps, { resume: false, api, pollMs: 0 })).toBe("done");
    expect(api.submitted).toEqual([]);
    expect(guard.stopped?.reason).toBe("budget");
    expect(j.state.final).toBeNull();
    expect(j.state.next?.kind).toBe("first");
  });
});
