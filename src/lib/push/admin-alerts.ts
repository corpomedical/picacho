import { createAdminClient } from "@/lib/supabase/server";
import { hashedRateKey } from "@/lib/rate-limit";
import { notifyAdmins } from "@/lib/push/web-push";
import type { AttemptLog } from "@/lib/generations/pipeline";
import { VIDEO_MODELS, maxSingleRenderCostUsd } from "@/lib/generations/providers/video-models";
import { IMAGE_MODELS } from "@/lib/generations/providers/image-models";
import { getFalBalance } from "@/lib/generations/providers/fal-ledger";
import {
  ALERT_WINDOWS,
  actOnRenderFailure,
  falBalanceAlert,
  jobFailedAlert,
  modelOffAlert,
  renderFailureAlert,
  sendOnce,
  wrapJob,
  type Limiter,
  type Sender,
} from "@/lib/push/alert-rules";

// Sends the operator's alerts (2026-09-26). The rules — which alert, which
// words, how long it stays quiet, in what order — are alert-rules.ts, tested
// there; this file binds the real limiter and sender. Every function here
// swallows its own errors: each call site is a paid render finishing, a
// breaker tripping or a cron running, and an alert must never break the
// thing it reports on.
//
// COUNTING AND DAMPING reuse the rate limiter's table through its atomic
// check-and-insert (public.api_rate_check, schema.sql): under a salted key per
// alert it answers "under the limit?" and records the call only when it is.
// So max 1 per window is "the first time in this window", and max N-1 per
// window turns the Nth failure inside it into the burst. No new table, and
// it holds across every serverless instance at once. Called with the service
// role directly rather than through rateLimited(), which fails CLOSED — right
// for a paid endpoint, wrong here, where a limiter hiccup must mean one alert
// too many, never a silent outage.

const limit: Limiter = async (key, windowSeconds, max) => {
  try {
    const { data, error } = await createAdminClient().rpc("api_rate_check", {
      p_user_id: hashedRateKey(key, "admin-alert"),
      p_window_seconds: windowSeconds,
      p_max: max,
      p_scope: "admin-alert",
    });
    if (error) {
      console.error(`admin-alerts: limiter unavailable for ${key}:`, error.message);
      return null;
    }
    return data === true;
  } catch (err) {
    console.error(`admin-alerts: limiter unavailable for ${key}:`, err);
    return null;
  }
};

// notifyAdmins never throws and does nothing without VAPID keys or devices.
const send: Sender = (push) => notifyAdmins(push);

/** Whether the half-hour provider-balance siren may sound — shared with reports.ts's in-request path. */
export async function balanceSirenAllowed(): Promise<boolean> {
  return (await limit("provider-balance", ALERT_WINDOWS.providerBalance, 1)) !== false;
}

/** A model's name for the operator; the raw id when the catalogues don't know it. */
export function modelLabel(modelId: string): string {
  if (!modelId) return "an unnamed model";
  return (
    VIDEO_MODELS.find((m) => m.id === modelId)?.name ??
    IMAGE_MODELS.find((m) => m.id === modelId)?.name ??
    modelId
  );
}

/**
 * A render that failed in the job runner (finish()): a provider out of money
 * sounds the siren; anything that broke counts toward a burst.
 */
export async function alertRenderFailure(input: {
  fault?: string;
  attempts: AttemptLog[];
  modelId: string;
}): Promise<void> {
  try {
    await actOnRenderFailure(
      limit,
      send,
      renderFailureAlert({ fault: input.fault, attempts: input.attempts, modelLabel: modelLabel(input.modelId) }),
    );
  } catch (err) {
    console.error("admin-alerts: render failure alert failed:", err);
  }
}

/** The circuit breaker just took a model out of service (model-health.ts). */
export async function alertModelOff(input: {
  modelId: string;
  lastError: string | null;
  retryAfter: string | null;
}): Promise<void> {
  try {
    await sendOnce(
      limit,
      send,
      `model-off:${input.modelId}`,
      ALERT_WINDOWS.modelOff,
      modelOffAlert({
        modelLabel: modelLabel(input.modelId),
        lastError: input.lastError,
        retryAfter: input.retryAfter,
        now: Date.now(),
      }),
    );
  } catch (err) {
    console.error("admin-alerts: model-off alert failed:", err);
  }
}

/** A scheduled job failed. Damped per job. */
export async function alertJobFailed(job: string, message: string): Promise<void> {
  try {
    await sendOnce(limit, send, `job:${job}`, ALERT_WINDOWS.jobFailed, jobFailedAlert(job, message));
  } catch (err) {
    console.error("admin-alerts: job alert failed:", err);
  }
}

/** A cron route's GET, reporting its own 5xx or throw (alert-rules.ts wrapJob). */
export function withJobAlert(job: string, handler: (request: Request) => Promise<Response>) {
  return wrapJob(job, handler, alertJobFailed);
}

/**
 * The fal balance against the priciest single render (the hourly reconcile
 * runs it). An unknown balance — no admin key, fal unreachable — is logged,
 * not alerted: Admin → AI Providers shows the same error.
 */
export async function checkFalBalance(): Promise<{ balanceUsd: number | null; alerted: boolean }> {
  try {
    const balance = await getFalBalance();
    if (!balance.ok) {
      console.warn("admin-alerts: fal balance unknown —", balance.error);
      return { balanceUsd: null, alerted: false };
    }
    const verdict = falBalanceAlert({ balanceUsd: balance.balanceUsd, worstRenderUsd: maxSingleRenderCostUsd() });
    if (!verdict) return { balanceUsd: balance.balanceUsd, alerted: false };
    const alerted = await sendOnce(
      limit,
      send,
      `fal-balance-${verdict.level}`,
      verdict.level === "critical" ? ALERT_WINDOWS.falCritical : ALERT_WINDOWS.falLow,
      verdict.push,
    );
    return { balanceUsd: balance.balanceUsd, alerted };
  } catch (err) {
    console.error("admin-alerts: fal balance check failed:", err);
    return { balanceUsd: null, alerted: false };
  }
}
