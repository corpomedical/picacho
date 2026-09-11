// One build attempt, over each transport. Every attempt is RESERVED before
// it is sent (at its worst case) and SETTLED from the usage that comes back
// — or at the worst case, flagged, when no usage does. Unpriced baselines
// cannot be reserved; they run in an unsettled context instead, so the net
// guard's meter records their tokens (and --allow-unpriced must have named
// them before the run started).
//
//   background  the product's submitAstraJob / pollAstraJob / cancelAstraJob,
//               unchanged. First poll at 1.5 s, then every 5 s; given up at
//               SET_BUILD_STALE_MS and cancelled, as production would.
//   sync        gpt-5.4-mini (Responses) and claude-sonnet-5 (Messages),
//               one POST each.
//   simulated   the dry run's fakes (parts/simulate.mts).
//
// WHEN A REQUEST GOES WRONG (the background submit and the sync POST alike):
//   a 429 or 5xx       the provider answered no: nothing runs, the ticket is
//                      released, and the request is sent again twice
//                      (waiting what the server asks, at most 30 s), each
//                      time under a fresh reservation
//   no answer          a timeout or a dropped connection after the request
//                      went out: it may be running, and billing, with an id
//                      nobody knows. It is booked at its worst case, flagged
//                      "outcome unknown", and never sent again (an unpriced
//                      baseline gets a ledger line instead)
//
// The Batch transport lives in openai-batch.mts.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cancelAstraJob, pollAstraJob, submitAstraJob, type AstraEffort, type AstraPollResult } from "../../../src/lib/generations/providers/astra.ts";
import { fetchWithTimeout } from "../../../src/lib/generations/providers/fetch-with-timeout.ts";
import { SET_BUILD_STALE_MS } from "../../../src/lib/sets/set-config.ts";
import type { AttemptMeta, BuildState, TransportResult } from "./build-flow.mts";
import { astraJobRequest, customIdFor, interpretSonnet, mapHttpError, MINI_MODEL, miniRequestBody, SONNET_MODEL, sonnetRequestBody } from "./builders.mts";
import type { CallKind } from "./ledger.mts";
import { withNetContext, type NetGuard, type Observe } from "./net-guard.mts";
import type { PriceBook, Provider } from "./prices.mts";
import type { SpendGuard } from "./spend-guard.mts";
import { isRecord, sleep } from "./util.mts";

export type Attempt = { r: TransportResult; meta: AttemptMeta };

/** What every transport needs from the run. */
export type TransportEnv = {
  part: string;
  book: PriceBook;
  guard: SpendGuard;
  net: NetGuard;
  answersDir: string;
  /** Start nothing new (budget, overshoot, Ctrl-C). */
  stopping: () => boolean;
  /** Ctrl-C: cancel what is in flight. */
  interrupted: () => boolean;
  /** Background response ids in flight, for Ctrl-C. */
  inflight: Set<string>;
};

const zero = (transport: AttemptMeta["transport"]): AttemptMeta => ({ transport, billedUsd: 0, standardUsd: 0 });

/** Why a new attempt may not start: the spend guard's stop, or Ctrl-C. */
function notStarted(env: Pick<TransportEnv, "guard" | "interrupted">, transport: AttemptMeta["transport"]): Attempt {
  const kind = env.interrupted() ? "stopped" : "budget";
  return { r: { state: "submit-failed", kind, detail: env.guard.stopped ? `run stopped (${env.guard.stopped.reason})` : "run stopping" }, meta: zero(transport) };
}

function saveAnswer(env: TransportEnv, customId: string, text: string): string {
  const file = `answers/${customId}.txt`;
  writeFileSync(join(env.answersDir, `${customId}.txt`), text);
  return file;
}

export function pollResultToTransport(p: AstraPollResult): TransportResult | null {
  if (p.state === "working") return null;
  if (p.state === "done") return { state: "done", text: p.text, usage: (p.usage as Record<string, unknown> | null) ?? null };
  return { state: "failed", kind: p.kind, detail: p.detail, usage: (p.usage as Record<string, unknown> | null) ?? null };
}

/** The waits before sending again after a 429 or 5xx (two resends). */
export const RESEND_WAITS_MS = [5_000, 15_000] as const;

