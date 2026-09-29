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
import {
  EFFECTS_DOOR,
  MAX_FILM_SECONDS,
  effectsBrief,
  effectsOf,
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

async function ownTake(userId: string, takeId: string): Promise<Take | null> {
  if (typeof takeId !== "string" || !/^[0-9a-f-]{36}$/i.test(takeId)) return null;
  const { data } = await createAdminClient()
    .from("generations")
    .select("id, result_url, video_duration_seconds, prompt_input")
    .eq("id", takeId)
    .eq("user_id", userId)
    .eq("content_type", "video")
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
  return data && effectsOf(data.director) ? data : null;
}

/** Every file arrived, at the size the browser promised → start working. */
export async function submitEffects(editId: string): Promise<{ error: string | null }> {
  const access = await effectsAccess();
  if (access.error !== null) return { error: access.error };
  const row = await ownEffects(access.userId, editId);
  if (!row) return { error: "That job isn't yours or no longer exists." };
  if (row.stage !== "uploading") return { error: null };
  const spec = effectsOf(row.director)!;

  const admin = createAdminClient();
  const { data: listed, error: listErr } = await admin.storage.from(EDITOR_BUCKET).list(`${row.user_id}/${row.id}`, { limit: 100 });
  if (listErr) return { error: "Couldn't check your upload. Try again." };
  const sizes = new Map((listed ?? []).map((f) => [f.name, Number((f.metadata as { size?: unknown } | null)?.size) || 0]));
  const film = row.clips[0];
  const filmSize = sizes.get(film.path.split("/").pop()!);
  if (filmSize === undefined) return { error: `"${film.name}" didn't finish uploading.` };
  if (filmSize !== film.bytes) return { error: `"${film.name}" arrived incomplete — upload it again.` };
  if (spec.logo) {
    const logoSize = sizes.get(spec.logo.path.split("/").pop()!);
    if (logoSize === undefined) return { error: `"${spec.logo.name}" didn't finish uploading.` };
    if (logoSize !== spec.logo.bytes) return { error: `"${spec.logo.name}" arrived incomplete — upload it again.` };
  }
  const { error } = await admin
    .from("video_edits")
    .update({ stage: "analyzing", progress: "Reading your film", updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("stage", "uploading");
  if (error) return { error: "Couldn't start. Try again." };
  kickEdit(row.id);
  return { error: null };
}

export type EffectsSummary = {
  id: string;
  label: string;
  spec: EffectsSpec;
  stage: EditRow["stage"];
  progress: string | null;
  error: string | null;
  filmName: string;
  createdAt: string;
  /** The first delivered video's cover, else null — the list's thumbnail. */
  cover: string | null;
  delivered: number;
};

export async function listEffects(): Promise<{ error: string | null; jobs: EffectsSummary[] }> {
  const access = await effectsAccess();
  if (access.error !== null) return { error: access.error, jobs: [] };
  const { data, error } = await (await createClient())
    .from("video_edits")
    .select("id, stage, progress, error, clips, plan, director, created_at")
    .eq("director->>door", EFFECTS_DOOR)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { error: "Couldn't load your films.", jobs: [] };
  const jobs: EffectsSummary[] = [];
  for (const r of data ?? []) {
    const spec = effectsOf(r.director);
    if (!spec) continue;
    const outputs = Array.isArray(r.plan?.outputs) ? (r.plan.outputs as { cover?: string | null }[]) : [];
    jobs.push({
      id: r.id,
      label: spec.opening.title || spec.opening.presenter || String(r.clips?.[0]?.name ?? "Film").replace(/\.\w+$/, ""),
      spec,
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
export async function getEffects(editId: string): Promise<{ error: string | null; job: (EditDetail & { spec: EffectsSpec }) | null }> {
  const access = await effectsAccess();
  if (access.error !== null) return { error: access.error, job: null };
  const row = await ownEffects(access.userId, editId);
  if (!row) return { error: "That job isn't yours or no longer exists.", job: null };
  const { error, edit } = await getEdit(editId);
  if (!edit) return { error, job: null };
  return { error: null, job: { ...edit, spec: effectsOf(row.director)! } };
}

/** `prompt`: the words it was made from, which the vertical version can put under it. */
export type LibraryVideo = { id: string; title: string; prompt: string; seconds: number | null; poster: string | null; url: string };

/** Their own finished videos, newest first — the page's "From your Library". */
export async function libraryVideos(): Promise<{ error: string | null; videos: LibraryVideo[] }> {
  const access = await effectsAccess();
  if (access.error !== null) return { error: access.error, videos: [] };
  const { data, error } = await (await createClient())
    .from("generations")
    .select("id, prompt_input, result_url, poster_url, video_duration_seconds")
    .eq("user_id", access.userId)
    .eq("content_type", "video")
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
    .select("id, prompt_input, result_url, poster_url, video_duration_seconds")
    .eq("id", takeId)
    .eq("user_id", access.userId)
    .eq("content_type", "video")
    .eq("status", "succeeded")
    .is("deleted_at", null)
    .maybeSingle();
  return data ? (toLibraryVideo(data)[0] ?? null) : null;
}

function toLibraryVideo(g: Record<string, unknown>): LibraryVideo[] {
  const url = toMediaUrl(g.result_url as string | null);
  if (!url || !isRenderableUrl(url)) return [];
  const seconds = Number(g.video_duration_seconds) || null;
  if (seconds !== null && seconds > MAX_FILM_SECONDS) return [];
  return [
    {
      id: g.id as string,
      title: ((g.prompt_input as string | null) ?? "").trim().slice(0, 90) || "Untitled video",
      prompt: ((g.prompt_input as string | null) ?? "").trim().slice(0, 3000),
      seconds,
      poster: thumbUrl(toMediaUrl(g.poster_url as string | null), 320),
      url,
    },
  ];
}
