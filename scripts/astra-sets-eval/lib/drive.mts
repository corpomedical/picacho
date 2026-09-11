// Drives builds to the end, over whichever transport each one uses, through
// the one state machine (build-flow.mts). Parts A, D and the canary hand it
// jobs; it hands back finished BuildStates.
//
//   batch       every build waiting on an attempt goes into one Batch round
//               (both Astra efforts share a file: same model); answers are
//               judged locally (words gate, closure), then every retry goes
//               into a second round. The whole round is reserved before
//               upload; lines that do not fit are not run (budget).
//   background  Astra, six in flight.
//   sync        the baselines, four in flight.
//   simulated   the dry run's fakes, reserved and settled like the real thing.
//
// state.json holds every job after each round, so --resume can re-attach a
// recorded batch and finish what was left.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AstraEffort } from "../../../src/lib/generations/providers/astra.ts";
import { parseSetSpecText, specTextForGate } from "../../../src/lib/sets/set-spec.ts";
import { advanceBuild, buildRecord, type AttemptMeta, type BuildRecord, type BuildState, type FlowDeps } from "./build-flow.mts";
import type { SheetItemIn } from "./blind-sheet.mts";
import { astraJobRequest, batchLineBody, customIdFor, MINI_MODEL, SONNET_MODEL } from "./builders.mts";
import { writeResult, type RunContext } from "./context.mts";
import { awaitRound, collectRound, lineToTransport, readBatches, submitRound, writeBatches, type BatchRound, type PendingLine } from "./openai-batch.mts";
import type { Provider } from "./prices.mts";
import { astraBackgroundAttempt, miniAttempt, settleAstra, sonnetAttempt, type Attempt, type TransportEnv } from "./transports.mts";
import { mapLimit, Semaphore } from "./util.mts";
import { capUsage, fakeAnswer } from "../parts/simulate.mts";

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
  const usage = capUsage(job.provider, s.next.kind, baseline);
  const r = fakeAnswer(job.index, attemptNo, usage);
  let billed: number | null;
  let standard: number | null;
  if (!baseline) {
    const t = job.transport === "batch" ? "batch" : "background";
    const std = s.next.kind === "first" ? ctx.book.astraFirstWorstUsd : ctx.book.astraRetryWorstUsd;
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
          if (job.firstOnly) stopAfterFirst(job.state);
        }
      });
      ctx.progress(`${job.state.buildId} ${job.state.final?.status ?? "unfinished"}`);
      o.onDone?.(job);
    },
    ctx.stopping,
  );
}

