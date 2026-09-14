// The person's words with each Set shot (Astra chat, 2026-09-14). Relative
// imports only and the Supabase client passed in, so the test suite loads
// this file as it is.
//
// A set's page is a conversation: what the person asked for, then the still
// Astra shot. The still is a take in History; what was asked for was, until
// now, nowhere — the shot prompt carries a cleaned direction, folded into
// Picacho's own sentences, and a conversation reopened tomorrow needs the
// person's message as they wrote it. This column holds exactly that.
//
// THE ONLY MODULE IN src/ THAT NAMES THE COLUMN (shot-words-store.test.ts
// scans for it, as shot-camera.test.ts does for `camera`).
// location_set_shots.words arrives with supabase/pending/set-shot-words.sql.
// Written to survive the column's absence: PostgREST fails a whole statement
// that names a missing column, so no existing query names it — the words are
// written in an update of their own whose failure is ignored, and read in a
// query of its own whose failure reads as "no words". Without the column,
// every shot works exactly as it did; the conversation shows "Shoot" where
// the message would be.

import type { SupabaseClient } from "@supabase/supabase-js";

const COLUMN = "words";
const SELECT = `generation_id, ${COLUMN}`;
/** What the column keeps (set-shot-words.sql bounds it the same). */
export const SHOT_WORDS_STORED_MAX_CHARS = 600;

const warned = new Set<string>();
function warnOnce(op: string, message: string) {
  if (warned.has(op)) return;
  warned.add(op);
  console.warn(`[sets] shot words ${op} failed (further failures of this kind are not logged): ${message}`);
}

/**
 * Record what the person asked for with a shot, in a write of its own after
 * the shot's row is in. Never throws; true only when the row now holds it.
 * Nothing is written for empty words.
 */
export async function recordShotWords(
  admin: SupabaseClient,
  shot: { setId: string; generationId: string; userId: string },
  words: string,
): Promise<boolean> {
  const text = typeof words === "string" ? words.trim().slice(0, SHOT_WORDS_STORED_MAX_CHARS) : "";
  if (text.length === 0) return false;
  try {
    const { data, error } = await admin
      .from("location_set_shots")
      .update({ [COLUMN]: text })
      .eq("set_id", shot.setId)
      .eq("generation_id", shot.generationId)
      .eq("user_id", shot.userId)
      .select("generation_id");
    if (error) {
      warnOnce("write", error.message);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    warnOnce("write", err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * The words recorded with a set's shots, by generation id — of the shots
 * named, or all of them. Fail-open: the column missing, or any other
 * failure, reads as no words at all.
 */
export async function readShotWords(
  db: SupabaseClient,
  setId: string,
  userId: string,
  generationIds?: string[],
): Promise<Map<string, string>> {
  const words = new Map<string, string>();
  if (generationIds && generationIds.length === 0) return words;
  try {
    let query = db.from("location_set_shots").select(SELECT).eq("set_id", setId).eq("user_id", userId);
    if (generationIds) query = query.in("generation_id", generationIds);
    const { data, error } = await query;
    if (error) {
      warnOnce("read", error.message);
      return words;
    }
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const text = row[COLUMN];
      if (typeof row.generation_id === "string" && typeof text === "string" && text.trim().length > 0) {
        words.set(row.generation_id, text.slice(0, SHOT_WORDS_STORED_MAX_CHARS));
      }
    }
    return words;
  } catch (err) {
    warnOnce("read", err instanceof Error ? err.message : String(err));
    return words;
  }
}
