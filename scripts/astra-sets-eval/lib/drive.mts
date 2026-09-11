// Drives builds to the end, over whichever transport each one uses, through
// the one state machine (build-flow.mts). Parts A, D and the canary hand it
// jobs; it hands back finished BuildStates.
//
//   batch       every build waiting on an attempt goes into one Batch round
//               (both Astra efforts share a file: same model); answers are
//               judged locally (words gate, closure), then every retry goes
//               into a second round. The whole round is reserved before
//               upload; lines that do not fit stay pending (budget). Lines
//               OpenAI never ran (expired, missing, a per-line 429 or 5xx)
//               are released and go into the next round as the same attempt.
//   background  Astra, six in flight. A photo build's only transport.
//   sync        the baselines, four in flight.
//   simulated   the dry run's fakes, reserved and settled like the real thing
//               (a photo build's request is still built, then discarded).
//
// driveBatch refuses a photo build before it reserves anything: a Batch
// line is a line of an uploaded file, and photos never go to OpenAI's Files
// storage.
//
// state.json holds every job after each round, so --resume can re-attach a
// recorded batch and finish what was left: an attempt that never started
// (budget, Ctrl-C) is still pending there, and is sent by --resume.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAstraRequestBody, type AstraEffort } from "../../../src/lib/generations/providers/astra.ts";
import { parseSetSpecText, specTextForGate } from "../../../src/lib/sets/set-spec.ts";
import { SET_BUILD_MAX_ATTEMPTS } from "../../../src/lib/sets/set-config.ts";
import { advanceBuild, buildRecord, leftPending, type AttemptMeta, type BuildRecord, type BuildState, type FlowDeps } from "./build-flow.mts";
import type { SheetItemIn } from "./blind-sheet.mts";
import { astraJobRequest, batchLineBody, customIdFor, MINI_MODEL, SONNET_MODEL } from "./builders.mts";
import { writeResult, type RunContext } from "./context.mts";
import {
  awaitRound,
  BatchCreateUnknown,
  BatchNotCreated,
  collectRound,
  lineToTransport,
  readBatches,
  reconcileRound,
  submitRound,
  writeBatches,
  type BatchRound,
  type PendingLine,
} from "./openai-batch.mts";
import { HarnessError } from "./util.mts";
import type { Provider } from "./prices.mts";
import { astraBackgroundAttempt, astraRequestFor, attemptWorstUsd, miniAttempt, settleAstra, sonnetAttempt, type Attempt, type TransportEnv } from "./transports.mts";
import { mapLimit, Semaphore } from "./util.mts";
import { capUsage, fakeAnswer, fakePhotoAnswer } from "../parts/simulate.mts";

export type BuildJob = {
  state: BuildState;
  builder: string;
  effort: AstraEffort | null;
  provider: Provider;
  run: number;
  briefId: string;
  category: string;
  /** Rotation index for the dry run's fakes. */
  index: number;
  transport: "batch" | "background" | "sync";
  /** The canary: no retry, first attempt only. */
  firstOnly?: boolean;
};

const zero = (transport: AttemptMeta["transport"]): AttemptMeta => ({ transport, billedUsd: 0, standardUsd: 0 });

export function transportEnv(ctx: RunContext): TransportEnv {
  return {
    part: ctx.part,
    book: ctx.book,
    guard: ctx.guard,
    net: ctx.net,
    answersDir: join(ctx.runDir, "answers"),
    stopping: ctx.stopping,
    interrupted: ctx.interrupted,
    inflight: ctx.inflight,
    photos: ctx.photos,
  };
}

export function saveState(ctx: RunContext, jobs: readonly BuildJob[]): void {
  writeFileSync(join(ctx.runDir, "state.json"), JSON.stringify({ part: ctx.part, jobs }));
}

export function loadState(runDir: string): BuildJob[] | null {
  const p = join(runDir, "state.json");
  if (!existsSync(p)) return null;
  return (JSON.parse(readFileSync(p, "utf8")) as { jobs: BuildJob[] }).jobs;
}

/** The canary asks one question of each brief: stop after the first attempt. */
function stopAfterFirst(s: BuildState): void {
  if (!s.next || s.final) return;
  s.next = null;
  s.final = s.draft
    ? { status: "delivered", use: "draft", spec: s.draft, fromAttempt: s.draftAttempt ?? 1, openAtDelivery: s.draftOpen ?? 0, note: "canary: first attempt only" }
    : { status: "failed", failure: s.pendingFailure ?? "failed", note: "canary: first attempt only" };
}

