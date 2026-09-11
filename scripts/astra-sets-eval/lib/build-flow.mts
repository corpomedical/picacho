// pollSetBuild without the database (src/lib/sets/actions.ts, as of
// 0f91c0c). The decisions are the product's own functions — parseSetSpecText,
// specTextForGate, decideAfterValidAnswer, closeRetryInput, setBuildInput,
// RETRY_SMALLER, SET_BUILD_MAX_ATTEMPTS — and this file only strings them
// together the way pollSetBuild does, one answer at a time:
//
//   answer parses, words refused      → the draft if there is one, else failed "refused"; no retry
//   answer parses, words allowed      → measure closure → decideAfterValidAnswer
//     retry-close                     → closeRetryInput(brief, sides, spec); this spec is the draft
//     mend returns                    → the more closed set wins; a tie goes to the mend
//   answer does not parse             → failure "invalid"
//   any failure while a draft exists  → deliver the draft
//   failure not refused/cancelled,
//     attempts < 2                    → setBuildInput(brief) (+ RETRY_SMALLER after "incomplete")
//   retry submit refused              → failed "refused"
//   close-retry submit failed         → deliver the spec in hand
//
// Deviations, all recorded on the build:
//   - stale is always false: a Batch round can take hours, and production's
//     15-minute staleness exists for LOST builds. A background attempt the
//     runner itself gave up on (transport says stale) ends as production's
//     stale branch does: the draft, or failed "lost".
//   - words gate "unavailable" (after the gate module's own retries) carries
//     on, flagged: never a refusal, and UNJUDGED in Part D.
//   - a first-attempt submit that failed on the wire (429, 5xx) is
//     not_run:transport — outside the validity denominator, counted apart.
//     "config" aborts the whole run.

import { parseSetSpecText, specInstanceCount, type SetSpec } from "../../../src/lib/sets/set-spec.ts";
import { closeRetryInput, decideAfterValidAnswer, RETRY_SMALLER } from "../../../src/lib/sets/build-retry.ts";
import { setBuildInput } from "../../../src/lib/sets/set-builder-prompt.ts";
import { SET_BUILD_MAX_ATTEMPTS } from "../../../src/lib/sets/set-config.ts";
import { tokenCounts, type Provider } from "./prices.mts";

export type Usage = Record<string, unknown>;

export type TransportResult =
  | { state: "done"; text: string; usage: Usage | null }
  | {
      state: "failed";
      kind: "refused" | "incomplete" | "failed" | "expired" | "cancelled";
      detail: string;
      usage: Usage | null;
      /** The runner gave up on it (background staleness): production's stale branch. */
      stale?: boolean;
    }
  | {
      state: "submit-failed";
      /** budget: the spend guard would not reserve it; stopped: Ctrl-C. Neither was sent. */
      kind: "config" | "refused" | "rate_limited" | "unavailable" | "bad_request" | "budget" | "stopped";
      detail: string;
    };

export type AttemptKind = "first" | "retry-plain" | "retry-smaller" | "retry-close-mend" | "retry-close-fresh";
export type WordsVerdict = "allowed" | { refused: string } | "unavailable" | "skipped";
export type TransportName = "batch" | "background" | "sync" | "simulated";

export type AttemptMeta = {
  transport: TransportName;
  billedUsd: number | null;
  standardUsd: number | null;
  latencyMs?: number;
  answerFile?: string;
  costFlag?: string;
};

export type AttemptRecord = {
  attempt: number;
  kind: AttemptKind;
  transport: TransportName;
  outcome: string;
  detail?: string;
  usage: Usage | null;
  billedUsd: number | null;
  standardUsd: number | null;
  latencyMs?: number;
  notes?: string[];
  instances?: number;
  openBearings?: number;
  openSides?: string[];
  words?: WordsVerdict;
  answerFile?: string;
  costFlag?: string;
};

export type BuildFinal =
  | { status: "delivered"; use: "answer" | "draft"; spec: SetSpec; fromAttempt: number; openAtDelivery: number; note?: string }
  | { status: "failed"; failure: string; note?: string };

export type BuildState = {
  buildId: string;
  brief: string;
  attempts: number;
  draft: SetSpec | null;
  draftOpen: number | null;
  draftAttempt: number | null;
  pendingFailure: string | null;
  log: AttemptRecord[];
  next: { input: string; kind: AttemptKind } | null;
  final: BuildFinal | null;
};

export type FlowDeps = {
  judgeWords(spec: SetSpec, ref: string): Promise<WordsVerdict>;
  /** measureClosure + describeOpenSides; a measurement that throws reads as closed, as in production. */
  closureOf(spec: SetSpec): { open: number; sides: string[] };
};

