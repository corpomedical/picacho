// The camera each Set shot was framed from (2026-09-12). Relative imports
// only and the Supabase client passed in, so the test suite loads this file
// as it is.
//
// A still is a look's source only when the server knows where its objects
// are in it, and that needs the camera its sketch was taken from
// (look-cutout.ts). The page sends the camera and the stage canvas's shape
// with every shot; the shot action records them here, after the shot's row.
//
// THE ONLY MODULE IN src/ THAT NAMES THE COLUMN (shot-camera.test.ts scans
// for it). location_set_shots.camera arrives with
// supabase/pending/set-shot-camera.sql, and until the operator runs it the
// column does not exist — and PostgREST fails a whole statement that names a
// missing column. So no existing query names it: the camera is written in
// an update of its own whose failure is ignored, and read in queries of
// their own whose failure reads as "no camera". Before the SQL, every shot
// works exactly as it did, and none carries a look.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseShotCamera, type ShotCamera } from "./look-cutout";

const COLUMN = "camera";
const SELECT = `generation_id, ${COLUMN}`;

const warned = new Set<string>();
function warnOnce(op: string, message: string) {
  if (warned.has(op)) return;
  warned.add(op);
  console.warn(`[sets] shot camera ${op} failed (further failures of this kind are not logged): ${message}`);
}

/**
 * The camera a shot's frame was taken from, as it is stored: the layout's
 * normalised camera and the canvas's shape, through the same bounds a read
 * applies. Null when either is missing or out of bounds — then nothing is
 * stored, and the shot is never a look's source.
 */
export function shotCameraOf(
  camera: { position: ShotCamera["position"]; target: ShotCamera["target"]; fovDeg: number } | null | undefined,
  canvasAspect: unknown,
): ShotCamera | null {
  if (!camera) return null;
  return normaliseShotCamera({ position: camera.position, target: camera.target, fovDeg: camera.fovDeg, canvasAspect });
}

/**
 * Record a shot's camera, in a write of its own after the shot's row is in.
 * Never throws; true only when the row now holds it. False before
 * set-shot-camera.sql has run (the column is missing), and then the shot is
 * simply not a look's source.
 */
export async function recordShotCamera(
  admin: SupabaseClient,
  shot: { setId: string; generationId: string; userId: string },
  camera: ShotCamera,
): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("location_set_shots")
      .update({ [COLUMN]: camera })
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
 * The recorded cameras of a set's shots, by generation id — of the shots
 * named, or all of them. Only a camera that normalises counts. Fail-open:
 * the column missing, or any other failure, reads as no camera at all, so
 * the set page and the shot carry on without a look.
 */
export async function readShotCameras(
  db: SupabaseClient,
  setId: string,
  userId: string,
  generationIds?: string[],
): Promise<Map<string, ShotCamera>> {
  const cameras = new Map<string, ShotCamera>();
  if (generationIds && generationIds.length === 0) return cameras;
  try {
    let query = db.from("location_set_shots").select(SELECT).eq("set_id", setId).eq("user_id", userId);
    if (generationIds) query = query.in("generation_id", generationIds);
    const { data, error } = await query;
    if (error) {
      warnOnce("read", error.message);
      return cameras;
    }
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const camera = normaliseShotCamera(row[COLUMN]);
      if (typeof row.generation_id === "string" && camera) cameras.set(row.generation_id, camera);
    }
    return cameras;
  } catch (err) {
    warnOnce("read", err instanceof Error ? err.message : String(err));
    return cameras;
  }
}
