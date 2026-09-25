// Press Tour: the staged uploads nobody read, removed (review SEC-3,
// 2026-09-26).
//
// reservePressUploads (card-service.ts) mints a signed upload token for
// <user>/uploads/<batch>/<n> in the press-uploads bucket, and the browser
// puts the person's photo there. The server reads a staged file once, when
// the card or brand kit is made from it, and removes it then. A file whose
// card is never made (the tab closed, a script that only reserves and
// uploads) had nothing to remove it: it sat in storage for good. A token
// also stays valid for two hours after its file is read and removed, so the
// same place can be filled again.
//
// So every staged file older than STAGED_UPLOAD_MAX_AGE_SECONDS (the
// token's two hours plus a margin) is removed, hourly, by
// /api/cron/press-uploads. The bucket's own limits (12 MB a file, pictures
// only: press-tour-02-products.sql section 6) bound what can pile up in
// between.
//
// public.press_stale_uploads lists the names (storage.objects is not
// reachable through the API); the Storage API removes them, bytes included.
// Only paths of the staging shape are ever removed.
//
// Relative imports only, and the client passed in: tested with a fake.

import type { SupabaseClient } from "@supabase/supabase-js";

export const PRESS_UPLOADS_BUCKET = "press-uploads";
/** A signed upload token lives 2 hours; a staged file older than 3 hours is abandoned. */
export const STAGED_UPLOAD_MAX_AGE_SECONDS = 3 * 60 * 60;
/** Names per listing and per remove() call (remove()'s own ceiling). */
export const SWEEP_BATCH = 1000;
/** Listings per run; what a run leaves, the next one takes. */
export const SWEEP_MAX_BATCHES = 20;

const STAGED_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9]$/;

/** Whether a name is a staged upload's place (card-service.ts reservePressUploads). */
export function isStagedUploadPath(name: unknown): name is string {
  return typeof name === "string" && STAGED_PATH.test(name);
}

/** A set-returning function of text comes back as strings; accept the one-column row shape too. */
function nameOf(item: unknown): unknown {
  if (item && typeof item === "object" && !Array.isArray(item)) return (item as Record<string, unknown>).press_stale_uploads;
  return item;
}

/**
 * Removes every staged upload older than STAGED_UPLOAD_MAX_AGE_SECONDS,
 * oldest first, a batch at a time. Never throws; stops at the first error,
 * at an empty or short listing, or at the batch ceiling.
 */
export async function sweepStaleUploads(
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<{ removed: number; done: boolean; error: string | null }> {
  const before = new Date(now.getTime() - STAGED_UPLOAD_MAX_AGE_SECONDS * 1000).toISOString();
  let removed = 0;
  try {
    for (let round = 0; round < SWEEP_MAX_BATCHES; round++) {
      const { data, error } = await admin.rpc("press_stale_uploads", { p_before: before, p_limit: SWEEP_BATCH });
      if (error) return { removed, done: false, error: error.message };
      const listed = Array.isArray(data) ? data.map(nameOf) : [];
      const names = listed.filter(isStagedUploadPath);
      if (names.length > 0) {
        const { error: removeError } = await admin.storage.from(PRESS_UPLOADS_BUCKET).remove(names);
        if (removeError) return { removed, done: false, error: removeError.message };
        removed += names.length;
      }
      // A short listing was the last of them. A full one of names this sweep
      // may not remove would come back unchanged: stop rather than spin.
      if (listed.length < SWEEP_BATCH || names.length === 0) return { removed, done: true, error: null };
    }
    return { removed, done: false, error: null };
  } catch (err) {
    return { removed, done: false, error: err instanceof Error ? err.message : String(err) };
  }
}
