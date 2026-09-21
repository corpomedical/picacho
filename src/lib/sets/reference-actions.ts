"use server";

// Reference photos (2026-09-21, "we need to add an option to upload
// reference images, this is what we missed"): the person's photos of things
// the set should hold, uploaded to the set and offered as a shot's look
// (references.ts). Every upload is checked the way a photo set's photo is
// (actions.ts submitSetPhotoBuild): prepared in the browser
// (photo-client.ts), re-encoded here whatever arrived (EXIF and location
// gone), and judged from its bytes by the picture gate in the strict lane
// before anything is stored. The sheet is drawn from it the first time it
// is a look (actions.ts shootInSet), never here: an upload costs no render.

import { createAdminClient } from "@/lib/supabase/server";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { SET_REFS_MAX, setRefPhotoPath, setRefSheetPath } from "@/lib/sets/set-config";
import { listSetReferences, type SetReference } from "@/lib/sets/references";
import { checkReferencePhoto, parseReferencePhoto } from "@/lib/sets/reference-upload";
import { SET_NOT_FOUND, SET_PHOTO_SAVE_FAILED, SET_REF_TOO_MANY } from "@/lib/sets/messages";

const BUCKET = "generated-images";

/** The set is the person's own and not deleted — all a reference needs. */
async function ownsSet(setId: string, userId: string): Promise<boolean> {
  if (typeof setId !== "string" || !UUID_RE.test(setId)) return false;
  const { data } = await createAdminClient()
    .from("location_sets")
    .select("id")
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  return Boolean(data);
}

/** Upload one reference photo to a set; it comes back listed, ready to be picked as the look. */
export async function addSetReference(
  setId: string,
  input: { photoDataUri: string },
): Promise<{ error: string } | { error: null; reference: SetReference }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  if (!(await ownsSet(setId, userId))) return { error: SET_NOT_FOUND };

  const parsed = parseReferencePhoto(input?.photoDataUri);
  if (!parsed.ok) return { error: parsed.error };

  const admin = createAdminClient();
  if ((await listSetReferences(admin, userId, setId)).length >= SET_REFS_MAX) return { error: SET_REF_TOO_MANY };
  // The hourly limit, the re-encode and the picture gate (reference-upload.ts).
  const photo = await checkReferencePhoto(userId, parsed.bytes);
  if (photo.error !== null) return { error: photo.error };

  const id = crypto.randomUUID();
  const path = setRefPhotoPath(userId, setId, id);
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, photo.jpeg, { contentType: "image/jpeg", upsert: false });
  if (uploadError) {
    console.error("[sets] reference upload failed:", uploadError.message);
    return { error: SET_PHOTO_SAVE_FAILED };
  }
  const listed = (await listSetReferences(admin, userId, setId)).find((r) => r.id === id);
  return listed ? { error: null, reference: listed } : { error: SET_PHOTO_SAVE_FAILED };
}

/** Remove a reference photo, and the sheet drawn from it, from a set. */
export async function removeSetReference(setId: string, refId: string): Promise<{ error: string | null }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;
  if (typeof refId !== "string" || !UUID_RE.test(refId) || !(await ownsSet(setId, userId))) return { error: SET_NOT_FOUND };
  const { error } = await createAdminClient()
    .storage.from(BUCKET)
    .remove([setRefPhotoPath(userId, setId, refId), setRefSheetPath(userId, setId, refId)]);
  if (error) {
    console.warn("[sets] reference removal failed:", error.message);
    return { error: SET_PHOTO_SAVE_FAILED };
  }
  return { error: null };
}
