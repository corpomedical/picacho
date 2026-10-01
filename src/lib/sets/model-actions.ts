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
//
// Helios Studio (2026-09-30) builds through these same doors: a thing's model
// from one photo it holds (startThingBuild's refId), and a new object's from
// a photo of its own (startNewModelBuild), kept as a Studio file.

import { createAdminClient } from "@/lib/supabase/server";
import { offered } from "@/lib/models/controls";
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
import { checkReferencePhoto, parseReferencePhoto } from "@/lib/sets/reference-upload";
import { studioModelPath } from "@/lib/sets/studio-models";
import { STUDIO_MODEL_ENGINES_FOR_ALL } from "@/lib/sets/set-config";
import { gatePrompt } from "@/lib/generations/policy-log";
import { ContentPolicyRefusal } from "@/lib/generations/content-policy";
import {
  MODEL_VIEWS,
  modelBuildRequest,
  modelBuildUsd,
  modelEngine,
  modelHandleAllowed,
  modelInputProblem,
  modelResultGlb,
  normaliseModelOptions,
  readModelHandle,
  type ModelBuildHandle,
  type ModelEngine,
  type ModelImages,
  type ModelInputKind,
} from "@/lib/sets/model-engines";
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
  STUDIO_MODEL_BUILD_FAILED,
  STUDIO_MODEL_ENGINE_UNKNOWN,
  STUDIO_MODEL_STILL_STARTING,
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

/** fal's queue, asked for one build of these images: the handle to ask after, or why not. */
async function submitBuild(images: string[], log: Record<string, unknown>): Promise<{ error: string } | { error: null; handle: ThingBuildHandle }> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) return { error: THING_BUILD_FAILED };
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
  console.info("[sets] thing build started", { ...log, requestId: handle.requestId, usd: THING_BUILD_USD, views: images.length, multi: request.endpoint === THING_BUILD_MULTI_ENDPOINT });
  return { error: null, handle };
}

/** A photo's views, cut apart (thing-views.ts); the photo itself when nothing clean can be cut. */
async function viewsOf(bytes: Buffer): Promise<string[]> {
  let views: string[] = [];
  try {
    views = await cutViews(bytes, await findViews(bytes));
  } catch (err) {
    console.warn("[sets] a thing photo's views could not be read; sent whole:", err instanceof Error ? err.message : err);
  }
  return views.length ? views : [`data:${sniffImageType(bytes)};base64,${bytes.toString("base64")}`];
}

/**
 * fal's answer about a build: still working, failed, or the .glb it made — fetched, and checked to be one. `pick`
 * finds the .glb in the answer (TRELLIS.2's model_glb by default; the prompt bar's engines name theirs,
 * model-engines.ts modelResultGlb).
 */
async function readBuilt(
  handle: ThingBuildHandle,
  pick: (result: unknown) => { url: string; size: number | null } | null = builtModelUrl,
): Promise<{ error: string } | { error: null; state: "working" } | { error: null; state: "done"; bytes: Uint8Array }> {
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
  const made = pick(await resultRes.json());
  if (!made || (made.size !== null && made.size > THING_MODEL_MAX_BYTES)) return { error: made ? THING_MODEL_TOO_BIG : THING_BUILD_FAILED };
  const glbRes = await fetchWithTimeout(made.url, {}, 60_000);
  if (!glbRes.ok) return { error: THING_BUILD_FAILED };
  const bytes = new Uint8Array(await glbRes.arrayBuffer());
  if (bytes.byteLength > THING_MODEL_MAX_BYTES) return { error: THING_MODEL_TOO_BIG };
  if (!glbHeaderOk(bytes.subarray(0, 12), bytes.byteLength)) return { error: THING_BUILD_FAILED };
  return { error: null, state: "done", bytes };
}

/**
 * Build a thing's 3D model from its front photo (thing-build.ts, 2026-09-24,
 * "Everything should be done under one roof"): the photo's bytes go to
 * TRELLIS.2 on fal's queue and the page is handed the job to ask after
 * (pollThingBuild). The key is resolved against the saved set, as a photo's
 * is, and the model is kept under the thing it finds.
 *
 * `input.refId` (Helios Studio, 2026-09-30 — "Apply this look for the car."):
 * built from that ONE photo of the thing, and its one view — the view the
 * person cropped out of a sheet — so the build is the single-photo endpoint
 * at its stated price, never the multi-view one whose price unit isn't known.
 */
