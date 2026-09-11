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
//               one POST each. The harness retries a 429, a 5xx or a dropped
//               connection twice (waiting what the server asks, at most
//               30 s) before calling the attempt a transport failure.
//   simulated   the dry run's fakes (parts/simulate.mts).
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
import { withNetContext, type NetGuard } from "./net-guard.mts";
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

// ---------------------------------------------------------------------------
// Astra, background
// ---------------------------------------------------------------------------

export async function astraBackgroundAttempt(env: TransportEnv, s: BuildState, effort: AstraEffort): Promise<Attempt> {
  if (!s.next) throw new Error(`${s.buildId}: nothing to send`);
  const attemptNo = s.attempts + 1;
  const customId = customIdFor(s.buildId, attemptNo);
  const worst = s.next.kind === "first" ? env.book.astraFirstWorstUsd : env.book.astraRetryWorstUsd;
  if (env.stopping()) return notStarted(env, "background");
  const res = env.guard.reserve("astra", worst, customId);
  if (!res.ok) return env.interrupted() ? notStarted(env, "background") : { r: { state: "submit-failed", kind: "budget", detail: res.reason }, meta: zero("background") };
  const t0 = Date.now();
  const req = astraJobRequest(s.next.input, effort, env.part);
  const settled = { settled: true, tag: "astra", ref: customId };
  const sub = await withNetContext(settled, () => submitAstraJob(req));
  if (!sub.ok) {
    env.guard.release(res.ticket, `submit failed: ${sub.kind}`);
    return { r: { state: "submit-failed", kind: sub.kind, detail: sub.detail }, meta: zero("background") };
  }
  env.inflight.add(sub.responseId);
  let result: TransportResult | null = null;
  let stale = false;
  // The page's cadence (components/sets/sets-home.tsx): first look at 1.5 s,
  // then every 5 s, backing off to 30 s while polls fail (pollAstraJob reads
  // a dropped connection or a non-OK status as "working").
  let wait = 5000;
  const observe = { status: null as number | null };
  try {
    await sleep(1500);
    for (;;) {
      // Only Ctrl-C cancels a job in flight: a budget stop lets reserved work finish.
      if (env.interrupted()) {
        await withNetContext(settled, () => cancelAstraJob(sub.responseId));
        const after = pollResultToTransport(await withNetContext(settled, () => pollAstraJob(sub.responseId)));
        result = after ?? { state: "failed", kind: "cancelled", detail: "cancelled at interrupt", usage: null };
        break;
      }
      const polled = await withNetContext({ ...settled, observe }, () => pollAstraJob(sub.responseId));
      result = pollResultToTransport(polled);
      if (result) break;
      if (Date.now() - t0 > SET_BUILD_STALE_MS) {
        await withNetContext(settled, () => cancelAstraJob(sub.responseId));
        stale = true;
        result = { state: "failed", kind: "expired", detail: `no answer after ${SET_BUILD_STALE_MS / 60000} min; cancelled`, usage: null, stale: true };
        break;
      }
      wait = observe.status === 200 ? 5000 : Math.min(30_000, wait * 2);
      await sleep(wait);
    }
  } finally {
    env.inflight.delete(sub.responseId);
  }
  const latencyMs = Date.now() - t0;
  if (!result) throw new Error(`${customId}: poll loop ended without a result`);
  const meta = settleAstra(env, res.ticket, worst, result.state === "submit-failed" ? null : result.usage, "background", stale);
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
): AttemptMeta {
  if (usage) {
    const c = env.book.astraCost(usage, transport);
    env.guard.settle(ticket, c.billedUsd, c.standardUsd, `usage (${transport})`, usage);
    return { transport, billedUsd: c.billedUsd, standardUsd: c.standardUsd };
  }
  const flag = stale ? "stale: usage unknown, settled at the worst case" : "no usage returned: settled at the worst case";
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

async function postWithRetries(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<Posted> {
  const waits = [5_000, 15_000];
  for (let i = 0; ; i++) {
    let res: Response | null = null;
    let netError = "";
    try {
      res = await fetchWithTimeout(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) }, timeoutMs);
    } catch (e) {
      netError = e instanceof Error ? e.name : "error";
    }
    const retryable = res === null || res.status === 429 || res.status >= 500;
    if (retryable && i < waits.length) {
      const ra = Number(res?.headers.get("retry-after"));
      await res?.text().catch(() => "");
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30_000) : waits[i]);
      continue;
    }
    if (res === null) return { ok: false, status: null, code: undefined, detail: `network: ${netError}` };
    const json = (await res.json().catch(() => null)) as unknown;
    if (res.ok) return { ok: true, status: res.status, json };
    const err = isRecord(json) && isRecord(json.error) ? json.error : {};
    const code = typeof err.code === "string" ? err.code : typeof err.type === "string" ? err.type : undefined;
    const message = typeof err.message === "string" ? err.message.slice(0, 200) : "";
    return { ok: false, status: res.status, code, detail: `${res.status} ${code ?? ""} ${message}`.trim() };
  }
}

async function baselineAttempt(
  env: TransportEnv,
  s: BuildState,
  o: { kind: CallKind; model: string; provider: Provider; send: () => Promise<Posted>; read: (json: unknown) => Promise<TransportResult> },
): Promise<Attempt> {
  if (!s.next) throw new Error(`${s.buildId}: nothing to send`);
  const customId = customIdFor(s.buildId, s.attempts + 1);
  if (env.stopping()) return notStarted(env, "sync");
  const worst = env.book.baselineAttemptWorstUsd(o.model, s.next.kind === "first" ? "first" : "retry");
  let ticket: string | null = null;
  if (worst !== null) {
    const res = env.guard.reserve(o.kind, worst, customId);
    if (!res.ok) return env.interrupted() ? notStarted(env, "sync") : { r: { state: "submit-failed", kind: "budget", detail: res.reason }, meta: zero("sync") };
    ticket = res.ticket;
  }
  const t0 = Date.now();
  // Priced: settled here, so the meter skips it. Unpriced: metered by the tap.
  const posted = await withNetContext({ settled: ticket !== null, tag: `${o.kind}-build`, ref: customId }, o.send);
  const latencyMs = Date.now() - t0;
  if (!posted.ok) {
    if (ticket) env.guard.release(ticket, `request failed: ${posted.detail}`);
    const kind = posted.status === null ? "unavailable" : mapHttpError(posted.status, posted.code);
    return { r: { state: "submit-failed", kind, detail: posted.detail }, meta: zero("sync") };
  }
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
  return baselineAttempt(env, s, {
    kind: "mini-5.4",
    model: MINI_MODEL,
    provider: "openai",
    send: () => postWithRetries("https://api.openai.com/v1/responses", { authorization: `Bearer ${key}` }, miniRequestBody(s.next?.input ?? ""), 240_000),
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
  return baselineAttempt(env, s, {
    kind: "sonnet-5",
    model: SONNET_MODEL,
    provider: "anthropic",
    send: () =>
      postWithRetries(
        "https://api.anthropic.com/v1/messages",
        { "x-api-key": key, "anthropic-version": "2023-06-01" },
        sonnetRequestBody(s.next?.input ?? "", mode),
        300_000,
      ),
    read: async (json) => interpretSonnet(json),
  });
}
