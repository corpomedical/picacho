import type { SupabaseClient } from "@supabase/supabase-js";

// Helios Studio's scene on the person's account (stage 3, 2026-09-29):
// `location_sets.studio_scene` (supabase/pending/helios-studio-scene.sql).
// The Studio's own snapshot (studio-engine.ts snapshot(), v 1) is kept as
// it is: the engine is the only reader, and it restores defensively,
// skipping anything it cannot place. Here it is only held to its shape —
// an object with v 1 — and to a size, so a row never grows without bound.

/** The largest scene kept on the account, as JSON bytes. Baked physics is what fills it. */
export const STUDIO_SCENE_MAX_BYTES = 512 * 1024;

export const STUDIO_SCENE_TOO_BIG = "This scene is too big to keep on your account (baked physics takes the most room). It's kept in this browser.";
export const STUDIO_SCENE_UNREADABLE = "That scene couldn't be read, so it wasn't saved.";
export const STUDIO_SCENE_NOT_SAVED = "Couldn't reach your account, so the scene is kept in this browser for now.";
export const STUDIO_SCENE_TOO_FAST = "Saving too often — the next save will catch up.";

export type StudioScene = Record<string, unknown> & { v: 1 };

/** The scene as sent or stored, or why not: an object with v 1, at most STUDIO_SCENE_MAX_BYTES as JSON. */
export function normaliseStudioScene(v: unknown): { ok: true; scene: StudioScene } | { ok: false; error: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: STUDIO_SCENE_UNREADABLE };
  if ((v as Record<string, unknown>).v !== 1) return { ok: false, error: STUDIO_SCENE_UNREADABLE };
  let text: string;
  try {
    text = JSON.stringify(v);
  } catch {
    return { ok: false, error: STUDIO_SCENE_UNREADABLE };
  }
  if (new TextEncoder().encode(text).byteLength > STUDIO_SCENE_MAX_BYTES) return { ok: false, error: STUDIO_SCENE_TOO_BIG };
  // A plain copy: what is stored is exactly what JSON keeps.
  return { ok: true, scene: JSON.parse(text) as StudioScene };
}

/**
 * The owner's saved scene for one set, or null. Never throws: a read that
 * fails — the column not there yet (the SQL not run), the network — opens
 * the Studio from the browser's copy, as before stage 3.
 */
export async function readStudioScene(db: SupabaseClient, setId: string, userId: string): Promise<StudioScene | null> {
  try {
    const { data, error } = await db
      .from("location_sets")
      .select("studio_scene")
      .eq("id", setId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      console.warn("[sets] could not read the Studio scene (helios-studio-scene.sql run?):", error.message);
      return null;
    }
    const raw = (data as { studio_scene?: unknown } | null)?.studio_scene;
    if (raw === null || raw === undefined) return null;
    const n = normaliseStudioScene(raw);
    return n.ok ? n.scene : null;
  } catch (err) {
    console.warn("[sets] could not read the Studio scene:", err instanceof Error ? err.message : err);
    return null;
  }
}