export async function startThingBuild(setId: string, key: string, input?: { refId?: string }): Promise<{ error: string } | { error: null; key: string; handle: ThingBuildHandle }> {
  const own = await ownSet(await setsAccess(), setId);
  if (own.error !== null) return { error: own.error };
  if (typeof key !== "string" || !ELEMENT_KEY_RE.test(key)) return { error: SET_ELEMENT_GONE };
  const only = typeof input?.refId === "string" ? input.refId : null;
  if (only !== null && !UUID_RE.test(only)) return { error: THING_BUILD_NO_PHOTO };
  const admin = createAdminClient();
  const spec = await workingSpec(admin, own.userId, own.setId);
  if (!spec) return { error: SET_NOT_FOUND };
  const els = setElements(spec);
  const probe: ElementPhoto = { refId: "00000000-0000-4000-8000-000000000000", anchor: key, slot: 1, at: 0, url: "" };
  const thingKey = resolvePhotos(els, [probe]).held[0]?.key ?? null;
  if (!thingKey) return { error: SET_ELEMENT_GONE };
  const listing = await listElementPhotos(admin, own.userId, own.setId);
  // Every photo the thing holds, front first — each can add views of it (or only the one asked for).
  const held = (resolvePhotos(els, listing.photos).held.find((h) => h.key === thingKey)?.photos ?? []).filter((h) => only === null || h.refId === only);
  const paths = held.map((h) => listing.photos.find((p) => p.refId === h.refId)?.path).filter((p): p is string => typeof p === "string");
  if (!paths.length) return { error: THING_BUILD_NO_PHOTO };
  if (await rateLimited(own.userId, "thing-build", 60 * 60, THING_BUILDS_PER_HOUR)) return { error: THING_MODEL_TOO_FAST };
  if (!process.env.FAL_KEY) return { error: THING_BUILD_FAILED };
  // The views on each photo, cut apart (thing-views.ts): a four-view sheet
  // sent whole built four small cars. Each photo gives its views — several on
  // a sheet, one on a product shot, the photo itself when nothing clean can
  // be cut — and every view of the thing, up to four, goes into ONE build.
  const images: string[] = [];
  const most = only !== null ? 1 : VIEW_MAX;
  for (const path of paths) {
    if (images.length >= most) break;
    const { data: photo, error: readError } = await admin.storage.from("generated-images").download(path);
    if (readError || !photo) continue;
    const views = await viewsOf(Buffer.from(await photo.arrayBuffer()));
    images.push(...views.slice(0, most - images.length));
  }
  if (!images.length) return { error: THING_BUILD_FAILED };
  const sent = await submitBuild(images, { setId: own.setId, key: thingKey });
  if (sent.error !== null) return { error: sent.error };
  return { error: null, key: thingKey, handle: sent.handle };
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
  const built = await readBuilt(input.handle);
  if (built.error !== null || built.state === "working") return built;
  const bytes = built.bytes;
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

/**
 * A NEW object's model, built from one photo (Helios Studio, 2026-09-30): the
 * same build as a thing's — the same endpoint at the same price, the same
 * hourly limit, admins only — from a photo that belongs to no thing yet. The
 * photo is checked the way a thing's photo is on upload (reference-upload.ts:
 * its own hourly limit, re-encoded, the picture gate) and only its first view
 * is sent; it is not kept. The model is kept as a Studio file of the set
 * (studio-models.ts), which the scene names.
 */
export async function startNewModelBuild(setId: string, input: { photoDataUri: string }): Promise<{ error: string } | { error: null; handle: ThingBuildHandle }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const own = await ownSet(access, setId);
  if (own.error !== null) return { error: own.error };
  const parsed = parseReferencePhoto(input?.photoDataUri);
  if (!parsed.ok) return { error: parsed.error };
  if (await rateLimited(own.userId, "thing-build", 60 * 60, THING_BUILDS_PER_HOUR)) return { error: THING_MODEL_TOO_FAST };
  if (!process.env.FAL_KEY) return { error: THING_BUILD_FAILED };
  const photo = await checkReferencePhoto(own.userId, parsed.bytes);
  if (photo.error !== null) return { error: photo.error };
  const images = (await viewsOf(photo.jpeg)).slice(0, 1);
  const sent = await submitBuild(images, { setId: own.setId, key: "new" });
  if (sent.error !== null) return { error: sent.error };
  return { error: null, handle: sent.handle };
}

