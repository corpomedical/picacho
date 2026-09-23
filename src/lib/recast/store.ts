// What a take keeps of how it was made — the ONE module that names the
// `recast` column (the Recce's recce-store.ts rule: a column named in one
// place can be migrated in one place).
//
// It holds the recipe, not the result: where the performance came from,
// which job and engine ran, the brief that was sent, what was ticked to
// survive, and whether the lock was promised. Three things fall out of it
// for free —
//
//   the before/after viewer  finds the source footage from the take's id
//   variants                 several takes stand on ONE clip, so the clip
//                            cannot be named after a take
//   Recreate                 a take can be run again, on another character
//                            or another clip, without anyone retyping it
//
// — which is why it is one bounded jsonb column rather than four.

import type { SupabaseClient } from "@supabase/supabase-js";
import { RECAST_PROMPT_MAX_CHARS, recastFitPrompt, type RecastEngine, type RecastJob } from "./recast";
import type { RecastKeep } from "./recast-read";

/** The bar a recast's face must clear at the start, the middle AND the end.
 *
 *  Below the image lane's 70 on purpose: a recast is judged against a photo
 *  taken in another world, another light and another lens, so the same
 *  number means something harder here. 60 is a first guess to be moved once
 *  a week of real takes has been scored — the scores are recorded whatever
 *  the switch says, so the move will be made on data. */
export const RECAST_LOCK_THRESHOLD = 60;

export type RecastSource =
  /** An uploaded clip, at `<user>/<clipId>.<container>` in the recast bucket. */
  | { kind: "upload"; clipId: string; container: "mp4" | "mov" }
  /** One of the person's own finished takes, used as the performance. */
  | { kind: "take"; takeId: string };

export type RecastRecipe = {
  v: 1;
  source: RecastSource;
  job: RecastJob;
  engine: RecastEngine;
  keeps: RecastKeep[];
  direction: string;
  /**
   * Which person in the read was replaced ("A"), when the read found more
   * than one. A TAG, and never the read's line about them: a recipe keeps
   * no account of anyone in the person's own footage, and since 2026-09-23
   * that includes the read's `mark` — the six words that tell one person in
   * a crowd apart by what they wear (recast-read.ts). The mark is written
   * so a brief can point at someone while the take is being made; it is not
   * something this product keeps about a stranger afterwards, so nothing
   * here has a field it could land in and recastRow copies only what is
   * named below.
   */
  castTag: string | null;
  brief: string;
  /** True when this take was taken under the lock's promise. */
  lock: boolean;
  /**
   * Shared by the takes of one press when several characters were cast.
   *
   * Deliberately NOT generations.angle_group_id, which would have been free:
   * the composer refuses to start a fan-out while any row of that column is
   * still rendering (actions.ts's in-flight guard), so variants here would
   * have locked the composer out for two minutes at a time. A group of this
   * lane's own is nobody else's business.
   */
  groupId: string | null;
  /**
   * The stretch of the ORIGINAL clip this take performs, when one was cut
   * (trim.ts). The cut is `source`; the original it came from is
   * `fromClipId`, kept so the take can be recut differently later.
   */
  window: { start: number; end: number } | null;
  fromClipId: string | null;
  /**
   * The images the person added, as sent (2026-09-19): paths under their own
   * folder in the composer's upload bucket, in the order the words call them
   * "image 1", "image 2". Absent on takes from before images.
   */
  images?: string[];
};

const IMAGE_PATH_RE = /^[0-9a-f-]{36}\/[^/]+$/;

/** The column's value for one take. Bounded: nothing hand-written lands here. */
export function recastRow(input: Omit<RecastRecipe, "v">): RecastRecipe {
  return {
    v: 1,
    source: input.source,
    job: input.job,
    engine: input.engine,
    keeps: input.keeps.slice(0, 6),
    direction: input.direction.slice(0, 600),
    castTag: input.castTag,
    // The whole brief, up to the longest any engine is sent (2026-09-22).
    // It was cut at 2,000 from the END — where the person's direction
    // stands — and the take was SENT this copy. It is a kept copy now; the
    // action sends the words it composed.
    brief: recastFitPrompt(input.brief, RECAST_PROMPT_MAX_CHARS),
    lock: input.lock,
    groupId: input.groupId,
    window: input.window,
    fromClipId: input.fromClipId,
    ...(input.images?.length ? { images: input.images.filter((p) => IMAGE_PATH_RE.test(p)).slice(0, 3) } : {}),
  };
}

/** Reads the column back, or null for a row that predates it / holds nonsense. */
export function readRecastRecipe(value: unknown): RecastRecipe | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Partial<RecastRecipe>;
  if (r.v !== 1 || typeof r.source !== "object" || r.source === null) return null;
  const s = r.source as RecastSource;
  const sourceOk =
    (s.kind === "upload" && typeof s.clipId === "string" && (s.container === "mp4" || s.container === "mov")) ||
    (s.kind === "take" && typeof s.takeId === "string");
  if (!sourceOk) return null;
  return {
    v: 1,
    source: s,
    job: r.job as RecastJob,
    engine: r.engine as RecastEngine,
    keeps: Array.isArray(r.keeps) ? (r.keeps as RecastKeep[]).slice(0, 6) : [],
    direction: typeof r.direction === "string" ? r.direction : "",
    castTag: typeof r.castTag === "string" ? r.castTag : null,
    brief: typeof r.brief === "string" ? r.brief : "",
    lock: r.lock === true,
    groupId: typeof r.groupId === "string" ? r.groupId : null,
    window:
      r.window && typeof r.window === "object" && typeof r.window.start === "number" && typeof r.window.end === "number"
        ? { start: r.window.start, end: r.window.end }
        : null,
    fromClipId: typeof r.fromClipId === "string" ? r.fromClipId : null,
    ...(Array.isArray(r.images)
      ? { images: r.images.filter((p): p is string => typeof p === "string" && IMAGE_PATH_RE.test(p)).slice(0, 3) }
      : {}),
  };
}

/**
 * The recipes of these takes, read in a query of THIS module's own — the
 * rule the column's own migration states ("Only src/lib/recast/store.ts
 * names this column") and the rule the late columns of Sets follow
 * (shot-rig.ts, recce-store.ts).
 *
 * It is a query of its own because PostgREST fails a WHOLE statement that
 * names a column the database does not have, and `recast` arrives with a
 * migration the operator runs by hand. Named inside the door's own list of
 * takes, one unapplied file emptied the whole door: the upload worked, the
 * take was started and charged, and the page showed nothing at all — which
 * is exactly how it was reported ("I tried mystic, uploaded video generated
 * and it looks like nothing has happened", 2026-09-18). Here, a missing
 * column means no recipe: no before-and-after, no Recreate, every take
 * still listed.
 */
export async function readRecastRecipes(supabase: SupabaseClient, ids: readonly string[]): Promise<Map<string, RecastRecipe>> {
  const out = new Map<string, RecastRecipe>();
  if (ids.length === 0) return out;
  try {
    const { data, error } = await supabase.from("generations").select("id, recast").in("id", [...ids]);
    if (error || !Array.isArray(data)) return out;
    for (const row of data as { id?: unknown; recast?: unknown }[]) {
      const recipe = readRecastRecipe(row.recast);
      if (typeof row.id === "string" && recipe) out.set(row.id, recipe);
    }
  } catch {
    // The column is not there yet: no recipes, and every take still listed.
  }
  return out;
}
