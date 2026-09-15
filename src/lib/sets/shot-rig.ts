// The rig each Set shot was shot with, and its rig check (Helios Cinema,
// 2026-09-15). Relative imports only and the Supabase client passed in, so
// the test suite loads this file as it is.
//
// A still carries the rig it was shot with — the format it was cut to and
// the very words each look sent — so the page can show it under the still,
// the rig check can read the still against exactly what was asked, and a
// take shot from it is played in its frame. After the check reads it, the
// verdicts are kept beside the rig, so a page load never asks again.
//
// THE ONLY MODULE IN src/ THAT NAMES THESE COLUMNS (shot-rig.test.ts scans
// for them). location_set_shots.rig and .rig_check arrive with
// supabase/pending/helios-rig.sql. Written, like shot-camera.ts, to survive
// their absence: PostgREST fails a whole statement that names a missing
// column, so no existing query names them — each is written in an update of
// its own whose failure is ignored, and read in a query of its own whose
// failure reads as "no rig, no check". Without the columns every shot works
// exactly as before; it just carries no rig line and no check.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isRigCheckItem, isRigFormat, type RigCheckItem, type RigFormat } from "./rig";
import { normaliseRigCheck, type RigCheck } from "./rig-check";
import { cleanText } from "./set-spec";

const RIG = "rig";
const CHECK = "rig_check";

/** What a shot keeps of its rig: the format it was cut to, and each checked look's words exactly as sent. */
export type ShotRig = { format: RigFormat; words: Partial<Record<RigCheckItem, string>> };

const WORDS_MAX = 600;

/** A stored shot rig through one door, or null. */
export function normaliseShotRig(v: unknown): ShotRig | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const format: RigFormat = isRigFormat(r.format) ? r.format : "square";
  const words: Partial<Record<RigCheckItem, string>> = {};
  const w = r.words && typeof r.words === "object" && !Array.isArray(r.words) ? (r.words as Record<string, unknown>) : {};
  for (const [k, text] of Object.entries(w)) {
    if (!isRigCheckItem(k)) continue;
    const said = cleanText(text, WORDS_MAX);
    if (said) words[k] = said;
  }
  return { format, words };
}

const warned = new Set<string>();
function warnOnce(op: string, message: string) {
  if (warned.has(op)) return;
  warned.add(op);
  console.warn(`[sets] shot rig ${op} failed (further failures of this kind are not logged): ${message}`);
}

type ShotKey = { setId: string; generationId: string; userId: string };

async function writeColumn(admin: SupabaseClient, shot: ShotKey, column: string, value: unknown, op: string): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("location_set_shots")
      .update({ [column]: value })
      .eq("set_id", shot.setId)
      .eq("generation_id", shot.generationId)
      .eq("user_id", shot.userId)
      .select("generation_id");
    if (error) {
      warnOnce(op, error.message);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    warnOnce(op, err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** Record a shot's rig, after its row is in. Never throws; false before helios-rig.sql has run. */
export function recordShotRig(admin: SupabaseClient, shot: ShotKey, rig: ShotRig): Promise<boolean> {
  return writeColumn(admin, shot, RIG, rig, "write");
}

/** Keep a shot's rig check beside its rig. Never throws. */
export function recordRigCheck(admin: SupabaseClient, shot: ShotKey, check: RigCheck): Promise<boolean> {
  return writeColumn(admin, shot, CHECK, check, "check write");
}

export type ShotRigRecord = { rig: ShotRig | null; check: RigCheck | null };

/**
 * The rigs and checks of a set's shots, by generation id — of the shots
 * named, or all of them. Fail-open: the columns missing, or any other
 * failure, reads as no rig and no check at all.
 */
export async function readShotRigs(
  db: SupabaseClient,
  setId: string,
  userId: string,
  generationIds?: string[],
): Promise<Map<string, ShotRigRecord>> {
  const out = new Map<string, ShotRigRecord>();
  if (generationIds && generationIds.length === 0) return out;
  try {
    let query = db.from("location_set_shots").select(`generation_id, ${RIG}, ${CHECK}`).eq("set_id", setId).eq("user_id", userId);
    if (generationIds) query = query.in("generation_id", generationIds);
    const { data, error } = await query;
    if (error) {
      warnOnce("read", error.message);
      return out;
    }
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      if (typeof row.generation_id !== "string") continue;
      const rig = normaliseShotRig(row[RIG]);
      const check = normaliseRigCheck(row[CHECK]);
      if (rig || check) out.set(row.generation_id, { rig, check });
    }
    return out;
  } catch (err) {
    warnOnce("read", err instanceof Error ? err.message : String(err));
    return out;
  }
}