function simulatedAttempt(ctx: RunContext, job: BuildJob): Attempt {
  const s = job.state;
  if (!s.next) throw new Error(`${s.buildId}: nothing to send`);
  const attemptNo = s.attempts + 1;
  const customId = customIdFor(s.buildId, attemptNo);
  const baseline = job.builder === "sonnet-5" || job.builder === "mini-5.4";
  const photo = Boolean(s.photo);
  // A photo build's request is built as a real run builds it — the product's
  // photo request over the stored bytes, through the product's body builder,
  // which throws on any part it would not send — and then discarded.
  if (photo) buildAstraRequestBody(astraRequestFor(transportEnv(ctx), s, job.effort ?? "low"));
  const usage = capUsage(job.provider, s.next.kind, baseline, photo);
  const r = photo ? fakePhotoAnswer(job.index, attemptNo, usage) : fakeAnswer(job.index, attemptNo, usage);
  let billed: number | null;
  let standard: number | null;
  if (!baseline) {
    const t = job.transport === "batch" && !photo ? "batch" : "background";
    const std = attemptWorstUsd(ctx.book, s);
    const worst = t === "batch" ? std * ctx.book.batchMultiplier : std;
    const res = ctx.guard.reserve("astra", worst, customId);
    if (!res.ok) return { r: { state: "submit-failed", kind: "budget", detail: res.reason }, meta: zero("simulated") };
    const meta = settleAstra(ctx, res.ticket, worst, usage, t);
    billed = meta.billedUsd;
    standard = meta.standardUsd;
  } else {
    const model = job.builder === "sonnet-5" ? SONNET_MODEL : MINI_MODEL;
    const cost = ctx.book.modelCost(model, usage, job.provider);
    const worst = ctx.book.baselineAttemptWorstUsd(model, s.next.kind === "first" ? "first" : "retry");
    if (worst !== null && cost !== null) {
      const res = ctx.guard.reserve(job.builder === "sonnet-5" ? "sonnet-5" : "mini-5.4", worst, customId);
      if (res.ok) ctx.guard.settle(res.ticket, cost, cost, "usage (simulated)", usage);
    }
    billed = cost;
    standard = cost;
  }
  const meta: AttemptMeta = { transport: "simulated", billedUsd: billed, standardUsd: standard };
  if (r.state === "done") {
    const file = `answers/${customId}.txt`;
    writeFileSync(join(ctx.runDir, file), r.text);
    meta.answerFile = file;
  }
  return { r, meta };
}

async function attemptFor(ctx: RunContext, job: BuildJob, sonnetMode: "format" | "prompt"): Promise<Attempt> {
  if (ctx.dry) return simulatedAttempt(ctx, job);
  const env = transportEnv(ctx);
  if (job.builder === "mini-5.4") return miniAttempt(env, job.state);
  if (job.builder === "sonnet-5") return sonnetAttempt(env, job.state, sonnetMode);
  return astraBackgroundAttempt(env, job.state, job.effort ?? "low");
}

/** Background, sync and simulated jobs: each driven to its end, a few at a time. */
export async function driveEach(ctx: RunContext, jobs: readonly BuildJob[], deps: FlowDeps, o: { sonnetMode: "format" | "prompt"; onDone?: (j: BuildJob) => void }): Promise<void> {
  const astra = new Semaphore(6);
  const sync = new Semaphore(4);
  await mapLimit(
    jobs,
    10,
    async (job) => {
      const sem = job.builder === "sonnet-5" || job.builder === "mini-5.4" ? sync : astra;
      await sem.use(async () => {
        while (job.state.next && !job.state.final) {
          const a = await attemptFor(ctx, job, o.sonnetMode);
          await advanceBuild(job.state, a.r, a.meta, deps);
          // Not sent, or voided at Ctrl-C: the attempt stays pending for --resume.
          if (leftPending(a.r)) break;
          if (job.firstOnly) stopAfterFirst(job.state);
        }
      });
      ctx.progress(`${job.state.buildId} ${job.state.final?.status ?? "unfinished"}`);
      o.onDone?.(job);
    },
    ctx.stopping,
  );
}