export class ConfigAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigAbort";
  }
}

export function startBuild(buildId: string, brief: string): BuildState {
  return {
    buildId,
    brief,
    attempts: 0,
    draft: null,
    draftOpen: null,
    draftAttempt: null,
    pendingFailure: null,
    log: [],
    next: { input: setBuildInput(brief), kind: "first" },
    final: null,
  };
}

const isClose = (k: AttemptKind) => k === "retry-close-mend" || k === "retry-close-fresh";

function deliverDraft(s: BuildState, note: string): BuildFinal {
  if (!s.draft) throw new Error(`${s.buildId}: no draft to deliver`);
  return { status: "delivered", use: "draft", spec: s.draft, fromAttempt: s.draftAttempt ?? 1, openAtDelivery: s.draftOpen ?? 0, note };
}

/** One answer (or failure) for the attempt in s.next. Mutates and returns s. */
export async function advanceBuild(s: BuildState, r: TransportResult, meta: AttemptMeta, deps: FlowDeps): Promise<BuildState> {
  if (s.final || !s.next) throw new Error(`build ${s.buildId} has nothing in flight`);
  const kind = s.next.kind;

  if (r.state === "submit-failed") {
    if (r.kind === "config") throw new ConfigAbort(`${s.buildId}: ${r.detail}`);
    s.log.push({ attempt: s.attempts + 1, kind, transport: meta.transport, outcome: `submit-failed:${r.kind}`, detail: r.detail, usage: null, billedUsd: 0, standardUsd: 0 });
    s.next = null;
    if (kind === "first") {
      s.final =
        r.kind === "refused"
          ? { status: "failed", failure: "refused", note: "Astra refused the brief at submit" }
          : r.kind === "bad_request"
            ? { status: "failed", failure: "start", note: r.detail }
            : r.kind === "budget"
              ? { status: "failed", failure: "not_run:budget" }
              : r.kind === "stopped"
                ? { status: "failed", failure: "not_run:interrupted" }
                : { status: "failed", failure: "not_run:transport", note: `${r.kind}: ${r.detail}` };
      return s;
    }
    if (isClose(kind)) {
      s.final = deliverDraft(s, `closing retry did not start (${r.kind}); the set in hand is delivered`);
      return s;
    }
    s.final = {
      status: "failed",
      failure: r.kind === "refused" ? "refused" : (s.pendingFailure ?? "failed"),
      note: `retry did not start (${r.kind})`,
    };
    return s;
  }

  s.attempts += 1;
  const attempt = s.attempts;
  const rec: AttemptRecord = {
    attempt,
    kind,
    transport: meta.transport,
    outcome: "",
    usage: r.usage,
    billedUsd: meta.billedUsd,
    standardUsd: meta.standardUsd,
    ...(meta.latencyMs !== undefined ? { latencyMs: meta.latencyMs } : {}),
    ...(meta.answerFile ? { answerFile: meta.answerFile } : {}),
    ...(meta.costFlag ? { costFlag: meta.costFlag } : {}),
  };
  s.log.push(rec);
  s.next = null;

  let failure: string;
  if (r.state === "done") {
    const parsed = parseSetSpecText(r.text);
    if (parsed.ok) {
      const spec = parsed.spec;
      rec.outcome = "valid";
      rec.notes = parsed.notes;
      rec.instances = specInstanceCount(spec);
      const words = await deps.judgeWords(spec, `${s.buildId}-a${attempt}`);
      rec.words = words;
      if (typeof words === "object") {
        s.final = s.draft ? deliverDraft(s, `words gate refused the closing retry's words (${words.refused})`) : { status: "failed", failure: "refused", note: `words gate: ${words.refused}` };
        return s;
      }
      const closure = deps.closureOf(spec);
      rec.openBearings = closure.open;
      rec.openSides = closure.sides;
      const next = decideAfterValidAnswer({
        open: closure.open,
        attempts: attempt,
        maxAttempts: SET_BUILD_MAX_ATTEMPTS,
        stale: false,
        draftOpen: s.draft ? s.draftOpen : null,
      });
      if (next.kind === "retry-close") {
        const input = closeRetryInput(s.brief, closure.sides, spec);
        s.draft = spec;
        s.draftOpen = closure.open;
        s.draftAttempt = attempt;
        s.next = { input, kind: input.includes("\n\nPrevious set: ") ? "retry-close-mend" : "retry-close-fresh" };
        return s;
      }
      s.final =
        next.use === "draft" && s.draft
          ? deliverDraft(s, "the draft was more closed than the mend")
          : { status: "delivered", use: "answer", spec, fromAttempt: attempt, openAtDelivery: closure.open };
      return s;
    }
    rec.outcome = parsed.reason;
    failure = "invalid";
  } else {
    rec.outcome = r.kind;
    rec.detail = r.detail;
    failure = r.kind;
    if (r.stale) {
      s.final = s.draft ? deliverDraft(s, "attempt abandoned as stale") : { status: "failed", failure: "lost", note: r.detail };
      return s;
    }
  }

  if (s.draft) {
    s.final = deliverDraft(s, `closing retry came back ${failure}`);
    return s;
  }
  if (failure !== "refused" && failure !== "cancelled" && attempt < SET_BUILD_MAX_ATTEMPTS) {
    s.pendingFailure = failure;
    s.next = {
      input: setBuildInput(s.brief) + (failure === "incomplete" ? RETRY_SMALLER : ""),
      kind: failure === "incomplete" ? "retry-smaller" : "retry-plain",
    };
    return s;
  }
  s.final = { status: "failed", failure };
  return s;
}

