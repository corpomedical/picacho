// OpenAI Batch plumbing for Astra builds (half the standard price,
// docs/ASTRA_SETS.md §1.2). Nothing in src/ does Batch; this is the only
// Batch code, and it reuses the product for everything else:
//
//   the line body   buildAstraRequestBody minus `background` (builders.mts)
//   the answer      each line's stored response is served by the net guard at
//                   GET /v1/responses/<id>, and the product's own
//                   pollAstraJob reads it — one interpreter, no copy
//   line errors     mapped like submitAstraJob: misalignment → refused,
//                   401/403 → config, else bad_request; a 429 or 5xx line
//                   never ran (below)
//
// Flow per round: write the input JSONL → POST /v1/files (purpose "batch":
// the one upload the runner makes, blind eval briefs only — a round whose
// file would carry an image is refused before anything is written or
// uploaded: photos never go to OpenAI's Files storage) → POST /v1/batches
// → the batch id is written to batches.json BEFORE any polling, so --resume
// can re-attach → GET /v1/batches/<id> every 60 s → download the output and
// error files. Ctrl-C leaves a batch running, to be resumed.
//
// A CREATE WITH NO ANSWER is not "no batch": OpenAI may have accepted it and
// only the answer was lost (or the process died waiting). Then the runner
// lists the organisation's batches and looks for this round's input file
// (a file id only this round's create could have used). Found: the batch is
// adopted. Proven absent: the round's reservations are released. Anything
// else: they stay reserved, and the run stops (--resume looks again).
//
// LINES THAT NEVER RAN — an expired or cancelled batch's unfinished lines, a
// line missing from the output, a per-line 429 or 5xx — are billed nothing
// and are not an attempt of the build: processRound (drive.mts) releases
// their tickets and sends the same attempt in the next round.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pollAstraJob } from "../../../src/lib/generations/providers/astra.ts";
import { fetchWithTimeout } from "../../../src/lib/generations/providers/fetch-with-timeout.ts";
import type { AttemptKind, TransportResult } from "./build-flow.mts";
import { mapHttpError } from "./builders.mts";
import { withNetContext, type NetGuard } from "./net-guard.mts";
import { pollResultToTransport } from "./transports.mts";
import { HarnessError, isRecord, sleep } from "./util.mts";

const API = "https://api.openai.com/v1";
const UPLOAD_TIMEOUT_MS = 180_000;
const CREATE_TIMEOUT_MS = 60_000;
const READ_TIMEOUT_MS = 60_000;

/** Proven: this round created no batch (the upload failed, OpenAI refused the create, or the lookup found none). */
export class BatchNotCreated extends HarnessError {
  constructor(message: string) {
    super(message);
    this.name = "BatchNotCreated";
  }
}

/** A batch may exist for this round: its reservations stay counted, and --resume looks again. */
export class BatchCreateUnknown extends HarnessError {
  constructor(message: string) {
    super(message);
    this.name = "BatchCreateUnknown";
  }
}

export type PendingLine = {
  customId: string;
  buildId: string;
  attempt: number;
  kind: AttemptKind;
  ticket: string;
  worstUsd: number;
};

export type BatchRound = {
  round: number;
  batchId: string | null;
  inputFileId: string | null;
  status: string;
  lines: PendingLine[];
  outputFileId: string | null;
  errorFileId: string | null;
  createdAt: string;
  endedAt: string | null;
  collected: boolean;
  errors: string[];
  /** Lines that never ran (released, sent again next round). */
  notRun?: number;
  /** How a create with no answer was settled. */
  createNote?: string;
};

export type BatchesFile = { rounds: BatchRound[] };

export const TERMINAL = new Set(["completed", "failed", "expired", "cancelled"]);

