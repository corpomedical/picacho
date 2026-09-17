import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { isRenderableUrl, mediaUrl, thumbUrl, toMediaUrl } from "@/lib/media/url";
import { RECAST_BUCKET, RECAST_MAX_SECONDS, RECAST_MIN_SECONDS, RECAST_MODEL_IDS, recastEngineOfModel, type RecastEngine } from "@/lib/recast/recast";
import { readRecastRecipe, type RecastRecipe } from "@/lib/recast/store";

// What the door needs: who can be cast, what can be performed, and what has
// been taken so far.
//
// THE MOTION LIBRARY is the answer to Genjutsu's best idea and to the blank
// page. Theirs is a wall of stock clips and community recipes: you arrive
// with no footage and leave with a video. Ours is the same idea aimed at
// something they structurally cannot have — YOUR OWN finished takes. Every
// video this account has ever made is a performance another character can
// now give. A clip you shot on a phone last week and a render from the
// composer are the same thing to this door.
//
// Takes are ordinary generations rows (the lane's model ids pick them out),
// so History, Videos and the library already list them too — nothing is
// stored twice.

export type RecastCharacter = { id: string; name: string; photos: { path: string; url: string }[] };

/** A performance the door can cast someone into. */
export type RecastMotion = {
  takeId: string;
  title: string;
  seconds: number;
  posterUrl: string | null;
  /** Our own media route, so the browser can sample frames without tainting a canvas. */
  videoUrl: string;
  characterName: string | null;
};

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
  /** How it was made: the source clip, the brief, the keeps — and the group,
   *  when several characters were cast from one press. */
  recipe: RecastRecipe | null;
};

const TAKE_COLUMNS =
  "id, status, result_url, poster_url, created_at, character_profile_id, model_id, video_duration_seconds, credits_used, match_score, prompt_input, recast";

export async function getRecastHome(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ characters: RecastCharacter[]; motions: RecastMotion[]; takes: RecastTake[] }> {
  const [{ data: characterRows }, { data: videoRows }] = await Promise.all([
    supabase
      .from("character_profiles")
      .select("id, name, reference_image_urls")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    // One read serves both lists: the takes this door made, and every
    // finished video of theirs that could be performed again.
    supabase
      .from("generations")
      .select(TAKE_COLUMNS)
      .eq("user_id", userId)
      .eq("content_type", "video")
      .is("deleted_at", null)
      .neq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(120),
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

  const rows = (videoRows ?? []) as Record<string, unknown>[];
  const playable = (g: Record<string, unknown>) => {
    const url = toMediaUrl(g.result_url as string | null);
    return url && isRenderableUrl(url) ? url : null;
  };

  const takes: RecastTake[] = rows
    .filter((g) => RECAST_MODEL_IDS.includes((g.model_id as string | null) ?? ""))
    .filter((g) => g.status !== "succeeded" || playable(g) !== null)
    .map((g) => ({
      id: g.id as string,
      status: (g.status === "succeeded" ? "succeeded" : g.status === "failed" ? "failed" : "generating") as RecastTake["status"],
      characterName: nameOf.get(g.character_profile_id as string) ?? null,
      engine: recastEngineOfModel(g.model_id as string | null),
      seconds: (g.video_duration_seconds as number | null) ?? null,
      credits: (g.credits_used as number | null) ?? null,
      score: (g.match_score as number | null) ?? null,
      posterUrl: thumbUrl(toMediaUrl(g.poster_url as string | null), 640),
      createdAt: g.created_at as string,
      recipe: readRecastRecipe(g.recast),
    }))
    .slice(0, 24);

  // Anything finished, playable and the right length can be performed again
  // — including this door's own takes, so a recast can be recast.
  const motions: RecastMotion[] = rows
    .filter((g) => g.status === "succeeded")
    .map((g) => {
      const url = playable(g);
      const seconds = (g.video_duration_seconds as number | null) ?? 0;
      if (!url || seconds < RECAST_MIN_SECONDS || seconds > RECAST_MAX_SECONDS) return null;
      const prompt = ((g.prompt_input as string | null) ?? "").trim();
      return {
        takeId: g.id as string,
        title: prompt.length > 0 ? prompt.slice(0, 80) : "Untitled take",
        seconds,
        posterUrl: thumbUrl(toMediaUrl(g.poster_url as string | null), 640),
        videoUrl: url,
        characterName: nameOf.get(g.character_profile_id as string) ?? null,
      };
    })
    .filter((m): m is RecastMotion => m !== null)
    .slice(0, 18);

  return { characters, motions, takes };
}

const ORPHAN_AFTER_MS = 60 * 60_000;

/**
 * Clips that were uploaded and never became a take (a closed tab, a changed
 * mind the discard call missed): removed on the owner's next visit once an
 * hour old. One listing of the person's own folder and one read of which
 * clips are spoken for — no cron, no table. Best-effort; never throws.
 */
export async function sweepRecastOrphans(supabase: SupabaseClient, userId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: objects, error } = await admin.storage.from(RECAST_BUCKET).list(userId, { limit: 200 });
    if (error || !objects?.length) return;
    const old = objects.filter((o) => {
      const at = Date.parse((o.created_at as string | undefined) ?? "");
      return Number.isFinite(at) && Date.now() - at > ORPHAN_AFTER_MS;
    });
    if (old.length === 0) return;

    // Which clips are spoken for. A failed read must never be mistaken for
    // "nothing stands on these".
    const { data: rows, error: rowsError } = await supabase
      .from("generations")
      .select("recast")
      .eq("user_id", userId)
      .not("recast", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);
    if (rowsError || !rows) return;
    const spokenFor = new Set<string>();
    for (const r of rows) {
      const recipe = readRecastRecipe(r.recast);
      if (recipe?.source.kind === "upload") spokenFor.add(recipe.source.clipId);
    }

    const gone = old
      .map((o) => ({ name: o.name, clipId: o.name.replace(/\.(mp4|mov)$/, "") }))
      .filter((o) => !spokenFor.has(o.clipId))
      .map((o) => `${userId}/${o.name}`);
    if (gone.length > 0) await admin.storage.from(RECAST_BUCKET).remove(gone);
  } catch (err) {
    console.warn("recast orphan sweep failed; nothing was removed.", err);
  }
}
