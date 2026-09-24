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
import { normaliseSetSpec, type SetSpec } from "@/lib/sets/set-spec";
import { resolvePhotos, setElements, type ElementPhoto } from "@/lib/sets/elements";
import { listElementPhotos } from "@/lib/sets/references";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";
import { cutViews, findViews, VIEW_MAX } from "@/lib/sets/thing-views";
import {
  THING_BUILDS_PER_HOUR,
  THING_BUILD_MULTI_ENDPOINT,
  THING_BUILD_USD,
  buildHandleAllowed,
  builtModelUrl,
  readBuildHandle,
  thingBuildRequest,
  type ThingBuildHandle,
} from "@/lib/sets/thing-build";
import {
  SET_NOT_FOUND,
  THING_MODEL_ADMINS_ONLY,
  THING_MODEL_NOT_A_MODEL,
  THING_MODEL_SAVE_FAILED,
  THING_MODEL_TOO_BIG,
  THING_MODEL_TOO_FAST,
  THING_BUILD_FAILED,
  THING_BUILD_NO_PHOTO,
  SET_ELEMENT_GONE,
} from "@/lib/sets/messages";

type Admin = ReturnType<typeof createAdminClient>;

/** A photo sent whole says what it is: PNG and WebP were labelled JPEG before. */
function sniffImageType(bytes: Buffer): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return "image/jpeg";
}

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

/** The set as the page draws it: the working copy when one is saved, read on its own, as element-actions.ts reads it. */
async function workingSpec(admin: Admin, userId: string, setId: string): Promise<SetSpec | null> {
  const { data: row } = await admin.from("location_sets").select("spec").eq("id", setId).eq("user_id", userId).is("deleted_at", null).maybeSingle();
  const first = row ? normaliseSetSpec(row.spec) : null;
  if (!first?.ok) return null;
  const { data: editedRow, error } = await admin
    .from("location_sets")
    .select("edited_spec")
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!error && editedRow?.edited_spec) {
    const e = normaliseSetSpec(editedRow.edited_spec);
    if (e.ok) return e.spec;
  }
  return first.spec;
}

/**
 * Build a thing's 3D model from its front photo (thing-build.ts, 2026-09-24,
 * "Everything should be done under one roof"): the photo's bytes go to
 * TRELLIS.2 on fal's queue and the page is handed the job to ask after
 * (pollThingBuild). The key is resolved against the saved set, as a photo's
 * is, and the model is kept under the thing it finds.
 */