export function readBatches(runDir: string): BatchesFile {
  const p = join(runDir, "batches.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as BatchesFile) : { rounds: [] };
}

export function writeBatches(runDir: string, b: BatchesFile): void {
  writeFileSync(join(runDir, "batches.json"), JSON.stringify(b, null, 2));
}

function auth(): Record<string, string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new HarnessError("OPENAI_API_KEY is missing: Batch needs it");
  return { authorization: `Bearer ${key}` };
}

async function readJson(res: Response, what: string): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok || !isRecord(body)) {
    const err = isRecord(body) && isRecord(body.error) ? body.error : {};
    throw new HarnessError(`${what} failed: ${res.status} ${String(err.code ?? "")} ${String(err.message ?? "").slice(0, 300)}`.trim());
  }
  return body;
}

/** The one upload: the Batch input file (purpose "batch"). */
export async function uploadBatchInput(jsonl: string, name: string): Promise<string> {
  const headers = auth();
  const form = new FormData();
  form.set("purpose", "batch");
  form.set("file", new Blob([jsonl], { type: "application/jsonl" }), name);
  const res = await withNetContext({ tag: "batch-upload", settled: true }, () => fetchWithTimeout(`${API}/files`, { method: "POST", headers, body: form }, UPLOAD_TIMEOUT_MS));
  const body = await readJson(res, "batch input upload");
  if (typeof body.id !== "string") throw new HarnessError("batch input upload returned no file id");
  return body.id;
}

export type CreateOutcome =
  | { ok: true; batch: Record<string, unknown> }
  /** OpenAI answered with a 4xx: it refused the create, so no batch exists. */
  | { ok: false; refused: true; detail: string }
  /** No answer, a 5xx, or an answer without an id: a batch may exist. */
  | { ok: false; refused: false; detail: string };

