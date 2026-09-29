"use server";

// The Effects door's actions (effects.ts). Same rules as the editor's own
// (actions.ts): admins only while it is tested, behind the video_editor
// switch; every write goes through the service role.
//
//   startEffects  → a video_edits row in `uploading` marked as an Effects
//                   job; the film comes as an upload (a signed token for a
//                   path the server chose) or as one of their own finished
//                   History videos, which the server copies in — nothing to
//                   upload again. A logo gets its own upload token.
//   submitEffects → the files are really there → `analyzing`, first tick now.
//   listEffects / getEffects → the page. Changes go through reviseEdit.
//   libraryVideos → their own finished videos, for the page's picker.

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/generations/user-facing-error";
import { mediaStoragePath, thumbUrl, toMediaUrl, isRenderableUrl } from "@/lib/media/url";
import { providerDownloadUrl } from "@/lib/generations/providers/provider-url";
import { EDITOR_NOT_OPEN, EDITOR_UNAVAILABLE, editorAllowed, isEditorEnabled } from "./enabled";
import { getEdit, type EditDetail } from "./actions";
import { kickEdit } from "./kick";
import { EDITOR_BUCKET, planUploads, type ClipRecord, type EditRow, type FileOffer } from "./job";
import { ENGINES, photoPreset, shotRecipe } from "../effects/catalog";
import { fxMarker, fxOf, type FxState } from "../effects/job";
import {
  EFFECTS_DOOR,
  MAX_FILM_SECONDS,
  effectsBrief,
  effectsOf,
  isEffectsRow,
  parseEffects,
  planLogo,
  type EffectsMarker,
  type EffectsSpec,
} from "./effects";

type Access = { error: string } | { error: null; userId: string };

async function effectsAccess(): Promise<Access> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: SESSION_EXPIRED_MESSAGE };
  const { data: profile } = await supabase.from("profiles").select("role, status").eq("id", data.user.id).maybeSingle();
  if (!editorAllowed(profile)) return { error: EDITOR_NOT_OPEN };
  if (!(await isEditorEnabled(supabase))) return { error: EDITOR_UNAVAILABLE };
  return { error: null, userId: data.user.id };
}

/** A History take copied into the job: generated videos are well under this. */
const MAX_TAKE_BYTES = 300 * 1024 * 1024;

type Take = { id: string; result_url: string | null; video_duration_seconds: number | null; prompt_input: string | null };

async function ownTake(userId: string, takeId: string, contentType: "video" | "image" = "video"): Promise<Take | null> {
  if (typeof takeId !== "string" || !/^[0-9a-f-]{36}$/i.test(takeId)) return null;
  const { data } = await createAdminClient()
    .from("generations")
    .select("id, result_url, video_duration_seconds, prompt_input")
    .eq("id", takeId)
    .eq("user_id", userId)
    .eq("content_type", contentType)
    .eq("status", "succeeded")
    .is("deleted_at", null)
    .maybeSingle<Take>();
  return data ?? null;
}

