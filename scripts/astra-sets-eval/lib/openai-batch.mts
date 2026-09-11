// OpenAI Batch plumbing for Astra builds (half the standard price,
// docs/ASTRA_SETS.md §1.2). Nothing in src/ does Batch; this is the only
// Batch code, and it reuses the product for everything else:
//
//   the line body   buildAstraRequestBody minus `background` (builders.mts)
//   the answer      each line's stored response is served by the net guard at
//                   GET /v1/responses/<id>, and the product's own
//                   pollAstraJob reads it — one interpreter, no copy
//   line errors     mapped like submitAstraJob: misalignment → refused,
//                   401/403 → config, 429, 5xx, else bad_request
//
// Flow per round: write the input JSONL → POST /v1/files (purpose "batch":
// the one upload the runner makes, blind eval briefs only) → POST /v1/batches
// → the batch id is written to batches.json BEFORE any polling, so --resume
// can re-attach → GET /v1/batches/<id> every 60 s → download the output and
// error files. Ctrl-C leaves a batch running, to be resumed.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pollAstraJob } from "../../../src/lib/generations/providers/astra.ts";
import type { AttemptKind, TransportResult } from "./build-flow.mts";
import { mapHttpError } from "./builders.mts";
import { withNetContext, type NetGuard } from "./net-guard.mts";
import { pollResultToTransport } from "./transports.mts";
import { HarnessError, isRecord, sleep } from "./util.mts";

const API = "https://api.openai.com/v1";

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
  const form = new FormData();
  form.set("purpose", "batch");
  form.set("file", new Blob([jsonl], { type: "application/jsonl" }), name);
  const res = await withNetContext({ tag: "batch-upload", settled: true }, () => fetch(`${API}/files`, { method: "POST", headers: auth(), body: form }));
  const body = await readJson(res, "batch input upload");
  if (typeof body.id !== "string") throw new HarnessError("batch input upload returned no file id");
  return body.id;
}

export async function createBatch(inputFileId: string, metadata: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await withNetContext({ tag: "batch", settled: true }, () =>
    fetch(`${API}/batches`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ input_file_id: inputFileId, endpoint: "/v1/responses", completion_window: "24h", metadata }),
    }),
  );
  return readJson(res, "batch create");
}

export async function getBatch(id: string): Promise<Record<string, unknown>> {
  const res = await withNetContext({ tag: "batch", settled: true }, () => fetch(`${API}/batches/${encodeURIComponent(id)}`, { headers: auth() }));
  return readJson(res, "batch status");
}

export async function fileContent(id: string): Promise<string> {
  const res = await withNetContext({ tag: "batch", settled: true }, () => fetch(`${API}/files/${encodeURIComponent(id)}/content`, { headers: auth() }));
  if (!res.ok) throw new HarnessError(`batch file download failed: ${res.status}`);
  return res.text();
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

/** One line's outcome as a transport result, read by the product's pollAstraJob. */
export async function lineToTransport(line: LineResult | undefined, net: NetGuard, batchStatus: string, batchErrors: string[] = []): Promise<TransportResult> {
  if (!line) {
    if (batchStatus === "failed") {
      // The whole batch failed validation: nothing ran, nothing was billed.
      return { state: "submit-failed", kind: "bad_request", detail: `batch failed validation: ${batchErrors.join("; ").slice(0, 400) || "no detail"}` };
    }
    return batchStatus === "expired" || batchStatus === "cancelled"
      ? { state: "failed", kind: batchStatus === "expired" ? "expired" : "cancelled", detail: `batch ${batchStatus} before this line ran`, usage: null }
      : { state: "submit-failed", kind: "unavailable", detail: `line missing from a ${batchStatus} batch` };
  }
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
    const kind = mapHttpError(line.statusCode, code);
    return { state: "submit-failed", kind, detail: `${line.statusCode} ${code ?? ""} ${typeof err.message === "string" ? err.message.slice(0, 200) : ""}`.trim() };
  }
  if (line.error?.code === "batch_expired") return { state: "failed", kind: "expired", detail: "batch_expired", usage: null };
  return { state: "submit-failed", kind: "bad_request", detail: `${line.error?.code ?? "error"}: ${line.error?.message ?? ""}` };
}

export async function submitRound(o: {
  runDir: string;
  round: number;
  lines: PendingLine[];
  bodies: Map<string, Record<string, unknown>>;
  metadata: Record<string, string>;
  batches: BatchesFile;
}): Promise<BatchRound> {
  const jsonl = o.lines.map((l) => JSON.stringify({ custom_id: l.customId, method: "POST", url: "/v1/responses", body: o.bodies.get(l.customId) })).join("\n") + "\n";
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
  rec.inputFileId = await uploadBatchInput(jsonl, name);
  writeBatches(o.runDir, o.batches);
  const created = await createBatch(rec.inputFileId, o.metadata);
  rec.batchId = typeof created.id === "string" ? created.id : null;
  rec.status = typeof created.status === "string" ? created.status : "validating";
  writeBatches(o.runDir, o.batches);
  if (!rec.batchId) throw new HarnessError("batch create returned no id");
  return rec;
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
