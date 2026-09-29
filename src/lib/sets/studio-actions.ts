"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { HELIOS_STUDIO_FOR_ALL } from "@/lib/sets/set-config";
import { SET_NOT_FOUND } from "@/lib/sets/messages";
import {
  normaliseStudioScene,
  readStudioScene,
  STUDIO_SCENE_NOT_SAVED,
  STUDIO_SCENE_TOO_FAST,
  type StudioScene,
} from "@/lib/sets/studio-scene";

// Helios Studio's scene on the account (stage 3, 2026-09-29). Free: nothing
// is called but the database. The Studio is admins-only while
// HELIOS_STUDIO_FOR_ALL is false, and these doors follow the same rule —
// anyone else hears that the set isn't there, as the page's 404 says.
// The column comes from supabase/pending/helios-studio-scene.sql; until it
// runs, a load answers null and a save says it couldn't reach the account,
// and the Studio keeps its browser copy.

/** The saved scene of one of the person's own sets, or null when none is kept (or none can be read). */
export async function loadStudioScene(setId: string): Promise<{ error: string } | { error: null; scene: StudioScene | null }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (!access.isAdmin && !HELIOS_STUDIO_FOR_ALL) return { error: SET_NOT_FOUND };
  if (typeof setId !== "string" || !UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  return { error: null, scene: await readStudioScene(access.supabase, setId, access.userId) };
}

/**
 * Keep the Studio's scene on one of the person's own sets. The owner check
 * is the update's own filter (their id, not deleted), as saveSetRig's is; a
 * set that isn't theirs updates nothing and is not found.
 */
export async function saveStudioScene(setId: string, scene: unknown): Promise<{ error: string | null }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (!access.isAdmin && !HELIOS_STUDIO_FOR_ALL) return { error: SET_NOT_FOUND };
  if (typeof setId !== "string" || !UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  const clean = normaliseStudioScene(scene);
  if (!clean.ok) return { error: clean.error };
  // The Studio saves about 5 s after a change: 30 a minute is far above it.
  if (await rateLimited(access.userId, "set-studio", 60, 30)) return { error: STUDIO_SCENE_TOO_FAST };
  const { data, error } = await createAdminClient()
    .from("location_sets")
    .update({ studio_scene: clean.scene })
    .eq("id", setId)
    .eq("user_id", access.userId)
    .is("deleted_at", null)
    .select("id");
  if (error) {
    console.warn("[sets] Studio scene could not be saved (helios-studio-scene.sql run?):", error.message);
    return { error: STUDIO_SCENE_NOT_SAVED };
  }
  if (!data || data.length === 0) return { error: SET_NOT_FOUND };
  return { error: null };
}
