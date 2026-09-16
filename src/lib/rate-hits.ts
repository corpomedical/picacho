// The limiter's rows, kept no longer than they are needed (2026-09-16).
//
// api_rate_hits holds one row per counted request: whose (a user id, or for
// a caller not signed in, a salted hash, see rate-limit.ts hashedRateKey),
// which feature, and when. api_rate_check prunes only the bucket it is
// asked about, and only rows older than four of its windows, so a feature
// a person never used again kept their rows for good. The table has no
// foreign key (the pre-sign-in buckets are not users), so deleting an
// account left every one of its rows behind, though the public deletion
// page lists no such record among what is kept.
//
// Two sweeps: the account's own rows when it is deleted (both deletion
// paths, once the account is really gone), and every row older than
// RATE_HITS_KEEP_DAYS, daily (/api/cron/prune).
//
// Relative imports only and the client passed in: tested with a fake.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The longest window any limiter counts over: a month of Astra set changes
 * (Helios, editor-actions.ts, from monthlyWindowStart, so at most 31 days).
 * Every other window is an hour or less. rate-hits.test.ts holds every
 * call site to it.
 */
export const RATE_HITS_LONGEST_WINDOW_SECONDS = 31 * 24 * 60 * 60;
/** How long a counted request is kept: twice the longest window, so no count ever reaches a pruned row. */
export const RATE_HITS_KEEP_DAYS = 62;
/** Rows removed per statement, by id; and statements per run. What a run leaves, the next one takes. */
export const RATE_HITS_PRUNE_BATCH = 5_000;
export const RATE_HITS_PRUNE_MAX_BATCHES = 40;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A deleted account's counted requests. Never throws: a failure is logged,
 * and the daily sweep takes the rows once they are old enough.
 */
export async function removeUserRateHits(admin: SupabaseClient, userId: string): Promise<void> {
  try {
    const { error } = await admin.from("api_rate_hits").delete().eq("user_id", userId);
    if (error) console.warn("[rate-hits] a deleted account's rows were not removed:", error.message);
  } catch (err) {
    console.warn("[rate-hits] a deleted account's rows were not removed:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Every counted request older than RATE_HITS_KEEP_DAYS, oldest first and a
 * batch at a time by id: ids grow with time, and a range of the key is
 * cheap where a sweep by time over the whole table in one statement is
 * not. Each statement also holds to the time, so a younger row is never
 * taken. Stops when none is left, at the batch ceiling, or at the first
 * error. Never throws.
 */
export async function pruneRateHits(
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<{ removed: number; done: boolean; error: string | null }> {
  const cutoff = new Date(now.getTime() - RATE_HITS_KEEP_DAYS * DAY_MS).toISOString();
  let removed = 0;
  try {
    for (let batch = 0; batch < RATE_HITS_PRUNE_MAX_BATCHES; batch++) {
      const { data, error } = await admin
        .from("api_rate_hits")
        .select("id")
        .lt("created_at", cutoff)
        .order("id", { ascending: true })
        .limit(1);
      if (error) return { removed, done: false, error: error.message };
      const first = Number((data as { id?: unknown }[] | null)?.[0]?.id);
      if (!Number.isFinite(first)) return { removed, done: true, error: null };
      const { error: deleteError, count } = await admin
        .from("api_rate_hits")
        .delete({ count: "exact" })
        .lt("created_at", cutoff)
        .lt("id", first + RATE_HITS_PRUNE_BATCH);
      if (deleteError) return { removed, done: false, error: deleteError.message };
      removed += count ?? 0;
    }
    return { removed, done: false, error: null };
  } catch (err) {
    return { removed, done: false, error: err instanceof Error ? err.message : String(err) };
  }
}