/** What the server asked for (retry-after, seconds), at most 30 s; else the fallback. */
export function waitFor(retryAfter: string | null | undefined, fallbackMs: number): number {
  const ra = Number(retryAfter);
  return retryAfter && Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30_000) : fallbackMs;
}

/**
 * The request went out and no usable answer came back: a timeout or a
 * dropped connection (-1), or a 2xx the runner could not read. The job may
 * be running at the provider. (null: nothing was sent.)
 */
export function unanswered(o: Observe): boolean {
  return o.status === -1 || (o.status !== null && o.status >= 200 && o.status < 300);
}

export const UNKNOWN_FLAG = "outcome unknown (sent, no answer): settled at the worst case";

// ---------------------------------------------------------------------------
// Astra, background
// ---------------------------------------------------------------------------

export async function astraBackgroundAttempt(env: TransportEnv, s: BuildState, effort: AstraEffort): Promise<Attempt> {
  if (!s.next) throw new Error(`${s.buildId}: nothing to send`);
  const attemptNo = s.attempts + 1;
  const customId = customIdFor(s.buildId, attemptNo);
  const worst = s.next.kind === "first" ? env.book.astraFirstWorstUsd : env.book.astraRetryWorstUsd;
  const t0 = Date.now();
  const req = astraJobRequest(s.next.input, effort, env.part);
  const settled = { settled: true, tag: "astra", ref: customId };
  let ticket = "";
  let responseId = "";
  for (let i = 0; ; i++) {
    if (env.stopping()) return notStarted(env, "background");
    const res = env.guard.reserve("astra", worst, customId);
    if (!res.ok) return env.interrupted() ? notStarted(env, "background") : { r: { state: "submit-failed", kind: "budget", detail: res.reason }, meta: zero("background") };
    const observe: Observe = { status: null };
    const sub = await withNetContext({ ...settled, observe }, () => submitAstraJob(req));
    if (sub.ok) {
      ticket = res.ticket;
      responseId = sub.responseId;
      break;
    }
    if (unanswered(observe)) {
      // The job may exist, billed, with an id nobody knows (it can be
      // neither polled nor cancelled): booked at the worst case, never resent.
      const meta = settleAstra(env, res.ticket, worst, null, "background", false, UNKNOWN_FLAG);
      return { r: { state: "submit-failed", kind: "unavailable", detail: `${sub.detail} (no answer to the submit: booked at the worst case)` }, meta };
    }
    env.guard.release(res.ticket, `submit refused: ${sub.kind}${observe.status !== null ? ` (${observe.status})` : " (not sent)"}`);
    if ((sub.kind === "rate_limited" || sub.kind === "unavailable") && observe.status !== null && i < RESEND_WAITS_MS.length) {
      await sleep(waitFor(observe.retryAfter, RESEND_WAITS_MS[i]));
      continue;
    }
    return { r: { state: "submit-failed", kind: sub.kind, detail: sub.detail }, meta: zero("background") };
  }
  env.inflight.add(responseId);
  let result: TransportResult | null = null;
  let stale = false;
  // The page's cadence (components/sets/sets-home.tsx): first look at 1.5 s,
  // then every 5 s, backing off to 30 s while polls fail (pollAstraJob reads
  // a dropped connection or a non-OK status as "working").
  let wait = 5000;
  const observe: Observe = { status: null };
  try {
    await sleep(1500);
    for (;;) {
      // Only Ctrl-C cancels a job in flight: a budget stop lets reserved work finish.
      if (env.interrupted()) {
        await withNetContext(settled, () => cancelAstraJob(responseId));
        const after = pollResultToTransport(await withNetContext(settled, () => pollAstraJob(responseId)));
        // An answer that finished before the cancel landed is the model's;
        // a job the cancel stopped is voided (build-flow.mts), not counted.
        result =
          after && !(after.state === "failed" && after.kind === "cancelled")
            ? after
            : { state: "failed", kind: "cancelled", detail: "cancelled by the runner at Ctrl-C", usage: after?.state === "failed" ? after.usage : null, interrupted: true };
        break;
      }
      const polled = await withNetContext({ ...settled, observe }, () => pollAstraJob(responseId));
      result = pollResultToTransport(polled);
      if (result) break;
      if (Date.now() - t0 > SET_BUILD_STALE_MS) {
        await withNetContext(settled, () => cancelAstraJob(responseId));
        stale = true;
        result = { state: "failed", kind: "expired", detail: `no answer after ${SET_BUILD_STALE_MS / 60000} min; cancelled`, usage: null, stale: true };
        break;
      }
      wait = observe.status === 200 ? 5000 : Math.min(30_000, wait * 2);
      await sleep(wait);
    }
  } finally {
    env.inflight.delete(responseId);
  }
  const latencyMs = Date.now() - t0;
  if (!result) throw new Error(`${customId}: poll loop ended without a result`);
  const meta = settleAstra(env, ticket, worst, result.state === "submit-failed" ? null : result.usage, "background", stale);
  if (result.state === "done") meta.answerFile = saveAnswer(env, customId, result.text);
  meta.latencyMs = latencyMs;
  return { r: result, meta };
}