/** Ask after a new object's build: still working, or done — kept as a Studio file of the set — or failed. */
export async function pollNewModelBuild(
  setId: string,
  input: { handle: unknown },
): Promise<{ error: string } | { error: null; state: "working" } | { error: null; state: "done"; file: string; url: string }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const own = await ownSet(access, setId);
  if (own.error !== null) return { error: own.error };
  if (!buildHandleAllowed(input?.handle)) return { error: THING_BUILD_FAILED };
  const built = await readBuilt(input.handle);
  if (built.error !== null || built.state === "working") return built;
  const path = studioModelPath(own.userId, own.setId, Date.now(), crypto.randomUUID().replace(/-/g, "").slice(0, 16));
  const { error: upError } = await createAdminClient().storage.from(THING_MODEL_BUCKET).upload(path, built.bytes, { contentType: "model/gltf-binary", upsert: false });
  if (upError) {
    console.warn("[sets] a built Studio model was not kept:", upError.message);
    return { error: THING_MODEL_SAVE_FAILED };
  }
  return { error: null, state: "done", file: path, url: mediaUrl(THING_MODEL_BUCKET, path) };
}

// ---------------------------------------------------------------------------
// The prompt bar's 3D Model engines (Helios Studio, 2026-10-01, operator:
// "Finalizing the UI to look and work like this")
// ---------------------------------------------------------------------------
//
// One door for every engine in model-engines.ts: text, one photo or up to four
// views, the options each engine really takes, priced from fal's own pages.
// The same gates as the set page's build — setsAccess first, admins while
// STUDIO_MODEL_ENGINES_FOR_ALL is false, the set is theirs, the same hourly
// limit (THING_BUILDS_PER_HOUR, shared with it) — and no credits: Picacho pays
// fal, so there is nothing to give back when a build fails. Words go through
// the prompt gate as the person's own; each photo through the reference
// photo's checks (its own hourly limit, re-encoded, the picture gate). The
// result is kept as the thing's model (one per thing) or as a Studio file of
// the set, as "Model from a photo" keeps it.
//
// ONE BUILD PER PRESS: the page sends a fresh press id; the first delivery
// writes a small ticket under it (upsert off), submits, and writes fal's
// handle into it. A browser's silent resend of the same press finds the
// ticket and is answered with the same handle — never a second paid build.

/** Where a press's ticket is kept: the owner's folder, beside the set's models (never read as a model). */
function modelPressPath(userId: string, setId: string, pressId: string): string {
  return `${userId}/sets/${setId}.model-press.${pressId}.json`;
}
type ModelPressTicket = { v: 1; at: number; engine: string; kind: string; handle?: ModelBuildHandle; failed?: string };

async function readModelTicket(path: string): Promise<ModelPressTicket | null> {
  const { data, error } = await createAdminClient().storage.from(THING_MODEL_BUCKET).download(path);
  if (error || !data) return null;
  try {
    const t = JSON.parse(await data.text()) as ModelPressTicket;
    return t && t.v === 1 ? t : null;
  } catch {
    return null;
  }
}

async function writeModelTicket(path: string, ticket: ModelPressTicket, upsert: boolean): Promise<boolean> {
  const { error } = await createAdminClient()
    .storage.from(THING_MODEL_BUCKET)
    .upload(path, JSON.stringify(ticket), { contentType: "application/json", upsert });
  return !error;
}

