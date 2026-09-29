import type { SupabaseClient } from "@supabase/supabase-js";
import { reserveAssistantUnits, settleAssistantTopUp } from "../agent/allowance";
import { liveCostUsd } from "./live";
import { unitsForCostUsd } from "./prices";

// A live-voice call's minutes, counted by the server (2026-09-29, operator:
// "Every Aly user, after 3 fixes" — one of them: the server counts the
// minutes, not the page). Table: supabase/pending/producer-live.sql.
//
// GPT-Live bills us per second while a call is open (OpenAI's cost guide:
// "Active session time includes time when the user speaks, the assistant
// speaks, both are silent, or the backend is working"). The page can't be
// the only one counting: a crashed tab never reports, and a changed page
// could report nothing. So:
//
//   - Starting a call holds five minutes of the person's assistant allowance
//     (LIVE_BLOCK_UNITS, a reservation like every assistant turn's).
//   - The page sends a heartbeat every minute. Each one keeps the allowance
//     two minutes ahead of the call, holding another five when needed; when
//     the allowance can't cover it, the server hangs the call up.
//   - Ending it, the page reports OpenAI's own count (session.closed). The
//     server takes it only inside what it knows: at least as long as the
//     heartbeats prove the call was open, at most the time since it started.
//   - A call whose heartbeats stop is hung up by the minute-by-minute sweep
//     (api/cron/producer-live) and charged up to a minute past its last one.
//
// Charged at $0.05 a minute (live.ts) in the assistant's 2-cent units, the
// same ledger (agent_usage) and allowance as every turn of hers.

export const LIVE_BEAT_MS = 60_000;
/** A call whose page has been quiet this long is hung up by the sweep. */
export const LIVE_STALE_MS = 150_000;
/** Past its last heartbeat, a call may have run up to this much longer. */
export const LIVE_GRACE_SECONDS = 60;
/** The allowance is held this far ahead of the call. */
export const LIVE_AHEAD_SECONDS = 120;
/** One call is hung up after this long, whatever its heartbeats say. */
export const LIVE_MAX_SECONDS = 2 * 3600;

/** A call's seconds in the assistant's units (0 for none). */
export function liveUnits(seconds: number): number {
  return seconds > 0 ? unitsForCostUsd(liveCostUsd(seconds)) : 0;
}

/** Held five minutes at a time: 5 × $0.05 = $0.25 = 12.5 → 13 units. */
export const LIVE_BLOCK_SECONDS = 300;
export const LIVE_BLOCK_UNITS = liveUnits(LIVE_BLOCK_SECONDS);

/**
 * What a call is charged. `reported` is OpenAI's count as the page passed it
 * on (null when it didn't); it is kept inside what the server knows.
 */
export function chargedSeconds(a: {
  startedAt: number;
  beatAt: number;
  now: number;
  reported: number | null;
}): { seconds: number; confirmed: boolean } {
  const lower = Math.max(0, (a.beatAt - a.startedAt) / 1000);
  const upper = Math.max(lower, (a.now - a.startedAt) / 1000 + 5);
  if (a.reported !== null && Number.isFinite(a.reported) && a.reported >= 0) {
    // A second either way is the clocks, not a disagreement.
    const confirmed = a.reported >= lower - 2 && a.reported <= upper;
    return { seconds: Math.ceil(Math.min(upper, Math.max(lower, a.reported))), confirmed };
  }
  return { seconds: Math.ceil(Math.min(upper, lower + LIVE_GRACE_SECONDS)), confirmed: false };
}

/** Whether a heartbeat now needs more of the allowance held. */
export function needsMore(a: { startedAt: number; now: number; reservedUnits: number }): boolean {
  const elapsed = Math.max(0, (a.now - a.startedAt) / 1000);
  return liveUnits(elapsed + LIVE_AHEAD_SECONDS) > a.reservedUnits;
}

type LiveRow = {
  id: string;
  user_id: string;
  since: string;
  cap: number;
  started_at: string;
  beat_at: string;
  reservations: string[] | null;
  reserved_units: number;
  closed_at: string | null;
};
const COLUMNS = "id, user_id, since, cap, started_at, beat_at, reservations, reserved_units, closed_at";

/** A call's session id as OpenAI gives it (checked before it goes in a URL or a query). */
export function isLiveSessionId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v);
}