/** Settle an Astra attempt from its usage, or at the worst case (flagged) when none came back. */
export function settleAstra(
  env: Pick<TransportEnv, "guard" | "book">,
  ticket: string,
  worst: number,
  usage: Record<string, unknown> | null,
  transport: "batch" | "background",
  stale = false,
  why?: string,
): AttemptMeta {
  if (usage) {
    const c = env.book.astraCost(usage, transport);
    env.guard.settle(ticket, c.billedUsd, c.standardUsd, `usage (${transport})`, usage);
    return { transport, billedUsd: c.billedUsd, standardUsd: c.standardUsd };
  }
  const flag = why ?? (stale ? "stale: usage unknown, settled at the worst case" : "no usage returned: settled at the worst case");
  const standard = transport === "batch" ? worst / env.book.batchMultiplier : worst;
  env.guard.settle(ticket, worst, standard, flag, null);
  return { transport, billedUsd: worst, standardUsd: standard, costFlag: flag };
}

// ---------------------------------------------------------------------------
// Baselines, sync
// ---------------------------------------------------------------------------

type Posted =
  | { ok: true; status: number; json: unknown }
  | { ok: false; status: number | null; code: string | undefined; detail: string };

/** One POST, no resend: the caller decides, knowing whether an answer came back. */
async function postOnce(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<Posted> {
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) }, timeoutMs);
  } catch (e) {
    return { ok: false, status: null, code: undefined, detail: `no answer (${e instanceof Error ? e.name : "error"})` };
  }
  const json = (await res.json().catch(() => null)) as unknown;
  if (res.ok) return { ok: true, status: res.status, json };
  const err = isRecord(json) && isRecord(json.error) ? json.error : {};
  const code = typeof err.code === "string" ? err.code : typeof err.type === "string" ? err.type : undefined;
  const message = typeof err.message === "string" ? err.message.slice(0, 200) : "";
  return { ok: false, status: res.status, code, detail: `${res.status} ${code ?? ""} ${message}`.trim() };
}

