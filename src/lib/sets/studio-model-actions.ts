"use server";

// Models the Studio keeps (2026-09-30, operator: "Apply this look for the
// car." · "I also want to see it rendered in 3d."): a .glb imported with File ▸
// Import 3D model was gone when the Studio closed. Now it is kept as a file of
// the set (studio-models.ts), the way a thing's model is (model-actions.ts):
// the file never passes through our server — the page is handed a one-time
// address in storage for exactly this file (reserveStudioModel), sends it
// there itself, and asks for it to be kept (keepStudioModel), which keeps it
// only if it is a binary glTF of the size it claims. The saved scene names the
// file by its path; studioModelUrls signs the paths it names, the person's
// own only, each time the Studio opens.
//
// Free: storage only, nothing is called. Open to whoever the Studio is open
// to (HELIOS_STUDIO_FOR_ALL), as saving the scene is.

import { createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { mediaUrl } from "@/lib/media/url";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { HELIOS_STUDIO_FOR_ALL } from "@/lib/sets/set-config";
import { THING_MODEL_BUCKET, THING_MODEL_MAX_BYTES, glbHeaderOk } from "@/lib/sets/thing-model";
import { STUDIO_MODEL_FILES_MAX, ownStudioModelPath, studioModelPath } from "@/lib/sets/studio-models";
import { SET_NOT_FOUND, THING_MODEL_NOT_A_MODEL, THING_MODEL_SAVE_FAILED, THING_MODEL_TOO_BIG, THING_MODEL_TOO_FAST } from "@/lib/sets/messages";

/** Models a person may keep in the Studio an hour. */
const STUDIO_MODELS_PER_HOUR = 30;

/** The set is the person's own and not deleted: the Studio's owner check, read with the service client inside their id. */
async function ownsSet(userId: string, setId: unknown): Promise<boolean> {
  if (typeof setId !== "string" || !UUID_RE.test(setId)) return false;
  const { data } = await createAdminClient().from("location_sets").select("id").eq("id", setId).eq("user_id", userId).is("deleted_at", null).maybeSingle();
  return !!data;
}

/** Step 1: a one-time place in storage for one model file the Studio imported. */
export async function reserveStudioModel(setId: string, input: { size: number }): Promise<{ error: string } | { error: null; path: string; token: string }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (!access.isAdmin && !HELIOS_STUDIO_FOR_ALL) return { error: SET_NOT_FOUND };
  if (!(await ownsSet(access.userId, setId))) return { error: SET_NOT_FOUND };
  const size = typeof input?.size === "number" ? input.size : 0;
  if (!(size > 0)) return { error: THING_MODEL_NOT_A_MODEL };
  if (size > THING_MODEL_MAX_BYTES) return { error: THING_MODEL_TOO_BIG };
  if (await rateLimited(access.userId, "studio-model", 60 * 60, STUDIO_MODELS_PER_HOUR)) return { error: THING_MODEL_TOO_FAST };
  const path = studioModelPath(access.userId, setId, Date.now(), crypto.randomUUID().replace(/-/g, "").slice(0, 16));
  const { data, error } = await createAdminClient().storage.from(THING_MODEL_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) return { error: THING_MODEL_SAVE_FAILED };
  return { error: null, path, token: data.token };
}

/** Step 2: the file is there; kept if it is a binary glTF of its own size, removed if not. */
export async function keepStudioModel(setId: string, input: { path: string }): Promise<{ error: string } | { error: null; file: string; url: string }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (!access.isAdmin && !HELIOS_STUDIO_FOR_ALL) return { error: SET_NOT_FOUND };
  if (!(await ownsSet(access.userId, setId))) return { error: SET_NOT_FOUND };
  const path = input?.path;
  if (!ownStudioModelPath(access.userId, setId, path)) return { error: THING_MODEL_NOT_A_MODEL };
  const admin = createAdminClient();
  const { data: blob, error } = await admin.storage.from(THING_MODEL_BUCKET).download(path);
  if (error || !blob) return { error: THING_MODEL_SAVE_FAILED };
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (blob.size > THING_MODEL_MAX_BYTES || !glbHeaderOk(head, blob.size)) {
    await admin.storage.from(THING_MODEL_BUCKET).remove([path]);
    return { error: blob.size > THING_MODEL_MAX_BYTES ? THING_MODEL_TOO_BIG : THING_MODEL_NOT_A_MODEL };
  }
  return { error: null, file: path, url: mediaUrl(THING_MODEL_BUCKET, path) };
}

/** Where the Studio loads the model files its scene names: the person's own, of this set, signed; anything else is left out. */
export async function studioModelUrls(setId: string, input: { files: string[] }): Promise<{ error: string } | { error: null; urls: Record<string, string> }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (!access.isAdmin && !HELIOS_STUDIO_FOR_ALL) return { error: SET_NOT_FOUND };
  if (!(await ownsSet(access.userId, setId))) return { error: SET_NOT_FOUND };
  const urls: Record<string, string> = {};
  const files = Array.isArray(input?.files) ? input.files.slice(0, STUDIO_MODEL_FILES_MAX) : [];
  for (const f of files) if (ownStudioModelPath(access.userId, setId, f)) urls[f] = mediaUrl(THING_MODEL_BUCKET, f);
  return { error: null, urls };
}