// ---------------------------------------------------------------------------
// The row a finished build becomes in results.jsonl.
// ---------------------------------------------------------------------------

export type BuildRecord = {
  type: "build";
  part: string;
  builder: string;
  provider: Provider;
  run: number;
  briefId: string;
  category: string;
  buildId: string;
  simulated: boolean;
  status: "delivered" | "failed";
  failure: string | null;
  notRun: string | null;
  use: "answer" | "draft" | null;
  note: string | null;
  firstValid: boolean;
  validWithinRetry: boolean;
  attempts: AttemptRecord[];
  openAtDelivery: number | null;
  instances: number | null;
  notes: string[];
  words: WordsVerdict | null;
  billedUsd: number | null;
  standardUsd: number | null;
  inputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  latencyMs: number | null;
  specFile: string | null;
};

const sumOrNull = (xs: (number | null)[]) => (xs.some((x) => x === null) ? null : xs.reduce<number>((a, b) => a + (b ?? 0), 0));

export function buildRecord(
  s: BuildState,
  m: { part: string; builder: string; provider: Provider; run: number; briefId: string; category: string; simulated: boolean; specFile: string | null },
): BuildRecord {
  const f: BuildFinal = s.final ?? { status: "failed", failure: "not_run:unfinished" };
  const delivered = f.status === "delivered" ? f : null;
  const counts = s.log.map((a) => tokenCounts(a.usage, m.provider));
  const add = (k: "freshInput" | "cachedInput" | "cacheWrite" | "output" | "reasoning") => counts.reduce((acc, c) => acc + (c ? c[k] : 0), 0);
  const ran = s.log.filter((a) => !a.outcome.startsWith("submit-failed"));
  const deliveredAttempt = delivered ? s.log.find((a) => a.attempt === delivered.fromAttempt) : undefined;
  const latencies = ran.map((a) => a.latencyMs).filter((x): x is number => typeof x === "number");
  return {
    type: "build",
    part: m.part,
    builder: m.builder,
    provider: m.provider,
    run: m.run,
    briefId: m.briefId,
    category: m.category,
    buildId: s.buildId,
    simulated: m.simulated,
    status: f.status,
    failure: f.status === "failed" ? f.failure : null,
    notRun: f.status === "failed" && f.failure.startsWith("not_run:") ? f.failure.slice(8) : null,
    use: delivered ? delivered.use : null,
    note: f.note ?? null,
    firstValid: s.log[0]?.outcome === "valid",
    validWithinRetry: s.log.some((a) => a.outcome === "valid"),
    attempts: s.log,
    openAtDelivery: delivered ? delivered.openAtDelivery : null,
    instances: delivered ? specInstanceCount(delivered.spec) : null,
    notes: deliveredAttempt?.notes ?? [],
    words: deliveredAttempt?.words ?? null,
    billedUsd: sumOrNull(s.log.map((a) => a.billedUsd)),
    standardUsd: sumOrNull(s.log.map((a) => a.standardUsd)),
    inputTokens: add("freshInput") + add("cachedInput") + add("cacheWrite"),
    cachedTokens: add("cachedInput"),
    cacheWriteTokens: add("cacheWrite"),
    outputTokens: add("output"),
    reasoningTokens: add("reasoning"),
    latencyMs: latencies.length ? latencies.reduce((a, b) => a + b, 0) : null,
    specFile: m.specFile,
  };
}