/** A repeat delivery's answer: the first delivery's handle once it is written (up to ~20 s), else "still starting". */
async function followModelTicket(path: string): Promise<{ error: string } | { error: null; handle: ModelBuildHandle }> {
  for (let i = 0; i < 10; i++) {
    const t = await readModelTicket(path);
    if (t?.handle) return { error: null, handle: t.handle };
    if (t?.failed) return { error: t.failed };
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return { error: STUDIO_MODEL_STILL_STARTING };
}

const PRESS_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: readonly ModelInputKind[] = ["text", "image", "multi"];

/** A thing of the set, by the key the page sent: the key it resolves to in the working copy, or null. */
async function thingKeyIn(admin: Admin, userId: string, setId: string, key: unknown): Promise<string | null> {
  if (typeof key !== "string" || !ELEMENT_KEY_RE.test(key)) return null;
  const spec = await workingSpec(admin, userId, setId);
  if (!spec) return null;
  const probe: ElementPhoto = { refId: "00000000-0000-4000-8000-000000000000", anchor: key, slot: 1, at: 0, url: "" };
  return resolvePhotos(setElements(spec), [probe]).held[0]?.key ?? null;
}

/** The set is this person's and not deleted. */
async function setIsTheirs(admin: Admin, userId: string, setId: unknown): Promise<boolean> {
  if (typeof setId !== "string" || !UUID_RE.test(setId)) return false;
  const { data } = await admin.from("location_sets").select("id").eq("id", setId).eq("user_id", userId).is("deleted_at", null).maybeSingle();
  return !!data;
}

export type StudioModelBuildInput = {
  pressId: string;
  engine: string;
  kind: ModelInputKind;
  /** Text builds: the description. */
  prompt?: string;
  /** Photo builds: data URIs, "front" for one photo; front/back/left/right for multi-view. */
  images?: ModelImages;
  options?: unknown;
  /** The thing whose model it becomes, or a new object of the Studio. */
  target: { key: string } | { new: true };
};

export type StudioModelBuildStarted = {
  error: null;
  engine: string;
  kind: ModelInputKind;
  rig: boolean;
  key: string | null;
  handle: ModelBuildHandle;
  usd: number;
};

/** Start one build from the prompt bar: checked, gated, priced, sent to fal once per press. */
export async function startStudioModelBuild(setId: string, input: StudioModelBuildInput): Promise<{ error: string } | StudioModelBuildStarted> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (!access.isAdmin && !STUDIO_MODEL_ENGINES_FOR_ALL) return { error: THING_MODEL_ADMINS_ONLY };
  const admin = createAdminClient();
  if (!(await setIsTheirs(admin, access.userId, setId))) return { error: SET_NOT_FOUND };
  const engine = modelEngine(input?.engine);
  const kind = KINDS.includes(input?.kind) ? input.kind : null;
  if (!engine || !kind || !engine.endpoints[kind]) return { error: STUDIO_MODEL_ENGINE_UNKNOWN };
  if (!(await offered("models_3d", engine.id))) return { error: "That 3D engine isn't offered right now. Pick another one." };
  const options = normaliseModelOptions(engine, input?.options);
  const prompt = typeof input?.prompt === "string" ? input.prompt.slice(0, 2_000) : "";
  const sent: ModelImages = {};
  for (const v of MODEL_VIEWS) {
    const d = input?.images?.[v];
    if (kind !== "text" && typeof d === "string" && (kind === "multi" || v === "front")) sent[v] = d;
  }
  const problem = modelInputProblem(engine, { kind, prompt, images: sent, options });
  if (problem) return { error: problem };
  const wantsThing = !!input?.target && "key" in input.target;
  const key = wantsThing ? await thingKeyIn(admin, access.userId, setId, (input.target as { key: string }).key) : null;
  if (wantsThing && !key) return { error: SET_ELEMENT_GONE };
  const pressId = typeof input?.pressId === "string" && PRESS_RE.test(input.pressId) ? input.pressId.toLowerCase() : null;
  if (!pressId) return { error: STUDIO_MODEL_BUILD_FAILED };
  const usd = modelBuildUsd(engine, kind, options);
  const ticketPath = modelPressPath(access.userId, setId, pressId);
  const ticket: ModelPressTicket = { v: 1, at: Date.now(), engine: engine.id, kind };
  if (!(await writeModelTicket(ticketPath, ticket, false))) {
    // Written already: this press was delivered before. Its first delivery's handle — never a second build.
    if (!(await readModelTicket(ticketPath))) return { error: STUDIO_MODEL_BUILD_FAILED };
    const again = await followModelTicket(ticketPath);
    if (again.error !== null) return again;
    return { error: null, engine: engine.id, kind, rig: options.rig, key, handle: again.handle, usd };
  }
  const fail = async (error: string): Promise<{ error: string }> => {
    await writeModelTicket(ticketPath, { ...ticket, failed: error }, true);
    return { error };
  };
  if (await rateLimited(access.userId, "thing-build", 60 * 60, THING_BUILDS_PER_HOUR)) return fail(THING_MODEL_TOO_FAST);
  if (!process.env.FAL_KEY) return fail(STUDIO_MODEL_BUILD_FAILED);
  if (kind === "text") {
    try {
      await gatePrompt({ prompt, userId: access.userId, hasRealPersonReference: false });
    } catch (err) {
      if (err instanceof ContentPolicyRefusal) return fail(err.userMessage);
      throw err;
    }
  }
  // Every photo: parsed, then the reference photo's checks (its hourly limit, re-encoded here, the picture gate).
  const images: ModelImages = {};
  for (const v of MODEL_VIEWS) {
    const d = sent[v];
    if (!d) continue;
    const parsed = parseReferencePhoto(d);
    if (!parsed.ok) return fail(parsed.error);
    const photo = await checkReferencePhoto(access.userId, parsed.bytes);
    if (photo.error !== null) return fail(photo.error);
    images[v] = `data:image/jpeg;base64,${photo.jpeg.toString("base64")}`;
  }
  const submitted = await submitModelBuild(engine, { kind, prompt, images, options }, { setId, key: key ?? "new", usd });
  if (submitted.error !== null) return fail(submitted.error);
  if (!(await writeModelTicket(ticketPath, { ...ticket, handle: submitted.handle }, true))) {
    console.warn("[sets] a studio model build started but its press ticket wasn't updated:", pressId);
  }
  return { error: null, engine: engine.id, kind, rig: options.rig, key, handle: submitted.handle, usd };
}

