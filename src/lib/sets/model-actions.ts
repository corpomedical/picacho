"use server";

// A model kept with a set (thing-model.ts, 2026-09-24, "Keep going"): the
// file an admin loaded onto a thing is stored beside the set's other files,
// so it is still on the stage when the set is opened again.
//
// A model is often tens of megabytes, past what a request to our own server
// may carry, so it never passes through it: the page is handed a one-time
// address in storage for exactly this file (reserveThingModel), sends the
// file there itself, and then asks for it to be kept (keepThingModel) —
// which reads the stored file's first bytes and keeps it only if it is a
// binary glTF of the size it claims. One model per thing: keeping a new one
// removes the old. Admins only while our own model builder is proved.

import { createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { mediaUrl } from "@/lib/media/url";
import { setsAccess, UUID_RE, type SetsAccess } from "@/lib/sets/access";
import { ELEMENT_KEY_RE } from "@/lib/sets/elements";
import { THING_MODEL_BUCKET, THING_MODEL_MAX_BYTES, glbHeaderOk, parseModelName, setModelPath } from "@/lib/sets/thing-model";
import { listModelFiles, type KeptThingModel } from "@/lib/sets/thing-model-store";
import {
  SET_NOT_FOUND,
  THING_MODEL_ADMINS_ONLY,
  THING_MODEL_NOT_A_MODEL,
  THING_MODEL_SAVE_FAILED,
  THING_MODEL_TOO_BIG,
  THING_MODEL_TOO_FAST,
} from "@/lib/sets/messages";

type Admin = ReturnType<typeof createAdminClient>;

/** The person asking (each action asks first, itself) is an admin and the set is theirs, not deleted. */
async function ownSet(access: SetsAccess, setId: unknown): Promise<{ error: string } | { error: null; userId: string; setId: string }> {
  if (access.error !== null) return { error: access.error };
  if (!access.isAdmin) return { error: THING_MODEL_ADMINS_ONLY };
  if (typeof setId !== "string" || !UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  const { data: row } = await createAdminClient()
    .from("location_sets")
    .select("id")
    .eq("id", setId)
    .eq("user_id", access.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return { error: SET_NOT_FOUND };
  return { error: null, userId: access.userId, setId };
}

/** A stored path is this person's, this set's, and a model's name — nothing else is touched through here. */
function ownModelPath(userId: string, setId: string, path: unknown): { key: string; flip: boolean; at: number } | null {
  if (typeof path !== "string" || !path.startsWith(`${userId}/sets/`)) return null;
  return parseModelName(setId, path.slice(`${userId}/sets/`.length));
}

/** Every other model file of the same thing, gone: one model per thing. */
async function removeOthers(admin: Admin, userId: string, setId: string, key: string, keep: string | null): Promise<void> {
  const paths = (await listModelFiles(admin, userId, setId)).filter((f) => f.key === key && f.path !== keep).map((f) => f.path);
  if (paths.length) await admin.storage.from(THING_MODEL_BUCKET).remove(paths);
}

/** Step 1: a one-time place in storage for this thing's model file. */
export async function reserveThingModel(
  setId: string,
  input: { key: string; size: number },
): Promise<{ error: string } | { error: null; path: string; token: string }> {
  const own = await ownSet(await setsAccess(), setId);
  if (own.error !== null) return { error: own.error };
  const key = typeof input?.key === "string" && ELEMENT_KEY_RE.test(input.key) ? input.key : null;
  if (!key) return { error: THING_MODEL_NOT_A_MODEL };
  const size = typeof input?.size === "number" ? input.size : 0;
  if (!(size > 0)) return { error: THING_MODEL_NOT_A_MODEL };
  if (size > THING_MODEL_MAX_BYTES) return { error: THING_MODEL_TOO_BIG };
  if (await rateLimited(own.userId, "thing-model", 60 * 60, 30)) return { error: THING_MODEL_TOO_FAST };
  const path = setModelPath(own.userId, own.setId, key, Date.now(), false);
  const { data, error } = await createAdminClient().storage.from(THING_MODEL_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) return { error: THING_MODEL_SAVE_FAILED };
  return { error: null, path, token: data.token };
}

/** Step 2: the file is there; keep it if it is a model, and let the thing's older one go. */
export async function keepThingModel(setId: string, input: { path: string }): Promise<{ error: string } | { error: null; model: KeptThingModel }> {
  const own = await ownSet(await setsAccess(), setId);
  if (own.error !== null) return { error: own.error };
  const named = ownModelPath(own.userId, own.setId, input?.path);
  if (!named) return { error: THING_MODEL_NOT_A_MODEL };
  const admin = createAdminClient();
  const path = input.path;
  const { data: blob, error } = await admin.storage.from(THING_MODEL_BUCKET).download(path);
  if (error || !blob) return { error: THING_MODEL_SAVE_FAILED };
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (blob.size > THING_MODEL_MAX_BYTES || !glbHeaderOk(head, blob.size)) {
    await admin.storage.from(THING_MODEL_BUCKET).remove([path]);
    return { error: blob.size > THING_MODEL_MAX_BYTES ? THING_MODEL_TOO_BIG : THING_MODEL_NOT_A_MODEL };
  }
  await removeOthers(admin, own.userId, own.setId, named.key, path);
  return { error: null, model: { key: named.key, url: mediaUrl(THING_MODEL_BUCKET, path), flip: named.flip } };
}

/** Turned round, kept turned round: the same file under the name that says so. */
export async function turnThingModel(setId: string, input: { key: string; flip: boolean }): Promise<{ error: string } | { error: null; model: KeptThingModel }> {
  const own = await ownSet(await setsAccess(), setId);
  if (own.error !== null) return { error: own.error };
  const admin = createAdminClient();
  const newest = (await listModelFiles(admin, own.userId, own.setId)).find((f) => f.key === input?.key);
  if (!newest) return { error: THING_MODEL_SAVE_FAILED };
  const flip = input.flip === true;
  if (newest.flip === flip) return { error: null, model: { key: newest.key, url: mediaUrl(THING_MODEL_BUCKET, newest.path), flip } };
  const to = setModelPath(own.userId, own.setId, newest.key, newest.at, flip);
  const { error } = await admin.storage.from(THING_MODEL_BUCKET).move(newest.path, to);
  if (error) return { error: THING_MODEL_SAVE_FAILED };
  return { error: null, model: { key: newest.key, url: mediaUrl(THING_MODEL_BUCKET, to), flip } };
}

/** Back to blocks: the thing's model files, gone. */
export async function removeThingModel(setId: string, input: { key: string }): Promise<{ error: string | null }> {
  const own = await ownSet(await setsAccess(), setId);
  if (own.error !== null) return { error: own.error };
  if (typeof input?.key !== "string" || !ELEMENT_KEY_RE.test(input.key)) return { error: null };
  await removeOthers(createAdminClient(), own.userId, own.setId, input.key, null);
  return { error: null };
}
