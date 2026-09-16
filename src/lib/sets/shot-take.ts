// What each Helios take was rendered from (2026-09-16). Relative imports
// only and the Supabase client passed in, so the test suite loads this file
// as it is.
//
// A take is a clip between two stills of its set (take.ts). When its clip
// fails, the page offers to render the clip again between the same two —
// the clip alone to pay for, and the end frame the person already saw
// (takeInSet's endGenerationId). The page knew the two stills only in the
// visit that started the take, since the take's row recorded neither: after
// a reload, a failed take said so and offered nothing. The row now keeps
// them, with the engine and the direction the clip was asked with.
//
// A film's beats are kept too, marked as the film's: a film renders its own
// clips again (film.ts filmJobs), and a clip rendered beside the film would
// leave the film's beat missing — to be paid for a second time.
//
// THE ONLY MODULE IN src/ THAT NAMES THE COLUMN (shot-take.test.ts scans for
// it). location_set_shots.take arrives with
// supabase/pending/helios-take-frames.sql. Written, like shot-rig.ts, to
// survive its absence: PostgREST fails a whole statement that names a
// missing column, so no other query names it — it is written in an update
// of its own whose failure is ignored, and read in a query of its own whose
// failure reads as "nothing kept". Without the column a take works exactly
// as before, its frames kept for the visit that started it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanText } from "./set-spec";
import { SET_DIRECTION_MAX_CHARS } from "./set-config";
import { isSetTakeEngine, type SetTakeEngine, type TakeSource } from "./take";

const COLUMN = "take";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a take's row keeps: the stills it starts and ends on, its engine and direction, and whether a film rendered it. */
export type ShotTake = {
  start: string;
  end: string;
  engine: SetTakeEngine;
  direction: string;
  /** A film's beat: the film renders it again (filmJobs), never the take's own offer. */
  film: boolean;
};

/** A stored take through one door, or null. Ids are kept lower-case, as the database returns them. */
export function normaliseShotTake(v: unknown): ShotTake | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.start !== "string" || !UUID_RE.test(r.start)) return null;
  if (typeof r.end !== "string" || !UUID_RE.test(r.end)) return null;
  if (!isSetTakeEngine(r.engine)) return null;
  return {
    start: r.start.toLowerCase(),
    end: r.end.toLowerCase(),
    engine: r.engine,
    direction: cleanText(r.direction, SET_DIRECTION_MAX_CHARS),
    film: r.film === true,
  };
}

/**
 * What the page may offer to render again between, for one take: a take of
 * its own (not a film's beat), whose person can still be shot, and whose
 * two stills are still finished stills of the person's. Null otherwise —
 * then the take says it failed and offers nothing, as before.
 */
export function takeSourceOf(
  take: ShotTake | null | undefined,
  characterId: unknown,
  canShoot: (characterId: string) => boolean,
  finished: ReadonlySet<string>,
): TakeSource | null {
  if (!take || take.film) return null;
  if (typeof characterId !== "string" || !canShoot(characterId)) return null;
  if (!finished.has(take.start) || !finished.has(take.end)) return null;
  return { start: take.start, end: take.end, characterId, direction: take.direction, engine: take.engine };
}

const warned = new Set<string>();
function warnOnce(op: string, message: string) {
  if (warned.has(op)) return;
  warned.add(op);
  console.warn(`[sets] shot take ${op} failed (further failures of this kind are not logged): ${message}`);
}

/**
 * Keep what a take was rendered from, in a write of its own after the
 * take's row is in. Never throws; true only when the row now holds it.
 * False before helios-take-frames.sql has run (the column is missing), and
 * then the take's frames are kept for this visit only.
 */
export async function recordShotTake(
  admin: SupabaseClient,
  shot: { setId: string; generationId: string; userId: string },
  take: ShotTake,
): Promise<boolean> {
  const kept = normaliseShotTake(take);
  if (!kept) return false;
  try {
    const { data, error } = await admin
      .from("location_set_shots")
      .update({ [COLUMN]: kept })
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
 * What the named takes of a set were rendered from, by generation id.
 * Fail-open: the column missing, or any other failure, reads as nothing
 * kept at all.
 */
export async function readShotTakes(
  db: SupabaseClient,
  setId: string,
  userId: string,
  generationIds: string[],
): Promise<Map<string, ShotTake>> {
  const out = new Map<string, ShotTake>();
  if (generationIds.length === 0) return out;
  try {
    const { data, error } = await db
      .from("location_set_shots")
      .select(`generation_id, ${COLUMN}`)
      .eq("set_id", setId)
      .eq("user_id", userId)
      .in("generation_id", generationIds);
    if (error) {
      warnOnce("read", error.message);
      return out;
    }
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      if (typeof row.generation_id !== "string") continue;
      const take = normaliseShotTake(row[COLUMN]);
      if (take) out.set(row.generation_id, take);
    }
    return out;
  } catch (err) {
    warnOnce("read", err instanceof Error ? err.message : String(err));
    return out;
  }
}
