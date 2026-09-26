import type { AttemptLog } from "../generations/pipeline";
import {
  failureKind,
  isProviderBalanceFailure,
  providerWordsFromAttempts,
  summarizeFailureDetail,
} from "../generations/report-constants";

// What reaches the OPERATOR's phone when the product is in trouble, and how
// often (2026-09-26, operator: "Build all three", after a talk asking who
// supports an AI-built app at 2 AM). Before this, a render that failed in the
// job runner — every video, by webhook, poll or reaper — filed a report and
// told nobody; a model the circuit breaker switched off, a scheduled job that
// died, and a fal balance running down were all silent until someone opened
// Admin. The customer was refunded; the operator found out from a customer.
//
// This file decides: which pushes, with which words, damped over which
// window. admin-alerts.ts does the sending. Pure and alias-free (relative
// imports only) so every rule here is unit-tested without Supabase.

export type AdminPush = { title: string; body: string; path: string };

/**
 * Seconds each alert stays quiet after it fires, per key. All far under
 * RATE_HITS_LONGEST_WINDOW_SECONDS (rate-hits.ts), whose daily prune must
 * never take a row a window still counts: alert-rules.test.ts holds them to it.
 */
export const ALERT_WINDOWS = {
  /** One siren per half hour whatever path saw the lock — the in-request siren's window since 2026-08-25. */
  providerBalance: 30 * 60,
  /** The window failed renders are counted in. */
  failureCount: 15 * 60,
  /** At most one "renders are failing" an hour; a lasting outage re-alerts hourly. */
  failureBurst: 60 * 60,
  /** Per model. Two failures finishing together make one alert, not two. */
  modelOff: 10 * 60,
  /** Per scheduled job. The minute jobs would otherwise buzz sixty times an hour. */
  jobFailed: 3 * 60 * 60,
  /** fal below ten of the priciest renders: a reminder, twice a working day. */
  falLow: 6 * 60 * 60,
  /** fal below one render: every hourly check until it is topped up. */
  falCritical: 60 * 60,
} as const;

/** Failures inside ALERT_WINDOWS.failureCount that make a burst. */
export const FAILURE_BURST = 3;

const clip = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

/** The same siren the in-request path has sent since the 2026-08-25 fal lock. */
export function balanceSiren(words: string): AdminPush {
  return {
    title: "🚨 Provider account locked — renders are failing",
    body: `${clip(words, 120)} — every generation fails until the balance is topped up.`,
    path: "#system",
  };
}

const GENERIC_SUMMARY = /^Generation failed after \d+ attempts?\.$/;

// What the operator reads: the provider's own words when a raw error was
// logged, else the report's summary, else — when that is only the generic
// "failed after N attempts" — the last verdict step's sentence (the reaper's
// "This render didn't finish in time and was stopped." is one).
function operatorWords(attempts: AttemptLog[], summary: string): string {
  const provider = providerWordsFromAttempts(attempts);
  if (provider) return provider;
  if (!GENERIC_SUMMARY.test(summary)) return summary;
  for (let a = attempts.length - 1; a >= 0; a--) {
    const step = [...attempts[a].steps]
      .reverse()
      .find(
        (s) =>
          (s.step === "generate" || s.step === "validate") &&
          !s.detail.startsWith("Generated") &&
          !s.detail.startsWith("Mock "),
      );
    if (step?.detail) return step.detail.split("\n")[0];
  }
  return summary;
}

export type RenderFailureAlert =
  /** Stopped, walked away from, or refused on purpose: nothing broke. */
  | { kind: "none" }
  /** The provider account is out of money: every render will fail. */
  | { kind: "balance"; push: AdminPush }
  /** Something broke: count it, and send `burst` if it makes one. */
  | { kind: "count"; burst: AdminPush };

/**
 * What a render that failed in the job runner asks of the alerts. The words
 * are the provider's own (admin-facing), falling back to the report summary.
 */
export function renderFailureAlert(input: {
  fault?: string;
  attempts: AttemptLog[];
  /** A model's name, or its id when the catalogue doesn't know it. */
  modelLabel: string;
}): RenderFailureAlert {
  if (input.fault === "user_cancelled" || input.fault === "abandoned") return { kind: "none" };
  const summary = summarizeFailureDetail(input.attempts);
  if (summary === null) return { kind: "none" }; // stopped on purpose
  const words = operatorWords(input.attempts, summary);
  if (isProviderBalanceFailure(words) || isProviderBalanceFailure(summary)) {
    return { kind: "balance", push: balanceSiren(words) };
  }
  // A refusal is a rule doing its job — a provider's filter, our gates, the
  // account's brand rules. Moderation and the failure rate show those; the
  // phone is for things that broke.
  if (failureKind(input.attempts) !== "broke") return { kind: "none" };
  return {
    kind: "count",
    burst: {
      title: "Renders are failing",
      body: `${FAILURE_BURST} or more failed in ${ALERT_WINDOWS.failureCount / 60} minutes. Latest: ${clip(
        input.modelLabel,
        40,
      )}: ${clip(words, 100)}`,
      path: "#system",
    },
  };
}

