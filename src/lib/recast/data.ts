import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { isRenderableUrl, mediaUrl, thumbUrl, toMediaUrl } from "@/lib/media/url";
import {
  RECAST_BUCKET,
  RECAST_IMAGE_BUCKET,
  RECAST_MAX_SECONDS,
  RECAST_MIN_SECONDS,
  RECAST_MODEL_IDS,
  recastEngineOfModel,
  type RecastEngine,
} from "@/lib/recast/recast";
import { readRecastRecipe, readRecastRecipes, type RecastRecipe } from "@/lib/recast/store";
import { readRenderNotifyPrefs } from "@/lib/generations/generation-defaults-server";
import { recastTakeOutcome, recastTakeReport, type RecastTakeOutcome, type RecastTakeReport } from "@/lib/recast/door-truth";

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
  /** "stopped" is a take the person stopped — the runner files it as failed; the door does not say it as one. */
  status: "generating" | "succeeded" | "failed" | "stopped";
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
  /** The images the person added to it, as tiles — so Recreate can put them back. */
  images: { path: string; url: string }[];
  /**
   * Where a rendering take is, in the runner's own words (progress_stage:
   * "Rendering part 2 of 3", "Joining the parts") — English on the wire,
   * translated where it is shown. Null once it has settled.
   */
  progress: string | null;
  /** How a take that did not deliver ended — stopped or failed, why, and whether it cost anything (door-truth.ts). */
  outcome: RecastTakeOutcome | null;
  /** The runner's face report on a finished take, when it wrote one (door-truth.ts). */
  report: RecastTakeReport | null;
};

// `recast` is NOT here on purpose: it arrives with a migration the operator
// runs by hand, and PostgREST fails a whole statement that names a column
// the database does not have. Named here, one unapplied file emptied the
// door — the upload worked, the take was started and charged, and the page
// showed nothing (2026-09-18). The recipes come from store.ts, in a query of
// its own whose failure means no recipe.
//
// progress_stage rides here (2026-09-22): the runner's own line for a
// rendering take — which part of a long take is rendering, or that the parts
// are being joined — so a reload says where a take is before the first poll
// answers. The pipeline log does NOT ride here: it is the biggest field on a
// row and this read lists 120 rows, so it is asked for on its own, for the
// few settled takes the door shows (readTakeLogs).
const TAKE_COLUMNS =
  "id, status, result_url, poster_url, created_at, character_profile_id, model_id, video_duration_seconds, credits_used, match_score, prompt_input, progress_stage";

/**
 * The logs of the settled takes on the door, for their story: why one
 * failed, that one was stopped, the face report on one that finished.
 * Best-effort: a failed read means no story, never an empty door.
 */
async function readTakeLogs(supabase: SupabaseClient, ids: string[]): Promise<Map<string, unknown>> {
  if (ids.length === 0) return new Map();
  try {
    const { data, error } = await supabase.from("generations").select("id, pipeline_log").in("id", ids);
    if (error || !data) return new Map();
    return new Map((data as { id: string; pipeline_log: unknown }[]).map((r) => [r.id, r.pipeline_log]));
  } catch {
    return new Map();
  }
}

export async function getRecastHome(
  supabase: SupabaseClient,
  userId: string,
): Promise<{
  characters: RecastCharacter[];
  motions: RecastMotion[];
  takes: RecastTake[];
  /** Their own "tell me when it's done / when something went wrong" settings, which the door's in-page notice follows too. */
  notify: { ready: boolean; failed: boolean };
}> {
  const [{ data: characterRows }, { data: videoRows }, notify] = await Promise.all([
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
      // A failed take is LISTED, and says so. It used to be filtered out
      // here, so a take that failed left the door looking as though nothing
      // had been done at all (2026-09-18); the card has always had a line
      // for it. A failed row can still never be a motion — that filter is
      // its own, below.
      .order("created_at", { ascending: false })
      .limit(120),
    readRenderNotifyPrefs(supabase, userId),
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

  const takeRows = rows
    .filter((g) => RECAST_MODEL_IDS.includes((g.model_id as string | null) ?? ""))
    .filter((g) => g.status !== "succeeded" || playable(g) !== null)
    .slice(0, 24);
  const [recipes, logs] = await Promise.all([
    readRecastRecipes(supabase, takeRows.map((g) => g.id as string)),
    readTakeLogs(
      supabase,
      takeRows.filter((g) => g.status === "succeeded" || g.status === "failed").map((g) => g.id as string),
    ),
  ]);

  const takes: RecastTake[] = takeRows.map((g) => {
    // A take that did not deliver says how it ended: a stop is not a failure
    // (it used to read "Didn't finish", the same as one), and a failure says
    // why and whether its credits came back (door-truth.ts).
    const outcome =
      g.status === "failed"
        ? recastTakeOutcome({ credits_used: (g.credits_used as number | null) ?? null, pipeline_log: logs.get(g.id as string) })
        : null;
    const status: RecastTake["status"] =
      g.status === "succeeded" ? "succeeded" : g.status === "failed" ? (outcome?.stopped ? "stopped" : "failed") : "generating";
    return {
      id: g.id as string,
      status,
      characterName: nameOf.get(g.character_profile_id as string) ?? null,
      engine: recastEngineOfModel(g.model_id as string | null),
      seconds: (g.video_duration_seconds as number | null) ?? null,
      credits: (g.credits_used as number | null) ?? null,
      score: (g.match_score as number | null) ?? null,
      posterUrl: thumbUrl(toMediaUrl(g.poster_url as string | null), 640),
      createdAt: g.created_at as string,
      recipe: recipes.get(g.id as string) ?? null,
      images: (recipes.get(g.id as string)?.images ?? []).map((path) => ({
        path,
        url: thumbUrl(mediaUrl(RECAST_IMAGE_BUCKET, path), 320) ?? "",
      })),
      progress: status === "generating" ? ((g.progress_stage as string | null) ?? null) : null,
      outcome,
      report: status === "succeeded" ? recastTakeReport(logs.get(g.id as string)) : null,
    };
  });

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

  return { characters, motions, takes, notify };
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
      // The upload a window was cut from stays too: the take can be recut.
      if (recipe?.fromClipId) spokenFor.add(recipe.fromClipId);
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
