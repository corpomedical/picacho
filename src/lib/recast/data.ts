import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { isRenderableUrl, mediaUrl, thumbUrl, toMediaUrl } from "@/lib/media/url";
import { parseRecastSourcePath, RECAST_BUCKET, RECAST_MODEL_IDS, recastEngineOfModel, type RecastEngine } from "@/lib/recast/recast";

// What the door's page needs: who can be cast, and the takes so far. Takes
// are ordinary generations rows (the lane's model ids pick them out), so
// History, Videos and the library already list them too — nothing is stored
// twice.

/** `photos` are the character's saved photos, first one the identity: path for the server, url for the tile. */
export type RecastCharacter = { id: string; name: string; photos: { path: string; url: string }[] };

export type RecastTake = {
  id: string;
  status: "generating" | "succeeded" | "failed";
  characterName: string | null;
  engine: RecastEngine | null;
  seconds: number | null;
  credits: number | null;
  score: number | null;
  posterUrl: string | null;
  createdAt: string;
};

export async function getRecastHome(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ characters: RecastCharacter[]; takes: RecastTake[] }> {
  const [{ data: characterRows }, { data: takeRows }] = await Promise.all([
    supabase
      .from("character_profiles")
      .select("id, name, reference_image_urls")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("generations")
      .select("id, status, result_url, poster_url, created_at, character_profile_id, model_id, video_duration_seconds, credits_used, match_score")
      .eq("user_id", userId)
      .in("model_id", RECAST_MODEL_IDS)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(24),
  ]);

  const characters: RecastCharacter[] = (characterRows ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    // Tiles only. What a take is given is the PATH, checked server-side
    // against the character's own list — never this URL.
    photos: ((c.reference_image_urls as string[] | null) ?? []).map((path) => ({
      path,
      url: thumbUrl(mediaUrl("character-references", path), 320) ?? "",
    })),
  }));
  const nameOf = new Map(characters.map((c) => [c.id, c.name]));

  const takes: RecastTake[] = (takeRows ?? [])
    // A "succeeded" row with nothing to play is not a take to show (the Videos page's rule).
    .filter((g) => g.status !== "succeeded" || isRenderableUrl(toMediaUrl(g.result_url as string | null)))
    .map((g) => ({
      id: g.id as string,
      status: g.status === "succeeded" ? "succeeded" : g.status === "failed" ? "failed" : "generating",
      characterName: nameOf.get(g.character_profile_id as string) ?? null,
      engine: recastEngineOfModel(g.model_id as string | null),
      seconds: (g.video_duration_seconds as number | null) ?? null,
      credits: (g.credits_used as number | null) ?? null,
      score: (g.match_score as number | null) ?? null,
      posterUrl: thumbUrl(toMediaUrl(g.poster_url as string | null), 640),
      createdAt: g.created_at as string,
    }));

  return { characters, takes };
}

const ORPHAN_AFTER_MS = 60 * 60_000;

/**
 * Clips that were uploaded and never became a take (a closed tab, a changed
 * mind the discard call missed): removed on the owner's next visit once an
 * hour old. One listing of the person's own folder — no cron, no table.
 * Best-effort; never throws.
 */
export async function sweepRecastOrphans(userId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: objects, error } = await admin.storage.from(RECAST_BUCKET).list(userId, { limit: 200 });
    if (error || !objects?.length) return;
    const old = objects.filter((o) => {
      const at = Date.parse((o.created_at as string | undefined) ?? "");
      return Number.isFinite(at) && Date.now() - at > ORPHAN_AFTER_MS;
    });
    if (old.length === 0) return;
    const byTake = new Map<string, string>();
    for (const o of old) {
      const path = `${userId}/${o.name}`;
      const parsed = parseRecastSourcePath(path);
      if (parsed) byTake.set(parsed.takeId, path);
    }
    if (byTake.size === 0) return;
    const { data: rows, error: rowsError } = await admin.from("generations").select("id").in("id", [...byTake.keys()]);
    // A failed read must never be mistaken for "no takes stand on these".
    if (rowsError || !rows) return;
    for (const r of rows) byTake.delete(r.id as string);
    if (byTake.size > 0) await admin.storage.from(RECAST_BUCKET).remove([...byTake.values()]);
  } catch (err) {
    console.warn("recast orphan sweep failed; nothing was removed.", err);
  }
}