/** Releases the tickets of `lines` that are still open in the guard. */
function releaseOpen(ctx: RunContext, lines: readonly PendingLine[], why: string): void {
  const open = new Set(ctx.guard.openTickets().map((t) => t.ticket));
  for (const l of lines) if (open.has(l.ticket)) ctx.guard.release(l.ticket, why);
}

export type BatchApi = {
  submitRound: typeof submitRound;
  awaitRound: typeof awaitRound;
  collectRound: typeof collectRound;
  reconcileRound: typeof reconcileRound;
};
const REAL_BATCH_API: BatchApi = { submitRound, awaitRound, collectRound, reconcileRound };

async function processRound(ctx: RunContext, rec: BatchRound, jobs: readonly BuildJob[], deps: FlowDeps, save: () => void, api: BatchApi): Promise<void> {
  if (rec.status === "failed") {
    // The whole batch failed validation: nothing ran, nothing was billed,
    // and it says nothing about the model. Every attempt stays pending.
    releaseOpen(ctx, rec.lines, "batch failed validation: nothing ran");
    rec.collected = true;
    save();
    throw new HarnessError(
      `batch round ${rec.round} failed validation at OpenAI (${rec.errors.join("; ").slice(0, 400) || "no detail"}): nothing ran and nothing was billed. ` +
        `Its ${rec.lines.length} attempts stay pending in state.json: fix the cause, then --resume (A, the canary), or rerun with --transport background`,
    );
  }
  const byBuild = new Map(jobs.map((j) => [j.state.buildId, j]));
  const results = await api.collectRound(rec);
  const open = new Set(ctx.guard.openTickets().map((t) => t.ticket));
  let notRun = 0;
  for (const line of rec.lines) {
    const job = byBuild.get(line.buildId);
    if (!job || job.state.final || job.state.attempts + 1 !== line.attempt) continue;
    const r = await lineToTransport(results.get(line.customId), ctx.net, rec.status);
    // A ticket already closed in the ledger (a crash after settling, before
    // state.json was saved) is not settled twice: the cost is read, not booked.
    const booked = !open.has(line.ticket);
    if (r.state === "not-run") {
      // Billed nothing and not an attempt: s.next is kept, so the same
      // attempt goes into the next round.
      if (!booked) ctx.guard.release(line.ticket, `batch line never ran: ${r.detail}`);
      notRun += 1;
      continue;
    }
    let meta: AttemptMeta;
    if (r.state === "submit-failed") {
      if (!booked) ctx.guard.release(line.ticket, `batch line refused: ${r.kind}`);
      meta = zero("batch");
    } else {
      if (booked) {
        const c = ctx.book.astraCost(r.usage, "batch");
        meta = r.usage ? { transport: "batch", billedUsd: c.billedUsd, standardUsd: c.standardUsd } : { transport: "batch", billedUsd: line.worstUsd, standardUsd: line.worstUsd / ctx.book.batchMultiplier, costFlag: "no usage returned" };
      } else meta = settleAstra(ctx, line.ticket, line.worstUsd, r.usage, "batch");
      if (r.state === "done") {
        const file = `answers/${line.customId}.txt`;
        writeFileSync(join(ctx.runDir, file), r.text);
        meta.answerFile = file;
      }
    }
    await advanceBuild(job.state, r, meta, deps);
    if (job.firstOnly) stopAfterFirst(job.state);
  }
  rec.collected = true;
  rec.notRun = notRun;
  save();
  if (notRun) ctx.progress(`batch round ${rec.round} (${rec.status}): ${notRun} lines never ran; released, and sent again in the next round`);
  if (rec.status === "cancelled" && notRun) {
    // This runner never cancels a batch: someone did, at OpenAI. Do not
    // send the lines again on its own.
    throw new HarnessError(`batch round ${rec.round} was cancelled at OpenAI (this runner never cancels a batch): ${notRun} attempts never ran and stay pending in state.json (A, the canary: --resume sends them)`);
  }
}

/** A build takes at most SET_BUILD_MAX_ATTEMPTS attempts; the spare rounds re-send lines OpenAI never ran. */
const MAX_ROUNDS = SET_BUILD_MAX_ATTEMPTS + 4;

/**
 * Batch jobs: rounds until nothing waits on an attempt. Returns "stopped"
 * when Ctrl-C arrived while a batch was running (it keeps running at
 * OpenAI; --resume re-attaches it). Whatever the spend guard would not
 * reserve stays pending.
 */
