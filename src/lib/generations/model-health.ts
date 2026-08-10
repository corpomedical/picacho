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

// A trip also needs failures from at least this many DIFFERENT accounts.
//
// At current volume three consecutive failures can be three requests in total,
// so one person with a corrupt reference photo could take a healthy model
// offline for everyone. Corroboration from a second account is what separates
// "this model is broken" from "this user's input is bad".
const MIN_DISTINCT_USERS = 2;

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
  userId?: string,
): Promise<void> {
  if (!modelId || !isProviderFault(error)) return;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("model_health")
    .select("consecutive_failures, trip_count, failing_user_ids")
    .eq("model_id", modelId)
    .maybeSingle<{ consecutive_failures: number; trip_count: number; failing_user_ids: string[] }>();

  const failures = (existing?.consecutive_failures ?? 0) + 1;
  const failingUsers = Array.from(
    new Set([...(existing?.failing_user_ids ?? []), ...(userId ? [userId] : [])]),
  );
  const shouldTrip =
    failures >= FAILURE_THRESHOLD && failingUsers.length >= MIN_DISTINCT_USERS;
  const tripCount = shouldTrip ? (existing?.trip_count ?? 0) + 1 : (existing?.trip_count ?? 0);
  const cooldown = Math.min(BASE_COOLDOWN_MS * 2 ** Math.max(0, tripCount - 1), MAX_COOLDOWN_MS);

  await admin.from("model_health").upsert({
    model_id: modelId,
    kind,
    consecutive_failures: failures,
    failing_user_ids: failingUsers,
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
    failing_user_ids: [],
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

// Resolves which model should actually be used, given that the requested one
// may be out of service.
//
// Failover rather than refusal, deliberately. Blocking sounds safer but kills
// the free trial outright — free accounts are pinned to a single model (see
// FREE_TIER_VIDEO_MODEL_ID), so if that one trips, every new signup's first
// experience of the product is "under maintenance". Routing to a working model
// means the person still gets their video and the broken model still stops
// being called, which is the actual goal.
//
// `candidates` must be supplied cheapest-first by the caller. Cost order
// matters: falling a free-tier user over to Veo would turn a EUR0 trial
// generation into several euros of spend, which is a worse leak than the one
// this whole system exists to close.
export async function resolveModel(
  requestedId: string,
  candidates: { id: string; name: string }[],
): Promise<
  | { ok: true; modelId: string; substitutedFrom: string | null }
  | { ok: false; message: string }
> {
  const unavailable = await getUnavailableModels();
  if (!unavailable.has(requestedId)) {
    return { ok: true, modelId: requestedId, substitutedFrom: null };
  }

  const healthy = candidates.find((c) => c.id !== requestedId && !unavailable.has(c.id));
  if (healthy) {
    return { ok: true, modelId: healthy.id, substitutedFrom: requestedId };
  }

  // Nothing left to fall back to — only now does anyone get turned away.
  const requestedName = candidates.find((c) => c.id === requestedId)?.name ?? requestedId;
  return {
    ok: false,
    message: `${requestedName} is temporarily unavailable while we look into a problem with it, and no alternative is free right now. Nothing has been charged — please try again shortly.`,
  };
}

export type ModelHealthState = "healthy" | "trial" | "out";

export type ModelHealthRow = {
  state: ModelHealthState;
  trippedAt: string | null;
  retryAfter: string | null;
  tripCount: number;
  lastError: string | null;
  lastSuccessAt: string | null;
};

// Full health picture for the admin area, with the state already resolved.
//
// Resolved HERE rather than in the page, because working out whether a model
// is merely awaiting its trial retry depends on the current time, and reading
// the clock during a React render isn't pure — the same render could produce
// different output on a retry. Data layer is the right place for it anyway.
export async function getAllModelHealth(): Promise<Map<string, ModelHealthRow>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("model_health")
    .select("model_id, tripped_at, retry_after, trip_count, last_error, last_success_at");

  const now = Date.now();
  const out = new Map<string, ModelHealthRow>();

  for (const row of data ?? []) {
    const retryAfter = row.retry_after as string | null;
    const trippedAt = row.tripped_at as string | null;
    const state: ModelHealthState = !trippedAt
      ? "healthy"
      : // Past its cooldown means the next request goes through as a trial,
        // so it isn't blocking anyone — worth showing differently.
        retryAfter && new Date(retryAfter).getTime() <= now
        ? "trial"
        : "out";

    out.set(row.model_id as string, {
      state,
      trippedAt,
      retryAfter,
      tripCount: Number(row.trip_count ?? 0),
      lastError: row.last_error as string | null,
      lastSuccessAt: row.last_success_at as string | null,
    });
  }

  return out;
}