export async function createBatch(inputFileId: string, metadata: Record<string, string>): Promise<CreateOutcome> {
  const headers = { ...auth(), "content-type": "application/json" };
  let res: Response;
  try {
    res = await withNetContext({ tag: "batch", settled: true }, () =>
      fetchWithTimeout(
        `${API}/batches`,
        { method: "POST", headers, body: JSON.stringify({ input_file_id: inputFileId, endpoint: "/v1/responses", completion_window: "24h", metadata }) },
        CREATE_TIMEOUT_MS,
      ),
    );
  } catch (e) {
    return { ok: false, refused: false, detail: `no answer (${e instanceof Error ? e.name : "error"})` };
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (res.ok && isRecord(body) && typeof body.id === "string") return { ok: true, batch: body };
  const err = isRecord(body) && isRecord(body.error) ? body.error : {};
  const detail = `${res.status} ${String(err.code ?? "")} ${String(err.message ?? "").slice(0, 300)}`.trim();
  return res.status >= 400 && res.status < 500 ? { ok: false, refused: true, detail } : { ok: false, refused: false, detail: `${detail}${res.ok ? " (no batch id)" : ""}` };
}

export async function getBatch(id: string): Promise<Record<string, unknown>> {
  const headers = auth();
  const res = await withNetContext({ tag: "batch", settled: true }, () => fetchWithTimeout(`${API}/batches/${encodeURIComponent(id)}`, { headers }, READ_TIMEOUT_MS));
  return readJson(res, "batch status");
}

export async function fileContent(id: string): Promise<string> {
  const headers = auth();
  const res = await withNetContext({ tag: "batch", settled: true }, () => fetchWithTimeout(`${API}/files/${encodeURIComponent(id)}/content`, { headers }, 300_000));
  if (!res.ok) throw new HarnessError(`batch file download failed: ${res.status}`);
  return res.text();
}

export type BatchPage = { data: Record<string, unknown>[]; hasMore: boolean; lastId: string | null };

/** One page of GET /v1/batches. */
export async function listBatchesPage(after: string | null): Promise<BatchPage> {
  const headers = auth();
  const q = new URLSearchParams({ limit: "100" });
  if (after) q.set("after", after);
  const res = await withNetContext({ tag: "batch", settled: true }, () => fetchWithTimeout(`${API}/batches?${q.toString()}`, { headers }, READ_TIMEOUT_MS));
  const body = await readJson(res, "batch list");
  const data = (Array.isArray(body.data) ? body.data : []).filter(isRecord);
  const last = data[data.length - 1];
  return { data, hasMore: body.has_more === true, lastId: typeof body.last_id === "string" ? body.last_id : last && typeof last.id === "string" ? last.id : null };
}

export type Lookup = { found: Record<string, unknown> } | { absent: string } | { unknown: string };

/**
 * The batch whose input is `inputFileId`, if one exists. Absence is proven
 * only by listing every batch, or — when the pages come newest first — by
 * reaching batches created well before the round began (five minutes of
 * clock slack). A list that fails, or runs past `maxPages`, proves nothing.
 */
export async function findBatchByInputFile(inputFileId: string, roundCreatedAt: string, list: (after: string | null) => Promise<BatchPage> = listBatchesPage, maxPages = 10): Promise<Lookup> {
  const cutoff = Date.parse(roundCreatedAt) / 1000 - 300;
  let after: string | null = null;
  let newestFirst = true;
  let prev = Number.POSITIVE_INFINITY;
  for (let page = 0; page < maxPages; page++) {
    let p: BatchPage;
    try {
      p = await list(after);
    } catch (e) {
      return { unknown: `the batch list failed (${e instanceof Error ? e.message.slice(0, 200) : "error"})` };
    }
    for (const b of p.data) {
      if (b.input_file_id === inputFileId) return { found: b };
      const at = typeof b.created_at === "number" ? b.created_at : null;
      if (at === null || at > prev) newestFirst = false;
      else prev = at;
    }
    if (!p.hasMore) return { absent: `no batch uses ${inputFileId} (every batch listed)` };
    if (newestFirst && Number.isFinite(cutoff) && prev < cutoff) return { absent: `no batch uses ${inputFileId} (listed back to before the round began)` };
    after = p.lastId;
    if (!after) return { unknown: "the batch list gave no cursor for its next page" };
  }
  return { unknown: `no batch uses ${inputFileId} in the ${maxPages} newest pages, and the list did not reach the round's start` };
}

function adopt(rec: BatchRound, b: Record<string, unknown>): void {
  rec.batchId = typeof b.id === "string" ? b.id : null;
  rec.status = typeof b.status === "string" ? b.status : "validating";
}

/**
 * A round with no batch id: settles whether a batch exists for it. With no
 * input file the create was never sent, so none can. Adopts a batch it finds.
 */
export async function reconcileRound(o: { runDir: string; rec: BatchRound; batches: BatchesFile; lookup?: typeof findBatchByInputFile }): Promise<"attached" | "absent" | "unknown"> {
  const { rec } = o;
  if (rec.batchId) return "attached";
  if (!rec.inputFileId) {
    rec.createNote = "the input upload never finished: no create was sent";
    writeBatches(o.runDir, o.batches);
    return "absent";
  }
  const r = await (o.lookup ?? findBatchByInputFile)(rec.inputFileId, rec.createdAt);
  if ("found" in r) {
    adopt(rec, r.found);
    rec.createNote = `the create had no answer; batch ${rec.batchId} was found by its input file and adopted`;
  } else rec.createNote = "absent" in r ? `the create had no answer; ${r.absent}` : `the create had no answer, and ${r.unknown}`;
  writeBatches(o.runDir, o.batches);
  return "found" in r ? "attached" : "absent" in r ? "absent" : "unknown";
}

export type LineResult = { customId: string; statusCode: number | null; body: unknown; error: { code: string; message: string } | null };

export function parseBatchResults(...jsonls: (string | null)[]): Map<string, LineResult> {
  const out = new Map<string, LineResult>();
  for (const text of jsonls) {
    if (!text) continue;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as Record<string, unknown>;
      const customId = typeof row.custom_id === "string" ? row.custom_id : "";
      if (!customId) continue;
      const resp = isRecord(row.response) ? row.response : null;
      const err = isRecord(row.error) ? row.error : null;
      out.set(customId, {
        customId,
        statusCode: resp && typeof resp.status_code === "number" ? resp.status_code : null,
        body: resp ? resp.body : null,
        error: err ? { code: String(err.code ?? ""), message: String(err.message ?? "").slice(0, 300) } : null,
      });
    }
  }
  return out;
}