export async function driveBatch(
  ctx: RunContext,
  jobs: readonly BuildJob[],
  allJobs: readonly BuildJob[],
  deps: FlowDeps,
  o: { resume: boolean; api?: BatchApi; pollMs?: number },
): Promise<"done" | "stopped"> {
  const photo = jobs.find((j) => j.state.photo);
  if (photo) {
    throw new HarnessError(`${photo.state.buildId} is a photo build: photos never go into a Batch input file (it would upload them to OpenAI's Files storage, which the product never does); nothing was reserved or sent`);
  }
  const api = o.api ?? REAL_BATCH_API;
  const batches = readBatches(ctx.runDir);
  const save = () => {
    writeBatches(ctx.runDir, batches);
    saveState(ctx, allJobs);
  };
  const pollMs = o.pollMs ?? 60_000;
  if (o.resume) {
    const last = batches.rounds[batches.rounds.length - 1];
    if (last && !last.collected) {
      if (!last.batchId) {
        // The run stopped between the upload and a create's answer. Settle
        // whether the create made a batch before letting its money go.
        const r = await api.reconcileRound({ runDir: ctx.runDir, rec: last, batches });
        if (r === "unknown") throw new BatchCreateUnknown(`round ${last.round}: ${last.createNote ?? "whether a batch exists could not be settled"}; its reservations stay counted. Try --resume again later`);
        if (r === "absent") {
          releaseOpen(ctx, last.lines, `no batch was created (${last.createNote ?? "?"})`);
          last.status = "abandoned";
          last.collected = true;
          save();
        }
      }
      if (last.batchId && !last.collected) {
        ctx.progress(`re-attaching batch round ${last.round}`);
        if (!(await api.awaitRound({ runDir: ctx.runDir, rec: last, batches, pollMs, stopping: ctx.interrupted, progress: ctx.progress }))) return "stopped";
        await processRound(ctx, last, jobs, deps, save, api);
      }
    }
  }
  for (let rounds = 0; rounds < MAX_ROUNDS; rounds++) {
    const pending = jobs.filter((j) => j.state.next && !j.state.final);
    if (pending.length === 0) return "done";
    // Ctrl-C (or a stop the part asked for) between rounds: leave every
    // waiting attempt as it is in state.json, for --resume to send.
    if (ctx.interrupted()) return "stopped";
    if (ctx.stopReason() !== null) return "done";
    const lines: PendingLine[] = [];
    const bodies = new Map<string, Record<string, unknown>>();
    for (const j of pending) {
      const s = j.state;
      if (!s.next) continue;
      const attempt = s.attempts + 1;
      const customId = customIdFor(s.buildId, attempt);
      const worst = (s.next.kind === "first" ? ctx.book.astraFirstWorstUsd : ctx.book.astraRetryWorstUsd) * ctx.book.batchMultiplier;
      // A run the spend guard stopped reserves nothing new: the attempt
      // stays pending (state.json), for --resume with more room.
      const res = ctx.guard.reserve("astra", worst, customId);
      if (!res.ok) continue;
      lines.push({ customId, buildId: s.buildId, attempt, kind: s.next.kind, ticket: res.ticket, worstUsd: worst });
      bodies.set(customId, batchLineBody(astraJobRequest(s.next.input, j.effort ?? "low", ctx.part)));
    }
    save();
    // Nothing could be reserved: what is left stays pending.
    if (lines.length === 0) return "done";
    const round = batches.rounds.length + 1;
    let rec: BatchRound;
    try {
      rec = await api.submitRound({ runDir: ctx.runDir, round, lines, bodies, metadata: { run: ctx.runId, part: ctx.part }, batches });
    } catch (e) {
      const mine = batches.rounds.find((r) => r.round === round);
      if (!mine) {
        // Failed before anything was uploaded.
        releaseOpen(ctx, lines, "batch round never submitted");
      } else if (!mine.batchId && !(e instanceof BatchCreateUnknown)) {
        // Proven: no batch exists for this round (the upload failed, the
        // create was refused, or the lookup found none).
        releaseOpen(ctx, mine.lines, e instanceof BatchNotCreated ? `no batch was created: ${e.message}` : "batch upload failed");
        mine.status = "abandoned";
        mine.collected = true;
      }
      // A create with no answer that could not be settled keeps its money
      // counted: --resume looks for the batch again.
      save();
      throw e;
    }
    ctx.progress(`batch round ${rec.round}: ${lines.length} lines submitted (${rec.batchId})`);
    save();
    // Only Ctrl-C stops waiting: a budget stop lets a batch already paid for come back.
    if (!(await api.awaitRound({ runDir: ctx.runDir, rec, batches, pollMs, stopping: ctx.interrupted, progress: ctx.progress }))) return "stopped";
    await processRound(ctx, rec, jobs, deps, save, api);
  }
  return "done";
}

