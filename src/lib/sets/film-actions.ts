"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { thumbUrl } from "@/lib/media/url";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { normaliseSetFilm } from "@/lib/sets/film";
import { SET_NOT_FOUND, SET_SAVE_FAILED, SET_EDIT_TOO_FAST } from "@/lib/sets/messages";

// The film's actions (Helios Film, 2026-09-15). The move — engine, start
// still, beats — lives in `location_sets.film`
// (supabase/applied/2026-09-15/helios-film.sql, run in production 2026-09-15; the page works without it, it just
// cannot remember the move between visits until the column exists).
// Rendering is NOT an action here: a film renders as a chain of takes
// through takeInSet, one per beat, each already gated, priced and limited
// on its own — this file only remembers the move and answers how the
// clips are coming along.

/**
 * Save the person's move on their own ready set. Whatever arrives becomes
 * a film through normaliseSetFilm — the one door — so nothing unparsed is
 * ever stored.
 */
export async function saveSetFilm(setId: string, film: unknown): Promise<{ error: string | null }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (typeof setId !== "string" || !UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  if (await rateLimited(access.userId, "set-film", 60, 40)) return { error: SET_EDIT_TOO_FAST };
  const clean = normaliseSetFilm(film);
  const { error } = await createAdminClient()
    .from("location_sets")
    .update({ film: clean, updated_at: new Date().toISOString() })
    .eq("id", setId)
    .eq("user_id", access.userId)
    .is("deleted_at", null);
  if (error) {
    console.warn("[sets] film could not be saved (helios-film.sql run?):", error.message);
    return { error: SET_SAVE_FAILED };
  }
  return { error: null };
}

export type TakeStatusRow = {
  id: string;
  status: string;
  /** The clip's RAW stored url when succeeded — takes are watched raw, never a thumb transform. */
  resultUrl: string | null;
  posterUrl: string | null;
};

/**
 * How the person's rendering takes are coming along: the open page polls
 * this for its kind:"take" rows still generating — a film's beats, or an
 * ordinary take — instead of asking them to come back later. Reads only
 * the person's own rows; at most a handful of ids, the page's own.
 */
export async function readTakes(
  setId: string,
  generationIds: string[],
): Promise<{ error: string } | { error: null; takes: TakeStatusRow[] }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (typeof setId !== "string" || !UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  const ids = (Array.isArray(generationIds) ? generationIds : [])
    .filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
    .slice(0, 12);
  if (ids.length === 0) return { error: null, takes: [] };
  const { data } = await access.supabase
    .from("generations")
    .select("id, status, result_url, poster_url, content_type")
    .in("id", ids)
    .eq("user_id", access.userId);
  const takes: TakeStatusRow[] = (data ?? [])
    .filter((g) => g.content_type === "video")
    .map((g) => ({
      id: g.id as string,
      status: g.status as string,
      resultUrl: (g.result_url as string | null) ?? null,
      posterUrl: thumbUrl(g.poster_url as string | null, 640),
    }));
  return { error: null, takes };
}