/** The take's file, read from our own storage when it is there, else from where it lives. */
async function takeBytes(take: Take): Promise<Uint8Array | null> {
  const stored = toMediaUrl(take.result_url);
  if (!stored || !isRenderableUrl(stored)) return null;
  const inOurs = mediaStoragePath(stored);
  if (inOurs) {
    const { data, error } = await createAdminClient().storage.from(inOurs.bucket).download(inOurs.path);
    if (error || !data) return null;
    if (data.size > MAX_TAKE_BYTES) return null;
    return new Uint8Array(await data.arrayBuffer());
  }
  const res = await fetch(providerDownloadUrl(stored), { signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (!res?.ok) return null;
  if (Number(res.headers.get("content-length") ?? 0) > MAX_TAKE_BYTES) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.byteLength > MAX_TAKE_BYTES ? null : buf;
}

export type StartedEffects =
  | { error: null; editId: string; uploads: { kind: "film" | "logo"; path: string; token: string }[] }
  | { error: string };

export async function startEffects(input: {
  effects: unknown;
  /** An upload from their device… */
  film: FileOffer | null;
  /** …or one of their own finished History videos. */
  takeId: string | null;
  logo: FileOffer | null;
}): Promise<StartedEffects> {
  const access = await effectsAccess();
  if (access.error !== null) return { error: access.error };
  if (await rateLimited(access.userId, "video-effects-start", 60 * 60, 20)) {
    return { error: "That's a lot of films in an hour — try again a little later." };
  }
  const parsed = parseEffects(input?.effects);
  if (parsed.error !== null) return { error: parsed.error };

  const editId = crypto.randomUUID();
  const admin = createAdminClient();
  const uploads: { kind: "film" | "logo"; path: string; token: string }[] = [];

  let clip: ClipRecord;
  let source: EffectsSpec["source"];
  if (input?.takeId) {
    const take = await ownTake(access.userId, input.takeId);
    if (!take) return { error: "That video isn't in your History any more." };
    if ((take.video_duration_seconds ?? 0) > MAX_FILM_SECONDS) return { error: `Effects take films up to ${MAX_FILM_SECONDS / 60} minutes.` };
    const bytes = await takeBytes(take);
    if (!bytes) return { error: "Couldn't read that video. Try another, or upload the file." };
    const name = ((take.prompt_input ?? "").trim().slice(0, 60) || "History video") + ".mp4";
    const planned = planUploads(access.userId, editId, [{ name, size: bytes.byteLength, type: "video/mp4" }]);
    if (planned.error !== null) return { error: planned.error };
    clip = planned.clips[0];
    const { error } = await admin.storage.from(EDITOR_BUCKET).upload(clip.path, bytes, { contentType: "video/mp4", upsert: true });
    if (error) return { error: "Couldn't copy that video in. Try again." };
    source = { kind: "take", takeId: take.id };
  } else {
    const offer = input?.film;
    if (!offer || !String(offer.type ?? "").toLowerCase().startsWith("video/")) return { error: "Pick a video, or upload one." };
    const planned = planUploads(access.userId, editId, [offer]);
    if (planned.error !== null) return { error: planned.error };
    clip = planned.clips[0];
    const { data, error } = await admin.storage.from(EDITOR_BUCKET).createSignedUploadUrl(clip.path);
    if (error || !data?.token) return { error: "Couldn't get a place for your video. Try again." };
    uploads.push({ kind: "film", path: clip.path, token: data.token });
    source = { kind: "upload" };
  }

  let logo: EffectsSpec["logo"] = null;
  if (input?.logo) {
    const planned = planLogo(access.userId, editId, input.logo);
    if (planned.error !== null) return { error: planned.error };
    const { data, error } = await admin.storage.from(EDITOR_BUCKET).createSignedUploadUrl(planned.path);
    if (error || !data?.token) return { error: "Couldn't get a place for your logo. Try again." };
    uploads.push({ kind: "logo", path: planned.path, token: data.token });
    logo = { path: planned.path, name: planned.name, bytes: planned.bytes };
  }

  const spec: EffectsSpec = { ...parsed.spec, logo, source };
  const marker: EffectsMarker = { door: EFFECTS_DOOR, spec };
  const { error } = await admin.from("video_edits").insert({
    id: editId,
    user_id: access.userId,
    brief: effectsBrief(parsed.spec),
    aspect: "auto",
    target_seconds: null,
    clips: [clip],
    stage: "uploading",
    director: marker,
    plan: { outputs: [], history: [] },
  });
  if (error) {
    console.error("[effects] start failed:", error.message);
    if (source.kind === "take") await admin.storage.from(EDITOR_BUCKET).remove([clip.path]);
    return { error: "Couldn't start. Try again." };
  }
  return { error: null, editId, uploads };
}

async function ownEffects(userId: string, editId: string): Promise<EditRow | null> {
  if (typeof editId !== "string" || !/^[0-9a-f-]{36}$/i.test(editId)) return null;
  const { data } = await createAdminClient()
    .from("video_edits")
    .select("id, user_id, clips, stage, director")
    .eq("id", editId)
    .eq("user_id", userId)
    .maybeSingle<EditRow>();
  return data && isEffectsRow(data) ? data : null;
}

/** Every file arrived, at the size the browser promised → start working. */
export async function submitEffects(editId: string): Promise<{ error: string | null }> {
  const access = await effectsAccess();
  if (access.error !== null) return { error: access.error };
  const row = await ownEffects(access.userId, editId);
  if (!row) return { error: "That job isn't yours or no longer exists." };
  if (row.stage !== "uploading") return { error: null };
  const spec = effectsOf(row.director);

  const admin = createAdminClient();
  const { data: listed, error: listErr } = await admin.storage.from(EDITOR_BUCKET).list(`${row.user_id}/${row.id}`, { limit: 100 });
  if (listErr) return { error: "Couldn't check your upload. Try again." };
  const sizes = new Map((listed ?? []).map((f) => [f.name, Number((f.metadata as { size?: unknown } | null)?.size) || 0]));
  const film = row.clips[0];
  const filmSize = sizes.get(film.path.split("/").pop()!);
  if (filmSize === undefined) return { error: `"${film.name}" didn't finish uploading.` };
  if (filmSize !== film.bytes) return { error: `"${film.name}" arrived incomplete — upload it again.` };
  if (spec?.logo) {
    const logoSize = sizes.get(spec.logo.path.split("/").pop()!);
    if (logoSize === undefined) return { error: `"${spec.logo.name}" didn't finish uploading.` };
    if (logoSize !== spec.logo.bytes) return { error: `"${spec.logo.name}" arrived incomplete — upload it again.` };
  }
  const { error } = await admin
    .from("video_edits")
    .update({ stage: "analyzing", progress: fxOf(row.director) ? "Reading your clip" : "Reading your film", updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("stage", "uploading");
  if (error) return { error: "Couldn't start. Try again." };
  kickEdit(row.id);
  return { error: null };
}

/** An effect from the library, as the page shows it (lib/effects/job.ts). */
export type FxSummary = { kind: "shot" | "photo"; effectId: string | null; effectName: string; words: string; tries: number; note: string | null; media: "video" | "image" };

export type EffectsSummary = {
  id: string;
  label: string;
  /** Titles-and-credits finishing; null for an effect from the library. */
  spec: EffectsSpec | null;
  fx: FxSummary | null;
  stage: EditRow["stage"];
  progress: string | null;
  error: string | null;
  filmName: string;
  createdAt: string;
  /** The first delivered video's cover, else null — the list's thumbnail. */
  cover: string | null;
  delivered: number;
};

function fxSummary(fx: FxState): FxSummary {
  const last = fx.tries[fx.tries.length - 1];
  return { kind: fx.kind, effectId: fx.effectId, effectName: fx.effectName, words: fx.words, tries: fx.tries.length, note: last?.verdict?.note ?? null, media: fx.media };
}

export async function listEffects(): Promise<{ error: string | null; jobs: EffectsSummary[] }> {
  const access = await effectsAccess();
  if (access.error !== null) return { error: access.error, jobs: [] };
  const { data, error } = await (await createClient())
    .from("video_edits")
    .select("id, stage, progress, error, clips, plan, director, created_at")
    .eq("director->>door", EFFECTS_DOOR)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return { error: "Couldn't load your effects.", jobs: [] };
  const jobs: EffectsSummary[] = [];
  for (const r of data ?? []) {
    const spec = effectsOf(r.director);
    const fx = fxOf(r.director);
    if (!spec && !fx) continue;
    const outputs = Array.isArray(r.plan?.outputs) ? (r.plan.outputs as { cover?: string | null; title?: string }[]) : [];
    const name = String(r.clips?.[0]?.name ?? "Film").replace(/\.\w+$/, "");
    jobs.push({
      id: r.id,
      label: spec ? spec.opening.title || spec.opening.presenter || name : outputs[0]?.title || fx!.plan?.title || fx!.effectName,
      spec,
      fx: fx ? fxSummary(fx) : null,
      stage: r.stage,
      progress: r.stage === "uploading" ? null : r.progress,
      error: r.error,
      filmName: String(r.clips?.[0]?.name ?? "film"),
      createdAt: r.created_at,
      cover: outputs.find((o) => o.cover)?.cover ?? null,
      delivered: outputs.length,
    });
  }
  return { error: null, jobs };
}

/** One job in full: the editor's own detail, plus its effects. */
export async function getEffects(editId: string): Promise<{ error: string | null; job: (EditDetail & { spec: EffectsSpec | null; fx: FxSummary | null }) | null }> {
  const access = await effectsAccess();
  if (access.error !== null) return { error: access.error, job: null };
  const row = await ownEffects(access.userId, editId);
  if (!row) return { error: "That job isn't yours or no longer exists.", job: null };
  const { error, edit } = await getEdit(editId);
  if (!edit) return { error, job: null };
  const fx = fxOf(row.director);
  return { error: null, job: { ...edit, spec: effectsOf(row.director), fx: fx ? fxSummary(fx) : null } };
}

const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_SHOT_BYTES = ENGINES.flux3.maxBytes!;

export type StartedEffect = { error: null; editId: string; upload: { path: string; token: string } | null } | { error: string };

/**
 * An effect from the library (lib/effects/catalog.ts): on a video, one of
 * the recipes or their own words, or both — Opus fits them to the shot; on a
 * photo, a one-tap effect. The clip or photo comes as an upload or as one of
 * their own History items, copied in on the server.
 */
export async function startEffect(input: {
  kind: "shot" | "photo";
  effectId: string | null;
  words: string;
  file: FileOffer | null;
  takeId: string | null;
  width: number | null;
  height: number | null;
}): Promise<StartedEffect> {
  const access = await effectsAccess();
  if (access.error !== null) return { error: access.error };
  if (await rateLimited(access.userId, "video-effects-start", 60 * 60, 30)) {
    return { error: "That's a lot of effects in an hour. Try again a little later." };
  }
  const kind = input?.kind === "photo" ? "photo" : "shot";
  const words = typeof input?.words === "string" ? input.words.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 1500) : "";
  let effectName: string;
  if (kind === "photo") {
    const preset = photoPreset(input?.effectId);
    if (!preset) return { error: "Pick an effect from the library." };
    effectName = preset.name;
  } else {
    const recipe = shotRecipe(input?.effectId);
    if (!recipe && !words) return { error: "Pick an effect, or describe the one you want." };
    effectName = recipe?.name ?? (words.length > 40 ? `${words.slice(0, 40)}…` : words);
  }
  const media = kind === "photo" ? "image" : "video";
  const editId = crypto.randomUUID();
  const admin = createAdminClient();
  let clip: ClipRecord;
  let source: FxState["source"];
  let upload: { path: string; token: string } | null = null;

  if (input?.takeId) {
    const take = await ownTake(access.userId, input.takeId, media);
    if (!take) return { error: `That ${media === "image" ? "picture" : "video"} isn't in your History any more.` };
    const bytes = await takeBytes(take);
    if (!bytes) return { error: "Couldn't read that one. Try another, or upload the file." };
    if (media === "video" && bytes.byteLength > MAX_SHOT_BYTES) return { error: "That clip is over 50 MB. Pick a shorter one." };
    const stored = toMediaUrl(take.result_url) ?? "";
    const ext = media === "video" ? "mp4" : /\.png(\?|$)/i.test(stored) ? "png" : /\.webp(\?|$)/i.test(stored) ? "webp" : "jpg";
    const type = media === "video" ? "video/mp4" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    clip = {
      path: `${access.userId}/${editId}/${media === "video" ? "clip-0" : "photo"}.${ext}`,
      name: ((take.prompt_input ?? "").trim().slice(0, 60) || (media === "video" ? "History video" : "History picture")) + `.${ext}`,
      bytes: bytes.byteLength,
      contentType: type,
      probe: null,
      speech: "no-speech",
      words: [],
      analyzed: true,
    };
    const { error } = await admin.storage.from(EDITOR_BUCKET).upload(clip.path, bytes, { contentType: type, upsert: true });
    if (error) return { error: "Couldn't copy that in. Try again." };
    source = { kind: "take", takeId: take.id };
  } else {
    const offer = input?.file;
    const type = String(offer?.type ?? "").toLowerCase();
    const size = Number(offer?.size);
    if (!offer || !(size > 0)) return { error: media === "video" ? "Pick a video, or upload one." : "Pick a picture, or upload one." };
    if (media === "video") {
      if (!type.startsWith("video/")) return { error: "Effects in the shot need a video." };
      if (size > MAX_SHOT_BYTES) return { error: "That clip is over 50 MB. Pick a shorter one." };
      const planned = planUploads(access.userId, editId, [offer]);
      if (planned.error !== null) return { error: planned.error };
      clip = { ...planned.clips[0], speech: "no-speech", analyzed: true };
    } else {
      const ext = PHOTO_TYPES[type];
      if (!ext) return { error: "Use a JPG, PNG or WebP picture." };
      if (size > MAX_PHOTO_BYTES) return { error: "That picture is over 20 MB." };
      clip = { path: `${access.userId}/${editId}/photo.${ext}`, name: String(offer.name ?? "photo").slice(0, 120), bytes: size, contentType: type, probe: null, speech: "no-speech", words: [], analyzed: true };
    }
    const { data, error } = await admin.storage.from(EDITOR_BUCKET).createSignedUploadUrl(clip.path);
    if (error || !data?.token) return { error: "Couldn't get a place for your file. Try again." };
    upload = { path: clip.path, token: data.token };
    source = { kind: "upload" };
  }

  const w = Number(input?.width);
  const h = Number(input?.height);
  const fx: FxState = {
    kind,
    effectId: input?.effectId ?? null,
    effectName,
    words,
    media,
    width: Number.isFinite(w) && w > 0 ? Math.round(w) : null,
    height: Number.isFinite(h) && h > 0 ? Math.round(h) : null,
    plan: null,
    tries: [],
    source,
  };
  const { error } = await admin.from("video_edits").insert({
    id: editId,
    user_id: access.userId,
    brief: `Effect — ${effectName}`,
    aspect: "auto",
    target_seconds: null,
    clips: [clip],
    stage: "uploading",
    director: fxMarker(fx),
    plan: { outputs: [], history: words ? [{ role: "you", text: words }] : [] },
  });
  if (error) {
    console.error("[effects] start failed:", error.message);
    if (source.kind === "take") await admin.storage.from(EDITOR_BUCKET).remove([clip.path]);
    return { error: "Couldn't start. Try again." };
  }
  return { error: null, editId, upload };
}

/** `prompt`: the words it was made from. `kind`: a video or a picture. */
export type LibraryVideo = { id: string; kind: "video" | "image"; title: string; prompt: string; seconds: number | null; poster: string | null; url: string };

/** Their own finished videos, newest first — the page's "From your Library". */
export async function libraryVideos(kind: "video" | "image" = "video"): Promise<{ error: string | null; videos: LibraryVideo[] }> {
  const access = await effectsAccess();
  if (access.error !== null) return { error: access.error, videos: [] };
  const { data, error } = await (await createClient())
    .from("generations")
    .select("id, content_type, prompt_input, result_url, poster_url, video_duration_seconds")
    .eq("user_id", access.userId)
    .eq("content_type", kind)
    .eq("status", "succeeded")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(24);
  if (error) return { error: "Couldn't load your videos.", videos: [] };
  return { error: null, videos: (data ?? []).flatMap((g) => toLibraryVideo(g)) };
}

export async function takeAsLibraryVideo(takeId: string): Promise<LibraryVideo | null> {
  const access = await effectsAccess();
  if (access.error !== null) return null;
  if (typeof takeId !== "string" || !/^[0-9a-f-]{36}$/i.test(takeId)) return null;
  const { data } = await (await createClient())
    .from("generations")
    .select("id, content_type, prompt_input, result_url, poster_url, video_duration_seconds")
    .eq("id", takeId)
    .eq("user_id", access.userId)
    .in("content_type", ["video", "image"])
    .eq("status", "succeeded")
    .is("deleted_at", null)
    .maybeSingle();
  return data ? (toLibraryVideo(data)[0] ?? null) : null;
}

function toLibraryVideo(g: Record<string, unknown>): LibraryVideo[] {
  const url = toMediaUrl(g.result_url as string | null);
  if (!url || !isRenderableUrl(url)) return [];
  const kind = g.content_type === "image" ? "image" : "video";
  const seconds = kind === "video" ? Number(g.video_duration_seconds) || null : null;
  if (seconds !== null && seconds > MAX_FILM_SECONDS) return [];
  return [
    {
      id: g.id as string,
      kind,
      title: ((g.prompt_input as string | null) ?? "").trim().slice(0, 90) || "Untitled video",
      prompt: ((g.prompt_input as string | null) ?? "").trim().slice(0, 3000),
      seconds,
      poster: thumbUrl(toMediaUrl((kind === "image" ? g.result_url : g.poster_url) as string | null), 320),
      url,
    },
  ];
}
