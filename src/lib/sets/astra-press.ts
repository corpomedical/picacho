// One Astra job per press (2026-09-25, Cut 1 — operator: "GO ahead", never
// charge twice).
//
// An Astra edit or rebuild waits up to 180 s inside one request
// (editor-actions.ts askAstra). When a reused connection drops before any
// response headers arrive, Chromium silently sends the same POST again
// (generations/repeat-send.ts has the incident), and the second delivery
// ran a whole second job: the gate, the pace, one more of the month's
// changes, a second Astra bill (up to $0.62 an edit, $0.70 a rebuild) and
// a second save. The page only ever saw the second answer.
//
// So the page names each press with a fresh id, and here:
//
// 1. The first delivery with that id claims it: a one-shot hit in the
//    limiter's own table, scope `set-astra-press:<id>`, max 1. A repeat
//    delivery is told so at once, before the gate, the pace, the month or
//    Astra, and answers SET_EDIT_STILL_WORKING with `pending`.
// 2. The first delivery always leaves an end marker, `set-astra-press-saved:<id>`
//    or `set-astra-press-unsaved:<id>`, so the page's read-back
//    (editor-actions.ts readAstraEdit, astra-follow.ts) gets a definite answer.
//
// WHY api_rate_hits, and not a new table or column:
// - api_rate_check(p_user_id, p_window_seconds, p_max, p_scope) is already
//   an atomic count-then-insert under pg_advisory_xact_lock(user:scope)
//   (supabase/schema.sql). Called with p_max 1 on a scope made from the
//   press id, exactly one delivery gets `true`, however close together
//   they arrive.
// - It needs no SQL for the operator to run.
// - The table is already the service role's alone: RLS is on, and EXECUTE
//   is granted to service_role only (supabase/applied/2026-08-19/auth-admin.sql).
// - It is already pruned after 62 days (rate-hits.ts via /api/cron/prune)
//   and removed with a deleted account (removeUserRateHits).
// - A location_sets column would need pending SQL, and the code would
//   have to survive the column not existing yet. (The Helios press ledger,
//   press.ts, is the same story: until helios-presses.sql runs an edit
//   would be untracked, and an edit has no reservation row keyed by the
//   press id to fall back on the way a still or a clip does.)
//
// WHY NOT rateLimited():
// - It fails CLOSED, so a limiter outage would look exactly like a repeat.
// - Its legacy 3-arg fallback would put every press into one shared
//   'legacy' bucket with max 1, so every press after the first would look
//   like a repeat.
// - So the claim calls the RPC itself and tells three outcomes apart. This
//   is the one deliberate direct call of api_rate_check outside
//   rate-limit.ts; astra-press.test.ts pins its window, since the
//   rate-hits.test.ts scan reads only rateLimited( calls.
//
// WHY END MARKERS: comparing working copies would not be reliable. The
// editor's autosave changes them too, and the save can race the read.
//
// WHO FOLLOWS the first delivery: the page. A repeat answers at once, and
// the page reads back what was saved. The page needs that loop anyway for a
// call that throws, so there is one implementation, not a server-side
// poller plus a page poller.
//
// Not "use server": the admin client is passed in. Relative imports only,
// so the fake-table test loads it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { SET_EDIT_PRESS_LIFETIME_MS, SET_EDIT_PRESS_WINDOW_SECONDS, SET_EDITS_MONTH_SCOPE } from "./set-config";
import type { AstraPressKind } from "./astra-follow";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The press's id as the page sent it, lowercased, or null when there is none to trust in a scope (recast/repeat.ts parseRecastSendId's rule). */
export function parseAstraPressId(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value.toLowerCase() : null;
}

export function astraPressScope(id: string): string {
  return `set-astra-press:${id}`;
}

