// The camera each Set shot was framed from (2026-09-12). Relative imports
// only and the Supabase client passed in, so the test suite loads this file
// as it is.
//
// A still is a look's source only when the server knows where its objects
// and its person are in it, and that needs the camera its sketch was taken
// from and where the grey figure stood (look-cutout.ts). The page sends the
// stage's pose, the figure's mark and the stage canvas's shape with every
// shot; the shot action records them here, after the shot's row, exactly as
// sent. Not the saved layout's copy: normaliseSetLayout holds a camera to
// the set's reach (its own bounds plus 10 m, never below 0.2 m), while the
// stage lets the orbit go further and lower, so a clamped camera is not the
// one the frame was drawn from and its boxes would miss what the still
// shows. A pose outside what any stage can be is not recorded at all.
//
// THE ONLY MODULE IN src/ THAT NAMES THE COLUMN (shot-camera.test.ts scans
// for it). location_set_shots.camera arrives with
// supabase/applied/2026-09-14/set-shot-camera.sql (run in production on
// 2026-09-14). It was written to survive the column's absence, and still
// is: PostgREST fails a whole statement that names a missing column, so no
// existing query names it — the camera is written in an update of its own
// whose failure is ignored, and read in queries of their own whose failure
// reads as "no camera". Without the column, every shot works exactly as it
// did, and none carries a look.

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
 * The frame a shot was taken from, as it is stored: the pose and the
 * figure's mark from the layout the page sent (`layout.camera`,
 * `layout.mark`), as sent, and the canvas's shape — through the bounds a
 * read applies, which move nothing. Null when any of it is missing or out
 * of bounds: then nothing is stored, and the shot is never a look's source.
 * A crafted pose or mark can only spoil its sender's own look.
 */
export function shotCameraOf(
  layout: unknown,
  canvasAspect: unknown,
  // A rig format's frame (rig.ts formatFrame): the render's and the band's
  // shapes, worked out on the server from the format's name. Absent for the
  // square, recorded exactly as before.
  frame?: { render: number; band: number } | null,
): ShotCamera | null {
  const record = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const sent = record(layout);
  const camera = record(sent?.camera);
  const mark = record(sent?.mark);
  if (!camera || !mark) return null;
  return normaliseShotCamera({
    position: camera.position,
    target: camera.target,
    fovDeg: camera.fovDeg,
    canvasAspect,
    figure: { x: mark.x, z: mark.z },
    ...(frame ? { frame } : {}),
  });
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