/** Records a call the moment it starts, with the allowance it holds. */
export async function openLiveCall(
  admin: SupabaseClient,
  a: { id: string; userId: string; since: string; cap: number; reservationId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const { error } = await admin.from("producer_live_sessions").insert({
    id: a.id,
    user_id: a.userId,
    since: a.since,
    cap: a.cap,
    started_at: now,
    beat_at: now,
    reservations: [a.reservationId],
    reserved_units: LIVE_BLOCK_UNITS,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** A reservation that wasn't used goes back (units 0: it counts nothing). */
export async function releaseReservation(admin: SupabaseClient, id: string): Promise<void> {
  const { error } = await admin.from("agent_usage").update({ mode: "producer-live", units: 0, cost_usd: 0 }).eq("id", id);
  if (error) console.error("producer-live: reservation not released", error.message);
}

export type BeatOutcome = { ok: true } | { ok: false; reason: "gone" | "allowance" | "error" };

/** The page says the call is still open: noted, and the allowance kept ahead of it. */
export async function beatLiveCall(
  admin: SupabaseClient,
  a: { id: string; userId: string; now?: number },
): Promise<BeatOutcome> {
  const now = a.now ?? Date.now();
  const { data, error } = await admin
    .from("producer_live_sessions")
    .select(COLUMNS)
    .eq("id", a.id)
    .eq("user_id", a.userId)
    .maybeSingle<LiveRow>();
  if (error) return { ok: false, reason: "error" };
  if (!data || data.closed_at) return { ok: false, reason: "gone" };
  const startedAt = Date.parse(data.started_at);
  if ((now - startedAt) / 1000 > LIVE_MAX_SECONDS) return { ok: false, reason: "gone" };
  let reservations = data.reservations ?? [];
  let reserved = data.reserved_units;
  let added: string | null = null;
  if (needsMore({ startedAt, now, reservedUnits: reserved })) {
    const r = await reserveAssistantUnits(admin, { userId: a.userId, since: data.since, cap: data.cap, units: LIVE_BLOCK_UNITS });
    if (!r.ok) return { ok: false, reason: "error" };
    if (!r.id) return { ok: false, reason: "allowance" };
    added = r.id;
    reservations = [...reservations, r.id];
    reserved += LIVE_BLOCK_UNITS;
  }
  const { data: updated, error: upError } = await admin
    .from("producer_live_sessions")
    .update({ beat_at: new Date(now).toISOString(), reservations, reserved_units: reserved })
    .eq("id", a.id)
    .eq("reserved_units", data.reserved_units)
    .is("closed_at", null)
    .select("id");
  if (upError || !updated || updated.length === 0) {
    // Closed (or moved on) meanwhile: the block just held isn't needed.
    if (added) await releaseReservation(admin, added);
    return upError ? { ok: false, reason: "error" } : { ok: false, reason: "gone" };
  }
  return { ok: true };
}

/**
 * Ends a call on the ledger: charges it once (the page's close and the
 * sweep can race; only one claims it), all of it on its first reservation
 * and nothing on the rest, then lets a top-up pay what the month's allowance
 * doesn't. Returns what was charged, or null when it was already closed.
 */
export async function closeLiveCall(
  admin: SupabaseClient,
  a: { id: string; userId?: string; reported: number | null; reason: string; now?: number },
): Promise<{ seconds: number; units: number; confirmed: boolean } | null> {
  const now = a.now ?? Date.now();
  let q = admin.from("producer_live_sessions").select(COLUMNS).eq("id", a.id);
  if (a.userId) q = q.eq("user_id", a.userId);
  const { data, error } = await q.maybeSingle<LiveRow>();
  if (error || !data || data.closed_at) return null;
  const { seconds, confirmed } = chargedSeconds({
    startedAt: Date.parse(data.started_at),
    beatAt: Date.parse(data.beat_at),
    now,
    reported: a.reported,
  });
  const units = liveUnits(seconds);
  const cost = Number(liveCostUsd(seconds).toFixed(6));
  const { data: claimed, error: claimError } = await admin
    .from("producer_live_sessions")
    .update({ closed_at: new Date(now).toISOString(), seconds, units, cost_usd: cost, reason: a.reason.slice(0, 40), confirmed })
    .eq("id", a.id)
    .is("closed_at", null)
    .select("id");
  if (claimError || !claimed || claimed.length === 0) return null;
  const [first, ...rest] = data.reservations ?? [];
  if (first) {
    const { error: e } = await admin.from("agent_usage").update({ mode: "producer-live", units, cost_usd: cost }).eq("id", first);
    if (e) console.error("producer-live: charge not written", { id: a.id, error: e.message });
  } else if (units > 0) {
    const { error: e } = await admin.from("agent_usage").insert({ user_id: data.user_id, mode: "producer-live", units, cost_usd: cost });
    if (e) console.error("producer-live: charge not written", { id: a.id, error: e.message });
  }
  if (rest.length > 0) {
    const { error: e } = await admin.from("agent_usage").update({ mode: "producer-live", units: 0, cost_usd: 0 }).in("id", rest);
    if (e) console.error("producer-live: extra holds not released", { id: a.id, error: e.message });
  }
  await settleAssistantTopUp(admin, { userId: data.user_id, since: data.since, cap: data.cap });
  return { seconds, units, confirmed };
}

/** Ends the call at OpenAI (POST /v1/live/sessions/{id}/hangup). Never throws. */
export async function hangUpLiveCall(id: string, key: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!isLiveSessionId(id)) return false;
  try {
    const res = await fetchImpl(`https://api.openai.com/v1/live/sessions/${id}/hangup`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Calls whose page went quiet (no heartbeat for LIVE_STALE_MS), or that ran
 * past LIVE_MAX_SECONDS: hung up and charged. One person's (`userId`, when a
 * new call starts — with `others`, every open call of theirs: one call at a
 * time) or everyone's (the cron). Returns how many were ended.
 */
export async function sweepLiveCalls(
  admin: SupabaseClient,
  a: { key: string; userId?: string; others?: boolean; now?: number; fetchImpl?: typeof fetch; limit?: number },
): Promise<number> {
  const now = a.now ?? Date.now();
  let q = admin.from("producer_live_sessions").select("id").is("closed_at", null);
  if (a.userId) q = q.eq("user_id", a.userId);
  if (!a.others) {
    const stale = new Date(now - LIVE_STALE_MS).toISOString();
    const tooLong = new Date(now - LIVE_MAX_SECONDS * 1000).toISOString();
    // Quoted: the timestamps' dots and colons are PostgREST syntax.
    q = q.or(`beat_at.lt."${stale}",started_at.lt."${tooLong}"`);
  }
  const { data, error } = await q.order("beat_at", { ascending: true }).limit(a.limit ?? 50);
  if (error || !data) return 0;
  let ended = 0;
  for (const { id } of data as { id: string }[]) {
    await hangUpLiveCall(id, a.key, a.fetchImpl);
    const r = await closeLiveCall(admin, { id, reported: null, reason: a.others ? "replaced" : "quiet", now });
    if (r) ended++;
  }
  return ended;
}