export function astraPressEndScope(id: string, end: "saved" | "unsaved"): string {
  return `set-astra-press-${end}:${id}`;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One row under `scope`, if none is there yet: true when this call wrote it. Throws what the client throws. */
async function oneShot(admin: SupabaseClient, userId: string, scope: string): Promise<{ data: unknown; error: { message?: string } | null }> {
  const { data, error } = await admin.rpc("api_rate_check", {
    p_user_id: userId,
    p_window_seconds: SET_EDIT_PRESS_WINDOW_SECONDS,
    p_max: 1,
    p_scope: scope,
  });
  return { data, error };
}

/**
 * Whether this delivery is the press's first. "unavailable" when the claim
 * could not be asked: the caller refuses the press then, as the pace
 * limiter does in the same outage.
 */
export async function claimAstraPress(admin: SupabaseClient, userId: string, pressId: string): Promise<"first" | "repeat" | "unavailable"> {
  try {
    const { data, error } = await oneShot(admin, userId, astraPressScope(pressId));
    if (error) {
      console.warn("[sets] couldn't claim an Astra press:", error.message);
      return "unavailable";
    }
    if (data === true) return "first";
    if (data === false) return "repeat";
    console.warn("[sets] couldn't claim an Astra press: no answer");
    return "unavailable";
  } catch (err) {
    console.warn("[sets] couldn't claim an Astra press:", message(err));
    return "unavailable";
  }
}

/**
 * The press's end marker: saved or not. Idempotent (max 1). Never throws:
 * without it the page reads "running" until SET_EDIT_PRESS_LIFETIME_MS,
 * then judges by the saved copy (astra-follow.ts "lost") — late, not wrong.
 */
export async function endAstraPress(admin: SupabaseClient, userId: string, pressId: string, end: "saved" | "unsaved"): Promise<void> {
  try {
    const { error } = await oneShot(admin, userId, astraPressEndScope(pressId, end));
    if (error) console.warn("[sets] couldn't mark an Astra press's end:", error.message);
  } catch (err) {
    console.warn("[sets] couldn't mark an Astra press's end:", message(err));
  }
}

/** Where a press stands, from its rows (the person's own, already filtered): an end marker first, saved over unsaved. */
export function pressStateOf(rows: { scope: string; created_at: string }[], pressId: string, nowMs: number): Exclude<AstraPressKind, "unread"> {
  if (rows.some((r) => r.scope === astraPressEndScope(pressId, "saved"))) return "saved";
  if (rows.some((r) => r.scope === astraPressEndScope(pressId, "unsaved"))) return "unsaved";
  const claim = rows.find((r) => r.scope === astraPressScope(pressId));
  if (!claim) return "none";
  // A claim with no end older than any delivery can live: the platform stopped it.
  return nowMs - Date.parse(claim.created_at) > SET_EDIT_PRESS_LIFETIME_MS ? "lost" : "running";
}

/** Where a press stands on the server; "unread" when its rows could not be read. */
export async function readAstraPress(admin: SupabaseClient, userId: string, pressId: string, nowMs: number = new Date().getTime()): Promise<AstraPressKind> {
  try {
    const { data, error } = await admin
      .from("api_rate_hits")
      .select("scope, created_at")
      .eq("user_id", userId)
      .in("scope", [astraPressScope(pressId), astraPressEndScope(pressId, "saved"), astraPressEndScope(pressId, "unsaved")]);
    if (error) {
      console.warn("[sets] couldn't read an Astra press:", error.message);
      return "unread";
    }
    const rows = ((data ?? []) as { scope?: unknown; created_at?: unknown }[]).map((r) => ({ scope: String(r.scope), created_at: String(r.created_at) }));
    return pressStateOf(rows, pressId, nowMs);
  } catch (err) {
    console.warn("[sets] couldn't read an Astra press:", message(err));
    return "unread";
  }
}

/**
 * One of the month's Astra changes given back: a press that reserved one
 * (editor-actions.ts astraChangeSlot) and did not save. The month is a
 * count, so removing any one of this person's rows in SET_EDITS_MONTH_SCOPE
 * refunds one reservation; the newest is the one just made, always inside
 * the month. A delete that finds its row already gone (a concurrent give
 * back took it) looks once more. Never throws: false when nothing was
 * given back, and the change stays counted — the safe way round for money.
 */
export async function giveBackAstraEdit(admin: SupabaseClient, userId: string): Promise<boolean> {
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await admin
        .from("api_rate_hits")
        .select("id")
        .eq("user_id", userId)
        .eq("scope", SET_EDITS_MONTH_SCOPE)
        .order("id", { ascending: false })
        .limit(1);
      if (error) {
        console.warn("[sets] couldn't give an Astra change back:", error.message);
        return false;
      }
      const id = (data as { id?: unknown }[] | null)?.[0]?.id;
      if (id === undefined || id === null) return false;
      const { error: deleteError, count } = await admin
        .from("api_rate_hits")
        .delete({ count: "exact" })
        .eq("id", id)
        .eq("user_id", userId)
        .eq("scope", SET_EDITS_MONTH_SCOPE);
      if (deleteError) {
        console.warn("[sets] couldn't give an Astra change back:", deleteError.message);
        return false;
      }
      if ((count ?? 0) > 0) return true;
    }
    return false;
  } catch (err) {
    console.warn("[sets] couldn't give an Astra change back:", message(err));
    return false;
  }
}
