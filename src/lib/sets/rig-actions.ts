"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { getLocale } from "@/lib/i18n/server";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { lookStoragePath } from "@/lib/sets/look";
import { normaliseSetRig, RIG_CHECK_ITEMS, type RigCheckItem } from "@/lib/sets/rig";
import { checkRig, type RigCheck } from "@/lib/sets/rig-check";
import { readShotRigs, recordRigCheck } from "@/lib/sets/shot-rig";
import { SET_NOT_FOUND, SET_RIG_CHECK_FAILED, SET_RIG_CHECK_TOO_FAST, SET_SAVE_FAILED, SET_EDIT_TOO_FAST } from "@/lib/sets/messages";

// The rig's actions (Helios Cinema, 2026-09-15, canvas page I). The rig —
// format, stock, lens, stop, light, palette, era, genre — lives in
// `location_sets.rig` (supabase/pending/helios-rig.sql; the page works
// without it, it just cannot remember the rig between visits until the
// column exists). Shooting with it is NOT here: shootInSet takes the rig
// with the frame and works out its words there. This file remembers the rig
// and reads a still back against it.

/**
 * Save the person's rig on their own set. Whatever arrives becomes a rig
 * through normaliseSetRig — the one door — so nothing unparsed is stored.
 */
export async function saveSetRig(setId: string, rig: unknown): Promise<{ error: string | null }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (typeof setId !== "string" || !UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  if (await rateLimited(access.userId, "set-rig", 60, 40)) return { error: SET_EDIT_TOO_FAST };
  const clean = normaliseSetRig(rig);
  const { error } = await createAdminClient()
    .from("location_sets")
    .update({ rig: clean, updated_at: new Date().toISOString() })
    .eq("id", setId)
    .eq("user_id", access.userId)
    .is("deleted_at", null);
  if (error) {
    console.warn("[sets] rig could not be saved (helios-rig.sql run?):", error.message);
    return { error: SET_SAVE_FAILED };
  }
  return { error: null };
}

/**
 * The rig check: read one finished still of the person's own set against
 * the words its rig sent (rig-check.ts), keep the verdicts with it, and
 * hand them back. A still already checked answers from what was kept — a
 * check is read once. Never a gate: the still stays as it is whatever the
 * answer, and a check that cannot read it says so.
 */
export async function checkShotRig(
  setId: string,
  generationId: string,
): Promise<{ error: string } | { error: null; check: RigCheck | null }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  if (typeof setId !== "string" || !UUID_RE.test(setId) || typeof generationId !== "string" || !UUID_RE.test(generationId)) {
    return { error: SET_NOT_FOUND };
  }
  const kept = (await readShotRigs(access.supabase, setId, userId, [generationId])).get(generationId) ?? null;
  if (kept?.check) return { error: null, check: kept.check };
  const asks = RIG_CHECK_ITEMS.flatMap((item: RigCheckItem) => {
    const words = kept?.rig?.words[item];
    return words ? [{ item, words }] : [];
  });
  // Nothing was asked in words: nothing to check, and nothing to say.
  if (asks.length === 0) return { error: null, check: null };

  const { data: gen } = await access.supabase
    .from("generations")
    .select("status, result_url, content_type, deleted_at")
    .eq("id", generationId)
    .eq("user_id", userId)
    .maybeSingle();
  const path =
    gen && gen.status === "succeeded" && !gen.deleted_at && gen.content_type === "image" ? lookStoragePath(gen.result_url, userId) : null;
  if (!path) return { error: SET_NOT_FOUND };
  if (await rateLimited(userId, "set-rig-check", 60 * 10, 30)) return { error: SET_RIG_CHECK_TOO_FAST };

  const admin = createAdminClient();
  const { data: blob, error: downloadError } = await admin.storage.from("generated-images").download(path);
  if (downloadError || !blob) {
    console.warn("[sets] rig check could not read the still:", downloadError?.message ?? "no body");
    return { error: SET_RIG_CHECK_FAILED };
  }
  const bytes = Buffer.from(await blob.arrayBuffer());
  const verdicts = await checkRig(bytes, blob.type || "image/png", asks, await getLocale());
  if (!verdicts) return { error: SET_RIG_CHECK_FAILED };
  const check: RigCheck = { checkedAt: new Date().toISOString(), verdicts };
  await recordRigCheck(admin, { setId, generationId, userId }, check);
  return { error: null, check };
}