/** A line that never ran: billed nothing, and not an attempt of the build. */
export type NotRun = { state: "not-run"; detail: string };

/**
 * One line's outcome, read by the product's pollAstraJob — or "not-run" for
 * a line OpenAI never ran: missing from the batch's files (an expired or
 * cancelled batch leaves its unfinished lines out, or lists them as
 * batch_expired / batch_cancelled), or a per-line 429 or 5xx.
 */
export async function lineToTransport(line: LineResult | undefined, net: NetGuard, batchStatus: string): Promise<TransportResult | NotRun> {
  if (!line) return { state: "not-run", detail: `no line in the ${batchStatus} batch's files` };
  if (line.statusCode === 200 && isRecord(line.body) && typeof line.body.id === "string") {
    const id = line.body.id;
    net.setOpenAiResponse(id, line.body);
    try {
      const p = await pollAstraJob(id);
      return pollResultToTransport(p) ?? { state: "failed", kind: "failed", detail: `line ${line.body.status ?? "?"} without an answer`, usage: null };
    } finally {
      net.deleteOpenAiResponse(id);
    }
  }
  if (line.statusCode !== null) {
    const err = isRecord(line.body) && isRecord(line.body.error) ? line.body.error : {};
    const code = typeof err.code === "string" ? err.code : undefined;
    const detail = `${line.statusCode} ${code ?? ""} ${typeof err.message === "string" ? err.message.slice(0, 200) : ""}`.trim();
    if (line.statusCode === 429 || line.statusCode >= 500) return { state: "not-run", detail };
    return { state: "submit-failed", kind: mapHttpError(line.statusCode, code), detail };
  }
  if (line.error?.code === "batch_expired" || line.error?.code === "batch_cancelled") return { state: "not-run", detail: line.error.code };
  return { state: "submit-failed", kind: "bad_request", detail: `${line.error?.code ?? "error"}: ${line.error?.message ?? ""}` };
}

