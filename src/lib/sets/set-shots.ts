// Which shots a set's page loads (2026-09-16). Server-side, as the signed-in
// person; relative imports only, so the test runs it against a stand-in.
//
// The newest SET_SHOTS_LIMIT, and after them the film's own shots however
// old they are (film.ts filmShotIds). Past the limit a film lost its reel,
// its opening still's picture and the camera Play the move starts from,
// quietly — the film still named them, the page just never loaded them.
//
// The film's ids come from the person's own saved JSON, which the save
// action checks only for shape, so they are read back through this set's own
// rows: an id that is not one of this set's shots names nothing here.

import type { SupabaseClient } from "@supabase/supabase-js";
import { filmShotIds, type SetFilm } from "./film";
import { SET_SHOTS_LIMIT } from "./set-config";

/** The set's shots to show, newest first, the film's own ones after the rest. */
export async function readSetShotIds(db: SupabaseClient, setId: string, userId: string, film: SetFilm | null): Promise<string[]> {
  const { data: rows } = await db
    .from("location_set_shots")
    .select("generation_id, created_at")
    .eq("set_id", setId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(SET_SHOTS_LIMIT);
  const recent = (rows ?? []).map((r) => r.generation_id as string);
  const missing = filmShotIds(film).filter((id) => !recent.includes(id));
  if (missing.length === 0) return recent;
  // Older than every row above by construction, so they go after them.
  const { data: pinnedRows, error } = await db
    .from("location_set_shots")
    .select("generation_id, created_at")
    .eq("set_id", setId)
    .eq("user_id", userId)
    .in("generation_id", missing)
    .order("created_at", { ascending: false });
  if (error) console.warn("The set page could not read the film's own shots:", error.message);
  const pinned = (pinnedRows ?? []).map((r) => r.generation_id as string);
  return [...new Set([...recent, ...pinned])];
}