/** A model the circuit breaker has just taken out of service. */
export function modelOffAlert(input: {
  modelLabel: string;
  lastError: string | null;
  retryAfter: string | null;
  now: number;
}): AdminPush {
  const retryMs = input.retryAfter ? Date.parse(input.retryAfter) - input.now : NaN;
  const back = Number.isFinite(retryMs)
    ? `It gets one trial render in ${Math.max(1, Math.round(retryMs / 60_000))} min.`
    : "It stays off until a trial render works.";
  return {
    title: `${clip(input.modelLabel, 50)} switched off`,
    body: `It kept failing, so new renders move to another model where they can. ${back} Last error: ${clip(
      input.lastError ?? "none recorded",
      90,
    )}`,
    path: "#system",
  };
}

/** A scheduled job (vercel.json crons) that answered 5xx or threw. */
export function jobFailedAlert(job: string, message: string): AdminPush {
  return {
    title: `Scheduled job failed: ${clip(job, 30)}`,
    body: `${clip(message || "No message.", 110)} It runs again on its schedule; this alert stays quiet for ${
      ALERT_WINDOWS.jobFailed / 3600
    } h.`,
    path: "#system",
  };
}

// ---------------------------------------------------------------------------
// Counting and damping, with the limiter and the sender passed in (the real
// ones are bound in admin-alerts.ts), so the order of checks is tested too.
// ---------------------------------------------------------------------------

/** true: under the limit, and counted. false: at it. null: the check failed. */
export type Limiter = (key: string, windowSeconds: number, max: number) => Promise<boolean | null>;
export type Sender = (push: AdminPush) => Promise<void>;

/** Sends unless `key` already sent inside the window. A failed check sends: one alert too many beats a silent outage. */
export async function sendOnce(
  limit: Limiter,
  send: Sender,
  key: string,
  windowSeconds: number,
  push: AdminPush,
): Promise<boolean> {
  if ((await limit(key, windowSeconds, 1)) === false) return false;
  await send(push);
  return true;
}

export type RenderFailureOutcome = "none" | "siren" | "siren-damped" | "counted" | "burst" | "burst-damped";

/**
 * Acts on renderFailureAlert's verdict. A broke failure is counted while
 * fewer than FAILURE_BURST - 1 are in the window; the one that finds the
 * window full is the burst. A failed count is treated as a burst, so the
 * damper — which fails open — decides.
 */
export async function actOnRenderFailure(
  limit: Limiter,
  send: Sender,
  verdict: RenderFailureAlert,
): Promise<RenderFailureOutcome> {
  if (verdict.kind === "none") return "none";
  if (verdict.kind === "balance") {
    return (await sendOnce(limit, send, "provider-balance", ALERT_WINDOWS.providerBalance, verdict.push))
      ? "siren"
      : "siren-damped";
  }
  if ((await limit("render-failures", ALERT_WINDOWS.failureCount, FAILURE_BURST - 1)) === true) return "counted";
  return (await sendOnce(limit, send, "render-failure-burst", ALERT_WINDOWS.failureBurst, verdict.burst))
    ? "burst"
    : "burst-damped";
}

/**
 * Wraps a cron route's handler: a 5xx answer or a throw calls `onFail` with
 * the job's name and what it said, then goes out exactly as before. A 401 —
 * a caller without the secret — is not the job failing.
 */
export function wrapJob(
  job: string,
  handler: (request: Request) => Promise<Response>,
  onFail: (job: string, message: string) => Promise<void>,
): (request: Request) => Promise<Response> {
  return async function GET(request: Request): Promise<Response> {
    let res: Response;
    try {
      res = await handler(request);
    } catch (err) {
      await onFail(job, err instanceof Error ? err.message : String(err));
      throw err;
    }
    if (res.status >= 500) {
      let said = `It answered ${res.status}.`;
      try {
        const body = (await res.clone().json()) as { error?: unknown } | null;
        if (typeof body?.error === "string" && body.error) said = `It answered ${res.status}: ${body.error}.`;
      } catch {
        // Not JSON: the status says enough.
      }
      await onFail(job, said);
    }
    return res;
  };
}

/**
 * The fal balance against the priciest single render — the same two lines
 * Admin → AI Providers draws (critical: can't pay for one; low: under ten).
 */
export function falBalanceAlert(input: {
  balanceUsd: number;
  worstRenderUsd: number;
}): { level: "critical" | "low"; push: AdminPush } | null {
  const { balanceUsd: b, worstRenderUsd: w } = input;
  if (!(w > 0) || !Number.isFinite(b)) return null;
  const money = (n: number) => `$${n.toFixed(2)}`;
  if (b < w) {
    return {
      level: "critical",
      push: {
        title: "🚨 fal balance can't pay for a render",
        body: `${money(b)} left, less than the priciest render (${money(w)}). Videos will start failing. Top up at fal.ai → Billing.`,
        path: "#system",
      },
    };
  }
  if (b < w * 10) {
    return {
      level: "low",
      push: {
        title: "fal balance is low",
        body: `${money(b)} left, about ${Math.floor(b / w)} of the priciest renders (${money(w)} each). Top up at fal.ai → Billing.`,
        path: "#system",
      },
    };
  }
  return null;
}