async function processRound(ctx: RunContext, rec: BatchRound, jobs: readonly BuildJob[], deps: FlowDeps, save: () => void): Promise<void> {
  const byBuild = new Map(jobs.map((j) => [j.state.buildId, j]));
  const results = await collectRound(rec);
  const open = new Set(ctx.guard.openTickets().map((t) => t.ticket));
  for (const line of rec.lines) {
    const job = byBuild.get(line.buildId);
    if (!job || job.state.final || job.state.attempts + 1 !== line.attempt) continue;
    const r = await lineToTransport(results.get(line.customId), ctx.net, rec.status, rec.errors);
    // A ticket already closed in the ledger (a crash after settling, before
    // state.json was saved) is not settled twice: the cost is read, not booked.
    const booked = !open.has(line.ticket);
    let meta: AttemptMeta;
    if (r.state === "submit-failed") {
      if (!booked) ctx.guard.release(line.ticket, `batch line not run: ${r.kind}`);
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
  save();
}

/**
 * Batch jobs: rounds until nothing waits on an attempt. Returns "stopped"
 * when Ctrl-C arrived while a batch was running (it keeps running at
 * OpenAI; --resume re-attaches it).
 */
export async function driveBatch(ctx: RunContext, jobs: readonly BuildJob[], allJobs: readonly BuildJob[], deps: FlowDeps, o: { resume: boolean }): Promise<"done" | "stopped"> {
  const batches = readBatches(ctx.runDir);
  const save = () => {
    writeBatches(ctx.runDir, batches);
    saveState(ctx, allJobs);
  };
  const pollMs = 60_000;
  if (o.resume) {
    const last = batches.rounds[batches.rounds.length - 1];
    if (last && !last.collected) {
      if (!last.batchId) {
        for (const l of last.lines) if (ctx.guard.openTickets().some((t) => t.ticket === l.ticket)) ctx.guard.release(l.ticket, "batch never created");
        last.status = "abandoned";
        last.collected = true;
        save();
      } else {
        ctx.progress(`re-attaching batch round ${last.round}`);
        if (!(await awaitRound({ runDir: ctx.runDir, rec: last, batches, pollMs, stopping: ctx.interrupted, progress: ctx.progress }))) return "stopped";
        await processRound(ctx, last, jobs, deps, save);
      }
    }
  }
  for (let rounds = 0; rounds < 4; rounds++) {
    const pending = jobs.filter((j) => j.state.next && !j.state.final);
    if (pending.length === 0) return "done";
    // Ctrl-C between rounds: leave every waiting attempt as it is in
    // state.json, for --resume to send.
    if (ctx.interrupted()) return "stopped";
    const lines: PendingLine[] = [];
    const bodies = new Map<string, Record<string, unknown>>();
    for (const j of pending) {
      const s = j.state;
      if (!s.next) continue;
      const attempt = s.attempts + 1;
      const customId = customIdFor(s.buildId, attempt);
      const worst = (s.next.kind === "first" ? ctx.book.astraFirstWorstUsd : ctx.book.astraRetryWorstUsd) * ctx.book.batchMultiplier;
      // A run the spend guard stopped reserves nothing new: the attempt is
      // closed as not started, and the flow decides what that means (a draft
      // in hand is delivered; a first attempt is not run).
      const res = ctx.guard.reserve("astra", worst, customId);
      if (!res.ok) {
        await advanceBuild(s, { state: "submit-failed", kind: "budget", detail: res.reason }, zero("batch"), deps);
        if (j.firstOnly) stopAfterFirst(s);
        continue;
      }
      lines.push({ customId, buildId: s.buildId, attempt, kind: s.next.kind, ticket: res.ticket, worstUsd: worst });
      bodies.set(customId, batchLineBody(astraJobRequest(s.next.input, j.effort ?? "low", ctx.part)));
    }
    save();
    if (lines.length === 0) continue;
    let rec: BatchRound;
    try {
      rec = await submitRound({ runDir: ctx.runDir, round: batches.rounds.length + 1, lines, bodies, metadata: { run: ctx.runId, part: ctx.part }, batches });
    } catch (e) {
      const open = batches.rounds[batches.rounds.length - 1];
      if (open && !open.batchId) {
        for (const l of open.lines) ctx.guard.release(l.ticket, "batch upload or create failed");
        open.status = "abandoned";
        open.collected = true;
        save();
      }
      throw e;
    }
    ctx.progress(`batch round ${rec.round}: ${lines.length} lines submitted (${rec.batchId})`);
    save();
    // Only Ctrl-C stops waiting: a budget stop lets a batch already paid for come back.
    if (!(await awaitRound({ runDir: ctx.runDir, rec, batches, pollMs, stopping: ctx.interrupted, progress: ctx.progress }))) return "stopped";
    await processRound(ctx, rec, jobs, deps, save);
  }
  return "done";
}

/** Every finished job as a results row, and each delivered set under specs/. */
export function recordBuilds(ctx: RunContext, jobs: readonly BuildJob[]): BuildRecord[] {
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
 * objects have no labels — so this is everything Astra wrote.
 */
export function personsItems(ctx: RunContext, records: readonly BuildRecord[], builders: (b: string) => boolean): SheetItemIn[] {
  const items: SheetItemIn[] = [];
  for (const r of records) {
    if (!builders(r.builder)) continue;
    for (const a of r.attempts) {
      if (a.outcome !== "valid" || !a.answerFile) continue;
      const parsed = parseSetSpecText(readFileSync(join(ctx.runDir, a.answerFile), "utf8"));
      if (!parsed.ok) continue;
      const text = specTextForGate(parsed.spec);
      if (!text.trim()) continue;
      items.push({ source: { part: ctx.part, run: ctx.runId, buildId: r.buildId, attempt: a.attempt }, groupKey: r.briefId, text, images: [] });
    }
  }
  return items;
}

/** Whatever never finished (interrupt, budget) is closed as not run, with the reason. */
export function closeUnfinished(ctx: RunContext, jobs: readonly BuildJob[]): void {
  const why = ctx.guard.stopped?.reason === "budget" ? "not_run:budget" : ctx.stopReason() === "sigint" ? "not_run:interrupted" : "not_run:unfinished";
  for (const j of jobs) {
    if (j.state.final) continue;
    j.state.final = j.state.draft
      ? { status: "delivered", use: "draft", spec: j.state.draft, fromAttempt: j.state.draftAttempt ?? 1, openAtDelivery: j.state.draftOpen ?? 0, note: `${why}: the draft is delivered` }
      : { status: "failed", failure: j.state.attempts === 0 ? why : (j.state.pendingFailure ?? why), note: why };
    j.state.next = null;
  }
}