async function baselineAttempt(
  env: TransportEnv,
  s: BuildState,
  o: { kind: CallKind; model: string; provider: Provider; url: string; send: () => Promise<Posted>; read: (json: unknown) => Promise<TransportResult> },
): Promise<Attempt> {
  if (!s.next) throw new Error(`${s.buildId}: nothing to send`);
  const customId = customIdFor(s.buildId, s.attempts + 1);
  const worst = env.book.baselineAttemptWorstUsd(o.model, s.next.kind === "first" ? "first" : "retry");
  const t0 = Date.now();
  let posted: Posted | null = null;
  let ticket: string | null = null;
  for (let i = 0; ; i++) {
    if (env.stopping()) return notStarted(env, "sync");
    ticket = null;
    if (worst !== null) {
      const res = env.guard.reserve(o.kind, worst, customId);
      if (!res.ok) return env.interrupted() ? notStarted(env, "sync") : { r: { state: "submit-failed", kind: "budget", detail: res.reason }, meta: zero("sync") };
      ticket = res.ticket;
    }
    const observe: Observe = { status: null };
    // Priced: settled here, so the meter skips it. Unpriced: metered by the tap.
    posted = await withNetContext({ settled: ticket !== null, tag: `${o.kind}-build`, ref: customId, observe }, o.send);
    if (posted.ok) break;
    if (observe.status === -1) {
      // Sent, and no answer: the provider may finish it and bill it. Booked
      // (at the worst case, or as an unpriced ledger line), never resent.
      let meta = zero("sync");
      if (ticket) {
        env.guard.settle(ticket, worst ?? 0, worst ?? 0, UNKNOWN_FLAG, null);
        meta = { transport: "sync", billedUsd: worst, standardUsd: worst, costFlag: UNKNOWN_FLAG };
      } else {
        env.guard.meter({ host: new URL(o.url).hostname, model: o.model, usage: {}, usd: null, tag: `${o.kind}-build: sent, no answer (unpriced, usage unknown)`, ref: customId });
      }
      return { r: { state: "submit-failed", kind: "unavailable", detail: posted.detail }, meta };
    }
    if (ticket) env.guard.release(ticket, `request refused: ${posted.detail}`);
    const resend = posted.status !== null && (posted.status === 429 || posted.status >= 500) && i < RESEND_WAITS_MS.length;
    if (!resend) {
      const kind = posted.status === null ? "unavailable" : mapHttpError(posted.status, posted.code);
      return { r: { state: "submit-failed", kind, detail: posted.detail }, meta: zero("sync") };
    }
    await sleep(waitFor(observe.retryAfter, RESEND_WAITS_MS[i]));
  }
  const latencyMs = Date.now() - t0;
  const r = await o.read(posted.json);
  const usage = r.state === "submit-failed" ? null : r.usage;
  const cost = usage ? env.book.modelCost(o.model, usage, o.provider) : null;
  const meta: AttemptMeta = { transport: "sync", billedUsd: cost, standardUsd: cost, latencyMs };
  if (ticket) {
    if (cost !== null) env.guard.settle(ticket, cost, cost, "usage (sync)", usage);
    else {
      env.guard.settle(ticket, worst ?? 0, worst ?? 0, "no priced usage: settled at the worst case", usage);
      meta.billedUsd = worst;
      meta.standardUsd = worst;
      meta.costFlag = "no priced usage: settled at the worst case";
    }
  }
  if (r.state === "done") meta.answerFile = saveAnswer(env, customId, r.text);
  return { r, meta };
}

export function miniAttempt(env: TransportEnv, s: BuildState): Promise<Attempt> {
  const key = process.env.OPENAI_API_KEY ?? "";
  const url = "https://api.openai.com/v1/responses";
  return baselineAttempt(env, s, {
    kind: "mini-5.4",
    model: MINI_MODEL,
    provider: "openai",
    url,
    send: () => postOnce(url, { authorization: `Bearer ${key}` }, miniRequestBody(s.next?.input ?? ""), 240_000),
    // Read through the product's own interpreter: the answer is served to
    // pollAstraJob from memory (net-guard), never fetched again.
    read: async (json) => {
      const id = isRecord(json) && typeof json.id === "string" ? json.id : "";
      if (!id) return { state: "failed", kind: "failed", detail: "no response id", usage: isRecord(json) && isRecord(json.usage) ? json.usage : null };
      env.net.setOpenAiResponse(id, json);
      try {
        const p = await pollAstraJob(id);
        return pollResultToTransport(p) ?? { state: "failed", kind: "failed", detail: "answer still in progress", usage: null };
      } finally {
        env.net.deleteOpenAiResponse(id);
      }
    },
  });
}

export function sonnetAttempt(env: TransportEnv, s: BuildState, mode: "format" | "prompt"): Promise<Attempt> {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  const url = "https://api.anthropic.com/v1/messages";
  return baselineAttempt(env, s, {
    kind: "sonnet-5",
    model: SONNET_MODEL,
    provider: "anthropic",
    url,
    send: () => postOnce(url, { "x-api-key": key, "anthropic-version": "2023-06-01" }, sonnetRequestBody(s.next?.input ?? "", mode), 300_000),
    read: async (json) => interpretSonnet(json),
  });
}
