import { createAdminClient } from "@/lib/supabase/server";

// Circuit breaker for AI providers.
//
// When a provider breaks — a model retired, an endpoint changing shape, fal
// having an outage — the old behaviour was to keep sending requests, keep
// being billed for them, and keep handing users errors, until a human noticed.
// Every one of those requests is real money spent to produce nothing.
//
// So a model that fails repeatedly takes itself out of service. Users see
// "under maintenance, try another model" instead of spending a credit to
// discover it themselves, and the spend stops immediately rather than when
// someone checks the dashboard.
//
// Three CONSECUTIVE failures, not three in a window. A busy model with
// ninety-seven successes and three scattered failures is healthy; tripping on
// that would take working models offline for ordinary noise. Three in a row is
// a pattern.

// Wigly's threshold: "if an error happens more than 3 times... there is a
// serious problem."
const FAILURE_THRESHOLD = 3;

// How long a tripped model stays out before one trial request is allowed
// through. Doubles per consecutive trip, so a genuinely dead model isn't
// retried every few minutes forever, while a brief outage recovers quickly
// with no intervention.
const BASE_COOLDOWN_MS = 10 * 60_000;
const MAX_COOLDOWN_MS = 6 * 60 * 60_000;

export type ModelHealth = {
  modelId: string;
  available: boolean;
  trippedAt: string | null;
  retryAfter: string | null;
  lastError: string | null;
};

// Failures that mean the MODEL is broken, as opposed to this particular
// request being unreasonable.
//
// The distinction matters: counting a rejected prompt as a provider failure
// would let three people writing content-policy-violating prompts take a
// perfectly healthy model offline for everyone. Only infrastructure-shaped
// failures count.
export function isProviderFault(message: string): boolean {
  const m = message.toLowerCase();
  const requestFault =
    m.includes("content policy") ||
    m.includes("moderation") ||
    m.includes("nsfw") ||
    m.includes("safety") ||
    m.includes("invalid prompt") ||
    m.includes("prompt is too long");
  return !requestFault;
}

// Records a failed generation. Trips the breaker on the third in a row.
export async function recordModelFailure(
  modelId: string,
  kind: "video" | "image",
  error: string,
): Promise<void> {
  if (!modelId || !isProviderFault(error)) return;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("model_health")
    .select("consecutive_failures, trip_count")
    .eq("model_id", modelId)
    .maybeSingle<{ consecutive_failures: number; trip_count: number }>();

  const failures = (existing?.consecutive_failures ?? 0) + 1;
  const shouldTrip = failures >= FAILURE_THRESHOLD;
  const tripCount = shouldTrip ? (existing?.trip_count ?? 0) + 1 : (existing?.trip_count ?? 0);
  const cooldown = Math.min(BASE_COOLDOWN_MS * 2 ** Math.max(0, tripCount - 1), MAX_COOLDOWN_MS);

  await admin.from("model_health").upsert({
    model_id: modelId,
    kind,
    consecutive_failures: failures,
    last_error: error.slice(0, 500),
    last_failure_at: new Date().toISOString(),
    ...(shouldTrip
      ? {
          tripped_at: new Date().toISOString(),
          retry_after: new Date(Date.now() + cooldown).toISOString(),
          trip_count: tripCount,
        }
      : {}),
    updated_at: new Date().toISOString(),
  });
}

// Records a success. Clears the breaker completely — one good render proves
// the model is working, which is exactly what the half-open trial is for.
export async function recordModelSuccess(modelId: string, kind: "video" | "image"): Promise<void> {
  if (!modelId) return;

  const admin = createAdminClient();
  await admin.from("model_health").upsert({
    model_id: modelId,
    kind,
    consecutive_failures: 0,
    tripped_at: null,
    retry_after: null,
    trip_count: 0,
    last_success_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

// Every model currently out of service, for the composer and the admin area.
//
// A model past its retry_after is reported as AVAILABLE — that's the
// half-open trial: the next request goes through, and either clears the
// breaker or re-trips it with a longer wait.
export async function getUnavailableModels(): Promise<Map<string, ModelHealth>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("model_health")
    .select("model_id, tripped_at, retry_after, last_error")
    .not("tripped_at", "is", null);

  const now = Date.now();
  const out = new Map<string, ModelHealth>();

  for (const row of data ?? []) {
    const retryAfter = row.retry_after as string | null;
    const stillOut = !retryAfter || new Date(retryAfter).getTime() > now;
    if (!stillOut) continue;
    out.set(row.model_id as string, {
      modelId: row.model_id as string,
      available: false,
      trippedAt: row.tripped_at as string | null,
      retryAfter,
      lastError: row.last_error as string | null,
    });
  }

  return out;
}

// Gate checked before spending anything. Returns a user-facing message when
// the model is out of service, or null when it's fine to proceed.
export async function blockedReason(modelId: string, modelName: string): Promise<string | null> {
  const unavailable = await getUnavailableModels();
  if (!unavailable.has(modelId)) return null;
  return `${modelName} is temporarily unavailable while we look into a problem with it. Try another model, or check back shortly — nothing has been charged.`;
}