/**
 * Every job's results row (each delivered set under specs/). `fresh`
 * rewrites results.jsonl from these jobs, so a resumed run never carries a
 * build twice.
 */
export function recordBuilds(ctx: RunContext, jobs: readonly BuildJob[], o: { fresh?: boolean } = {}): BuildRecord[] {
  if (o.fresh) writeFileSync(join(ctx.runDir, "results.jsonl"), "");
  return jobs.map((j) => {
    let specFile: string | null = null;
    if (j.state.final?.status === "delivered") {
      specFile = `specs/${j.state.buildId}.json`;
      writeFileSync(join(ctx.runDir, specFile), JSON.stringify(j.state.final.spec));
    }
    const rec = buildRecord(j.state, {
      part: ctx.part,
      builder: j.builder,
      provider: j.provider,
      run: j.run,
      briefId: j.briefId,
      category: j.category,
      simulated: ctx.dry,
      specFile,
    });
    writeResult(ctx, rec);
    return rec;
  });
}

/**
 * Every valid answer a builder gave (drafts and refused ones included), as
 * persons-sheet items: specTextForGate is all the text a spec carries —
 * objects have no labels — so this is everything Astra wrote. A photo
 * answer the product discards for want of its own camera 1 is still Astra's
 * words about the photo, so it is on the sheet too.
 */
export function personsItems(ctx: RunContext, records: readonly BuildRecord[], builders: (b: string) => boolean): SheetItemIn[] {
  const items: SheetItemIn[] = [];
  for (const r of records) {
    if (!builders(r.builder)) continue;
    for (const a of r.attempts) {
      if ((a.outcome !== "valid" && a.outcome !== "no_first_camera") || !a.answerFile) continue;
      const parsed = parseSetSpecText(readFileSync(join(ctx.runDir, a.answerFile), "utf8"));
      if (!parsed.ok) continue;
      const text = specTextForGate(parsed.spec);
      if (!text.trim()) continue;
      items.push({ source: { part: ctx.part, run: ctx.runId, buildId: r.buildId, attempt: a.attempt }, groupKey: r.briefId, text, images: [] });
    }
  }
  return items;
}

/**
 * Whatever never finished (interrupt, budget) is closed as not run, with the
 * reason — a retry that never ran included: its build's validity is unknown,
 * not the first attempt's failure. A draft in hand is delivered, as
 * production delivers the set in hand. Call it after saveState: state.json
 * keeps these attempts pending, for --resume.
 */
export function closeUnfinished(ctx: RunContext, jobs: readonly BuildJob[]): void {
  const stop = ctx.guard.stopped?.reason;
  const why = ctx.stopReason() === "sigint" || stop === "sigint" ? "not_run:interrupted" : stop === "budget" || stop === "overshoot" ? "not_run:budget" : "not_run:unfinished";
  for (const j of jobs) {
    if (j.state.final) continue;
    const s = j.state;
    s.final = s.draft
      ? { status: "delivered", use: "draft", spec: s.draft, fromAttempt: s.draftAttempt ?? 1, openAtDelivery: s.draftOpen ?? 0, note: `${why}: the draft is delivered` }
      : { status: "failed", failure: why, note: s.attempts === 0 ? why : `${why}: attempt ${s.attempts} came back ${s.pendingFailure ?? "?"} and its retry never ran` };
    s.next = null;
  }
}

/** Nothing stopped the run, no batch is still out, and every job reached its end: the only kind of run a bar may pass on. */
export function runComplete(ctx: RunContext, jobs: readonly BuildJob[], batchEnd: "done" | "stopped"): boolean {
  return batchEnd === "done" && ctx.stopReason() === null && jobs.every((j) => j.state.final !== null);
}