/** fal's queue, asked for one build: the handle to ask after, or why not. */
async function submitModelBuild(
  engine: ModelEngine,
  input: Parameters<typeof modelBuildRequest>[1],
  log: Record<string, unknown>,
): Promise<{ error: string } | { error: null; handle: ModelBuildHandle }> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) return { error: STUDIO_MODEL_BUILD_FAILED };
  const request = modelBuildRequest(engine, input);
  const res = await fetchWithTimeout(
    `https://queue.fal.run/${request.endpoint}`,
    { method: "POST", headers: { authorization: `Key ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify(request.body) },
    30_000,
  );
  if (!res.ok) {
    console.warn("[sets] studio model build submit failed:", engine.id, res.status, (await res.text()).slice(0, 300));
    return { error: STUDIO_MODEL_BUILD_FAILED };
  }
  const handle = readModelHandle(request.endpoint, await res.json());
  if (!handle) return { error: STUDIO_MODEL_BUILD_FAILED };
  console.info("[sets] studio model build started", { ...log, engine: engine.id, kind: input.kind, endpoint: request.endpoint, requestId: handle.requestId });
  return { error: null, handle };
}

/** Ask after a prompt-bar build: still working, or done — kept as the thing's model or a Studio file — or failed. */
export async function pollStudioModelBuild(
  setId: string,
  input: { engine: string; kind: ModelInputKind; rig: boolean; key: string | null; handle: unknown },
): Promise<
  | { error: string }
  | { error: null; state: "working" }
  | { error: null; state: "done"; thing: KeptThingModel }
  | { error: null; state: "done"; file: string; url: string }
> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (!access.isAdmin && !STUDIO_MODEL_ENGINES_FOR_ALL) return { error: THING_MODEL_ADMINS_ONLY };
  const admin = createAdminClient();
  if (!(await setIsTheirs(admin, access.userId, setId))) return { error: SET_NOT_FOUND };
  const engine = modelEngine(input?.engine);
  const endpoint = engine && KINDS.includes(input?.kind) ? engine.endpoints[input.kind] : undefined;
  if (!engine || !endpoint || !modelHandleAllowed(endpoint, input.handle)) return { error: STUDIO_MODEL_BUILD_FAILED };
  const key = input.key === null ? null : typeof input.key === "string" && ELEMENT_KEY_RE.test(input.key) ? input.key : undefined;
  if (key === undefined) return { error: STUDIO_MODEL_BUILD_FAILED };
  const built = await readBuilt(input.handle, (result) => modelResultGlb(engine, input.rig === true, result));
  if (built.error !== null) return { error: built.error === THING_BUILD_FAILED ? STUDIO_MODEL_BUILD_FAILED : built.error };
  if (built.state === "working") return built;
  const path = key ? setModelPath(access.userId, setId as string, key, Date.now(), false) : studioModelPath(access.userId, setId as string, Date.now(), crypto.randomUUID().replace(/-/g, "").slice(0, 16));
  const { error: upError } = await admin.storage.from(THING_MODEL_BUCKET).upload(path, built.bytes, { contentType: "model/gltf-binary", upsert: false });
  if (upError) {
    console.warn("[sets] a studio-built model was not kept:", upError.message);
    return { error: THING_MODEL_SAVE_FAILED };
  }
  if (key) {
    await removeOthers(admin, access.userId, setId as string, key, path);
    return { error: null, state: "done", thing: { key, url: mediaUrl(THING_MODEL_BUCKET, path), flip: false } };
  }
  return { error: null, state: "done", file: path, url: mediaUrl(THING_MODEL_BUCKET, path) };
}