export async function startThingBuild(setId: string, key: string): Promise<{ error: string } | { error: null; key: string; handle: ThingBuildHandle }> {
  const own = await ownSet(await setsAccess(), setId);
  if (own.error !== null) return { error: own.error };
  if (typeof key !== "string" || !ELEMENT_KEY_RE.test(key)) return { error: SET_ELEMENT_GONE };
  const admin = createAdminClient();
  const spec = await workingSpec(admin, own.userId, own.setId);
  if (!spec) return { error: SET_NOT_FOUND };
  const els = setElements(spec);
  const probe: ElementPhoto = { refId: "00000000-0000-4000-8000-000000000000", anchor: key, slot: 1, at: 0, url: "" };
  const thingKey = resolvePhotos(els, [probe]).held[0]?.key ?? null;
  if (!thingKey) return { error: SET_ELEMENT_GONE };
  const listing = await listElementPhotos(admin, own.userId, own.setId);
  // Every photo the thing holds, front first — each can add views of it.
  const held = resolvePhotos(els, listing.photos).held.find((h) => h.key === thingKey)?.photos ?? [];
  const paths = held.map((h) => listing.photos.find((p) => p.refId === h.refId)?.path).filter((p): p is string => typeof p === "string");
  if (!paths.length) return { error: THING_BUILD_NO_PHOTO };
  if (await rateLimited(own.userId, "thing-build", 60 * 60, THING_BUILDS_PER_HOUR)) return { error: THING_MODEL_TOO_FAST };
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) return { error: THING_BUILD_FAILED };
  // The views on each photo, cut apart (thing-views.ts): a four-view sheet
  // sent whole built four small cars. Each photo gives its views — several on
  // a sheet, one on a product shot, the photo itself when nothing clean can
  // be cut — and every view of the thing, up to four, goes into ONE build.
  const images: string[] = [];
  for (const path of paths) {
    if (images.length >= VIEW_MAX) break;
    const { data: photo, error: readError } = await admin.storage.from("generated-images").download(path);
    if (readError || !photo) continue;
    const bytes = Buffer.from(await photo.arrayBuffer());
    let views: string[] = [];
    try {
      views = await cutViews(bytes, await findViews(bytes));
    } catch (err) {
      console.warn("[sets] a thing photo's views could not be read; sent whole:", err instanceof Error ? err.message : err);
    }
    if (!views.length) views = [`data:${sniffImageType(bytes)};base64,${bytes.toString("base64")}`];
    images.push(...views.slice(0, VIEW_MAX - images.length));
  }
  if (!images.length) return { error: THING_BUILD_FAILED };
  const request = thingBuildRequest(images);
  const res = await fetchWithTimeout(
    `https://queue.fal.run/${request.endpoint}`,
    { method: "POST", headers: { authorization: `Key ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify(request.body) },
    30_000,
  );
  if (!res.ok) {
    console.warn("[sets] thing build submit failed:", res.status, (await res.text()).slice(0, 300));
    return { error: THING_BUILD_FAILED };
  }
  const handle = readBuildHandle(await res.json());
  if (!handle) return { error: THING_BUILD_FAILED };
  console.info("[sets] thing build started", { setId: own.setId, key: thingKey, requestId: handle.requestId, usd: THING_BUILD_USD, views: images.length, multi: request.endpoint === THING_BUILD_MULTI_ENDPOINT });
  return { error: null, key: thingKey, handle };
}

/** Ask after a build: still working, or done — the model kept with the set, one per thing — or failed. */
export async function pollThingBuild(
  setId: string,
  input: { key: string; handle: unknown },
): Promise<{ error: string } | { error: null; state: "working" } | { error: null; state: "done"; model: KeptThingModel }> {
  const own = await ownSet(await setsAccess(), setId);
  if (own.error !== null) return { error: own.error };
  const key = typeof input?.key === "string" && ELEMENT_KEY_RE.test(input.key) ? input.key : null;
  if (!key || !buildHandleAllowed(input.handle)) return { error: THING_BUILD_FAILED };
  const handle = input.handle;
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) return { error: THING_BUILD_FAILED };
  const auth = { authorization: `Key ${apiKey}` };
  const statusRes = await fetchWithTimeout(handle.statusUrl, { headers: auth }, 15_000);
  if (!statusRes.ok) return { error: null, state: "working" };
  const status = ((await statusRes.json()) as { status?: string }).status;
  if (status === "FAILED" || status === "CANCELLED") return { error: THING_BUILD_FAILED };
  if (status !== "COMPLETED") return { error: null, state: "working" };
  const resultRes = await fetchWithTimeout(handle.responseUrl, { headers: auth }, 20_000);
  if (!resultRes.ok) return { error: THING_BUILD_FAILED };
  const made = builtModelUrl(await resultRes.json());
  if (!made || (made.size !== null && made.size > THING_MODEL_MAX_BYTES)) return { error: made ? THING_MODEL_TOO_BIG : THING_BUILD_FAILED };
  const glbRes = await fetchWithTimeout(made.url, {}, 60_000);
  if (!glbRes.ok) return { error: THING_BUILD_FAILED };
  const bytes = new Uint8Array(await glbRes.arrayBuffer());
  if (bytes.byteLength > THING_MODEL_MAX_BYTES) return { error: THING_MODEL_TOO_BIG };
  if (!glbHeaderOk(bytes.subarray(0, 12), bytes.byteLength)) return { error: THING_BUILD_FAILED };
  const admin = createAdminClient();
  const path = setModelPath(own.userId, own.setId, key, Date.now(), false);
  const { error: upError } = await admin.storage.from(THING_MODEL_BUCKET).upload(path, bytes, { contentType: "model/gltf-binary", upsert: false });
  if (upError) {
    console.warn("[sets] a built model was not kept:", upError.message);
    return { error: THING_MODEL_SAVE_FAILED };
  }
  await removeOthers(admin, own.userId, own.setId, key, path);
  return { error: null, state: "done", model: { key, url: mediaUrl(THING_MODEL_BUCKET, path), flip: false } };
}
