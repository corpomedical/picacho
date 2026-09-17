// What a Recce keeps of its read, on the server (board K cut 1, 2026-09-17).
// Relative imports only and the Supabase client passed in, like photo.ts.
//
// THE ONLY MODULE IN src/ THAT NAMES THE RECCE COLUMN (recce-store.test.ts
// scans for it, the photo.ts pattern). The column arrives with
// supabase/pending/astra-recce.sql; until the operator runs it, it does not
// exist — and the column rides the same insert that reserves a recce
// build's row, so a database without it refuses the build there, before
// anything is spent, with its own admin-facing sentence. Nothing else
// queries the column, so every existing read stays as it was.
//
// The read is fields the reader returned about the person's own footage —
// their data, deleted with the set's row. Cut 2 reads it back to lay the
// clip's shots on the Film timeline; cut 1 only writes it.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecceRead } from "./recce-read";

export type StoredRecce = {
  v: 1;
  /** The clip's length in seconds; the frames were sampled at `times`. */
  seconds: number;
  times: number[];
  read: RecceRead;
};

/** Written in the same insert that reserves a recce build's row. */
export function recceColumns(read: RecceRead, seconds: number, times: number[]) {
  const stored: StoredRecce = { v: 1, seconds, times, read };
  return { recce_read: stored };
}

/**
 * Which of these sets are recces, and each clip's length — the door's list
 * (board K, "Its own door"). Every failure, the missing column included,
 * reads as "none": the door then shows no reads, and nothing breaks.
 */
export async function readRecceSeconds(db: SupabaseClient, ids: string[], userId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  try {
    const { data, error } = await db
      .from("location_sets")
      .select("id, recce_read")
      .in("id", ids)
      .eq("user_id", userId)
      .not("recce_read", "is", null);
    if (error || !data) return out;
    for (const row of data as { id?: unknown; recce_read?: unknown }[]) {
      if (typeof row.id !== "string") continue;
      const r = row.recce_read as { v?: unknown; seconds?: unknown } | null;
      if (typeof r !== "object" || r === null || r.v !== 1 || typeof r.seconds !== "number") continue;
      out.set(row.id, r.seconds);
    }
    return out;
  } catch {
    return out;
  }
}

/**
 * A set's stored read, or null: not a recce, not the caller's set, the
 * column not there yet, or a shape this build of the app does not know —
 * every failure reads as "no read", never an error, because nothing that
 * shows a set may break over what is only cut 2's material.
 */
export async function readSetRecce(db: SupabaseClient, setId: string, userId: string): Promise<StoredRecce | null> {
  try {
    const { data, error } = await db
      .from("location_sets")
      .select("recce_read")
      .eq("id", setId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data) return null;
    const raw = (data as { recce_read?: unknown }).recce_read;
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (r.v !== 1 || typeof r.seconds !== "number" || !Array.isArray(r.times)) return null;
    if (typeof r.read !== "object" || r.read === null) return null;
    return raw as StoredRecce;
  } catch {
    return null;
  }
}

/**
 * What a clip's reading leaves on a set, cleared: the place sentences, the
 * camera words, where the person walked and what the light did are the
 * person's, and `astra-recce.sql` says they go with the set. Its own write,
 * so a database without the column cannot fail a delete, and a failure is
 * said rather than raised (deleteSet, 2026-09-17).
 */
export async function clearSetRecce(admin: SupabaseClient, setId: string, userId: string): Promise<void> {
  const { error } = await admin.from("location_sets").update({ recce_read: null }).eq("id", setId).eq("user_id", userId);
  if (error) console.warn("[sets] could not clear the clip's reading:", error.message);
}