export async function submitRound(o: {
  runDir: string;
  round: number;
  lines: PendingLine[];
  bodies: Map<string, Record<string, unknown>>;
  metadata: Record<string, string>;
  batches: BatchesFile;
  lookup?: typeof findBatchByInputFile;
}): Promise<BatchRound> {
  const jsonl = o.lines.map((l) => JSON.stringify({ custom_id: l.customId, method: "POST", url: "/v1/responses", body: o.bodies.get(l.customId) })).join("\n") + "\n";
  // Before the round is recorded, so the caller releases its money as never submitted.
  if (/"type":"input_image"|data:image\/[a-z]+;base64,/.test(jsonl)) {
    throw new HarnessError(`batch round ${o.round} would upload an image to OpenAI's Files storage, which the product never does: nothing was uploaded`);
  }
  const name = `round${o.round}.jsonl`;
  writeFileSync(join(o.runDir, `batch-${name}`), jsonl);
  const rec: BatchRound = {
    round: o.round,
    batchId: null,
    inputFileId: null,
    status: "uploading",
    lines: o.lines,
    outputFileId: null,
    errorFileId: null,
    createdAt: new Date().toISOString(),
    endedAt: null,
    collected: false,
    errors: [],
  };
  o.batches.rounds.push(rec);
  writeBatches(o.runDir, o.batches);
  try {
    rec.inputFileId = await uploadBatchInput(jsonl, name);
  } catch (e) {
    // The create is only sent after the upload answers: no batch can exist.
    throw new BatchNotCreated(`batch input upload failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  rec.status = "creating";
  writeBatches(o.runDir, o.batches);
  const created = await createBatch(rec.inputFileId, o.metadata);
  if (created.ok) {
    adopt(rec, created.batch);
    writeBatches(o.runDir, o.batches);
    return rec;
  }
  if (created.refused) {
    rec.status = "create-refused";
    rec.createNote = created.detail;
    writeBatches(o.runDir, o.batches);
    throw new BatchNotCreated(`batch create refused: ${created.detail}`);
  }
  rec.status = "create-unanswered";
  writeBatches(o.runDir, o.batches);
  // Give a batch the create may have made a moment to show in the list.
  await sleep(5_000);
  const r = await reconcileRound({ runDir: o.runDir, rec, batches: o.batches, lookup: o.lookup });
  if (r === "attached") return rec;
  if (r === "absent") throw new BatchNotCreated(`batch create had no answer (${created.detail}); ${rec.createNote ?? "no batch found"}`);
  throw new BatchCreateUnknown(
    `batch create had no answer (${created.detail}) and whether a batch exists could not be settled (${rec.createNote ?? "?"}). Round ${rec.round}'s ${rec.lines.length} reservations stay counted; --resume looks for the batch again`,
  );
}

/** Polls a round until it ends (or the run is stopping). Returns false when stopped first. */
export async function awaitRound(o: { runDir: string; rec: BatchRound; batches: BatchesFile; pollMs: number; stopping: () => boolean; progress: (m: string) => void }): Promise<boolean> {
  const { rec } = o;
  if (!rec.batchId) throw new HarnessError(`round ${rec.round} has no batch id (the upload never finished); start a new run`);
  let failures = 0;
  for (;;) {
    let b: Record<string, unknown>;
    try {
      b = await getBatch(rec.batchId);
      failures = 0;
    } catch (e) {
      // A status read that fails is the wire, not the batch: keep polling,
      // and give up (the batch keeps running; --resume re-attaches) after ten.
      failures += 1;
      if (failures >= 10) throw e;
      o.progress(`batch round ${rec.round}: status read failed (${failures}/10), retrying`);
      for (let waited = 0; waited < o.pollMs; waited += 1000) {
        if (o.stopping()) return false;
        await sleep(1000);
      }
      continue;
    }
    rec.status = typeof b.status === "string" ? b.status : rec.status;
    rec.outputFileId = typeof b.output_file_id === "string" ? b.output_file_id : null;
    rec.errorFileId = typeof b.error_file_id === "string" ? b.error_file_id : null;
    const errs = isRecord(b.errors) && Array.isArray(b.errors.data) ? b.errors.data : [];
    rec.errors = errs.map((e) => (isRecord(e) ? `${String(e.code ?? "")}: ${String(e.message ?? "").slice(0, 200)}` : String(e)));
    const counts = isRecord(b.request_counts) ? b.request_counts : {};
    o.progress(`batch round ${rec.round} ${rec.status} ${String(counts.completed ?? 0)}/${String(counts.total ?? rec.lines.length)} (failed ${String(counts.failed ?? 0)})`);
    writeBatches(o.runDir, o.batches);
    if (TERMINAL.has(rec.status)) {
      rec.endedAt = new Date().toISOString();
      writeBatches(o.runDir, o.batches);
      return true;
    }
    for (let waited = 0; waited < o.pollMs; waited += 1000) {
      if (o.stopping()) return false;
      await sleep(1000);
    }
  }
}

export async function collectRound(rec: BatchRound): Promise<Map<string, LineResult>> {
  const output = rec.outputFileId ? await fileContent(rec.outputFileId) : null;
  const errors = rec.errorFileId ? await fileContent(rec.errorFileId) : null;
  return parseBatchResults(output, errors);
}
