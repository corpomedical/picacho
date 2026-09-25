"use server";

// The editor's doors from the browser. Each checks who is asking (admins
// only — lib/editor/enabled.ts), then only ever writes through the service
// role: video_edits has no write policy for people, and the footage bucket
// has no policy for people at all.
//
//   startEdit   → a row in `uploading` and one signed upload token per file,
//                 for a path the server chose.
//   submitEdit  → the files are really there → `analyzing`, first tick now.
//   prepareSong → a delivered edit + a song the customer wants it cut to →
//                 a signed upload token for the edit's next clip slot.
//   reviseEdit  → a delivered edit + the customer's note (and that song)
//                 → the note goes into the SAME editing session (the agent
//                 changes the project it built) → new versions land in History.
//   getEdit / listEdits → the bench.

import { after } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/generations/user-facing-error";
import { advanceEdit, deliverOne, derivedUuid } from "./advance";
import { sendChange, type Activity } from "./agent";
import type { ChangeExtras } from "./agent-prompt";
import type { ProbeResult } from "./analyze";
import { probeClip } from "./work";
import { PROJECT_DRAFT, projectToken } from "./project";
import { bundlePlan, type ExportRecord } from "./export";
import { aceBody, composeCostUsd, elevenBody, ENGINES, MAX_TAKES, promptText, sectionsFromCuts, type ComposerEngine, type Section } from "./composer";
import { buildZip, type ZipEntry } from "./zip";
import { HEYGEN_MAX_BUNDLE_BYTES, heygenConfigured, readRender, startRender, uploadBundle } from "./heygen";
import { EDITOR_NOT_OPEN, EDITOR_UNAVAILABLE, editorAllowed, isEditorEnabled } from "./enabled";
import {
  ASPECT_HINTS,
  EDITOR_BUCKET,
  EDIT_COLUMNS,
  FOOTAGE_URL_SECONDS,
  MAX_BRIEF_CHARS,
  MAX_NOTE_CHARS,
  phaseOf,
  planSong,
  planUploads,
  songProblem,
  type AspectHint,
  type ComposerTake,
  type EditRow,
  type FileOffer,
  type Note,
  type Output,
  type Phase,
} from "./job";

type Access = { error: string } | { error: null; userId: string };

async function editorAccess(): Promise<Access> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: SESSION_EXPIRED_MESSAGE };
  const { data: profile } = await supabase.from("profiles").select("role, status").eq("id", data.user.id).maybeSingle();
  if (!editorAllowed(profile)) return { error: EDITOR_NOT_OPEN };
  if (!(await isEditorEnabled(supabase))) return { error: EDITOR_UNAVAILABLE };
  return { error: null, userId: data.user.id };
}

export type StartedEdit = { error: null; editId: string; uploads: { path: string; token: string }[] } | { error: string };

export async function startEdit(input: {
  brief: string;
  aspect: string;
  targetSeconds: number | null;
  files: FileOffer[];
}): Promise<StartedEdit> {
  const access = await editorAccess();
  if (access.error !== null) return { error: access.error };
  if (await rateLimited(access.userId, "video-edit-start", 60 * 60, 20)) {
    return { error: "That's a lot of edits in an hour — try again a little later." };
  }
  const brief = typeof input?.brief === "string" ? input.brief.trim() : "";
  if (brief.length > MAX_BRIEF_CHARS) return { error: `Keep the brief under ${MAX_BRIEF_CHARS} characters.` };
  const aspect: AspectHint = (ASPECT_HINTS as readonly string[]).includes(input?.aspect) ? (input.aspect as AspectHint) : "auto";
  const rawTarget = Number(input?.targetSeconds);
  const targetSeconds = Number.isFinite(rawTarget) && rawTarget > 0 ? Math.min(180, Math.max(5, Math.round(rawTarget))) : null;

  const editId = crypto.randomUUID();
  const planned = planUploads(access.userId, editId, input?.files);
  if (planned.error !== null) return { error: planned.error };

  const admin = createAdminClient();
  const uploads: { path: string; token: string }[] = [];
  for (const clip of planned.clips) {
    const { data, error } = await admin.storage.from(EDITOR_BUCKET).createSignedUploadUrl(clip.path);
    if (error || !data?.token) return { error: "Couldn't get a place for your footage. Try again." };
    uploads.push({ path: clip.path, token: data.token });
  }
  const { error } = await admin.from("video_edits").insert({
    id: editId,
    user_id: access.userId,
    brief,
    aspect,
    target_seconds: targetSeconds,
    clips: planned.clips,
    stage: "uploading",
    plan: { outputs: [], history: brief ? [{ role: "you", text: brief }] : [] },
  });
  if (error) {
    console.error("[editor] start failed:", error.message);
    return { error: "Couldn't start the edit. Try again." };
  }
  return { error: null, editId, uploads };
}

async function ownEdit(userId: string, editId: string): Promise<EditRow | null> {
  if (typeof editId !== "string" || !/^[0-9a-f-]{36}$/i.test(editId)) return null;
  const { data } = await createAdminClient()
    .from("video_edits")
    .select(EDIT_COLUMNS)
    .eq("id", editId)
    .eq("user_id", userId)
    .maybeSingle<EditRow>();
  return data ?? null;
}

/** Every file arrived, at the size the browser promised → start working. */
export async function submitEdit(editId: string): Promise<{ error: string | null }> {
  const access = await editorAccess();
  if (access.error !== null) return { error: access.error };
  const row = await ownEdit(access.userId, editId);
  if (!row) return { error: "That edit isn't yours or no longer exists." };
  if (row.stage !== "uploading") return { error: null };

  const admin = createAdminClient();
  const { data: listed, error: listErr } = await admin.storage.from(EDITOR_BUCKET).list(`${row.user_id}/${row.id}`, { limit: 100 });
  if (listErr) return { error: "Couldn't check your upload. Try again." };
  const sizes = new Map((listed ?? []).map((f) => [f.name, Number((f.metadata as { size?: unknown } | null)?.size) || 0]));
  for (const clip of row.clips) {
    const name = clip.path.split("/").pop()!;
    const size = sizes.get(name);
    if (size === undefined) return { error: `"${clip.name}" didn't finish uploading.` };
    if (size !== clip.bytes) return { error: `"${clip.name}" arrived incomplete — upload it again.` };
  }
  const { error } = await admin
    .from("video_edits")
    .update({ stage: "analyzing", progress: "Reading your footage", updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("stage", "uploading");
  if (error) return { error: "Couldn't start the edit. Try again." };
  kick(row.id);
  return { error: null };
}

/** A song to send with a change → where the browser may upload it (the edit's next clip slot). */
export async function prepareSong(editId: string, file: FileOffer): Promise<{ error: null; path: string; token: string } | { error: string }> {
  const access = await editorAccess();
  if (access.error !== null) return { error: access.error };
  if (await rateLimited(access.userId, "video-edit-song", 60 * 60, 20)) {
    return { error: "That's a lot of songs in an hour — try again a little later." };
  }
  const row = await ownEdit(access.userId, editId);
  if (!row) return { error: "That edit isn't yours or no longer exists." };
  if (row.stage !== "done" || !row.render) return { error: "Wait for this edit to finish, then send a song." };
  const planned = planSong(row.user_id, row.id, row.clips, file);
  if (planned.error !== null) return { error: planned.error };
  // upsert: a change that failed to send leaves its song in the slot; the retry overwrites it.
  const { data, error } = await createAdminClient().storage.from(EDITOR_BUCKET).createSignedUploadUrl(planned.clip.path, { upsert: true });
  if (error || !data?.token) return { error: "Couldn't get a place for your song. Try again." };
  return { error: null, path: planned.clip.path, token: data.token };
}

/**
 * A delivered edit, changed: the note (and a song, when one was sent — the
 * browser uploaded it through prepareSong first) goes into the same editing
 * session.
 */
export async function reviseEdit(editId: string, note: string, song: FileOffer | null = null): Promise<{ error: string | null }> {
  const access = await editorAccess();
  if (access.error !== null) return { error: access.error };
  const text = typeof note === "string" ? note.trim() : "";
  if (!text && !song) return { error: "Say what to change." };
  if (text.length > MAX_NOTE_CHARS) return { error: `Keep it under ${MAX_NOTE_CHARS} characters.` };
  if (await rateLimited(access.userId, "video-edit-revise", 60 * 60, 30)) {
    return { error: "That's a lot of changes in an hour — try again a little later." };
  }
  const row = await ownEdit(access.userId, editId);
  if (!row) return { error: "That edit isn't yours or no longer exists." };
  if (row.stage !== "done" || !row.render) return { error: "Wait for this edit to finish, then ask for changes." };

  const admin = createAdminClient();
  let clips = row.clips;
  const extras: ChangeExtras = {};
  if (song) {
    const planned = planSong(row.user_id, row.id, row.clips, song);
    if (planned.error !== null) return { error: planned.error };
    const clip = planned.clip;
    const { data: listed, error: listErr } = await admin.storage.from(EDITOR_BUCKET).list(`${row.user_id}/${row.id}`, { limit: 100 });
    if (listErr) return { error: "Couldn't check your song. Try again." };
    const slot = clip.path.split("/").pop();
    const arrived = (listed ?? []).find((f) => f.name === slot);
    if (!arrived) return { error: `"${clip.name}" didn't finish uploading.` };
    if (Number((arrived.metadata as { size?: unknown } | null)?.size) !== clip.bytes) return { error: `"${clip.name}" arrived incomplete — send it again.` };
    let url: string;
    let probe: ProbeResult;
    try {
      url = await signedFootageUrl(clip.path);
      probe = await probeClip(url);
    } catch (err) {
      console.error(`[editor] song for ${row.id} unreadable:`, err instanceof Error ? err.message : err);
      return { error: `"${clip.name}" couldn't be read. Try an MP3.` };
    }
    const problem = songProblem(clip.name, probe);
    if (problem) return { error: problem };
    clips = [...row.clips, { ...clip, probe }];
    extras.song = { index: row.clips.length, name: clip.name, seconds: probe.duration, url };
  }
  try {
    extras.clips = await Promise.all(row.clips.map(async (c, index) => ({ index, name: c.name, url: await signedFootageUrl(c.path) })));
  } catch (err) {
    console.error(`[editor] footage links for ${row.id} failed:`, err instanceof Error ? err.message : err);
    return { error: "Couldn't send the change. Try again." };
  }

  const now = Date.now();
  const said: Note = song ? { role: "you", text, song: clips[clips.length - 1].name } : { role: "you", text };
  // Claim the turn first, so two presses cannot send two notes.
  const { data: claimed, error } = await admin
    .from("video_edits")
    .update({
      stage: "directing",
      progress: "Making your change",
      clips,
      render: { ...row.render, turn: row.render.turn + 1, turnStartedAt: now },
      plan: { outputs: row.plan?.outputs ?? [], history: [...(row.plan?.history ?? []), said] },
      error: null,
      attempts: 0,
      updated_at: new Date(now).toISOString(),
    })
    .eq("id", row.id)
    .eq("stage", "done")
    .select("id");
  if (error || !claimed?.length) return { error: "Couldn't send the change. Try again." };
  try {
    await sendChange(row.render.sessionId, text, extras);
  } catch (err) {
    console.error(`[editor] change for ${row.id} not sent:`, err instanceof Error ? err.message : err);
    await admin
      .from("video_edits")
      .update({ stage: "done", progress: null, clips: row.clips, render: row.render, plan: row.plan, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    return { error: "The editor didn't take the change. Try again in a moment." };
  }
  kick(row.id);
  return { error: null };
}

async function signedFootageUrl(path: string): Promise<string> {
  const { data, error } = await createAdminClient().storage.from(EDITOR_BUCKET).createSignedUrl(path, FOOTAGE_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(`couldn't sign ${path}: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

export type EditSummary = Pick<
  EditRow,
  "id" | "brief" | "aspect" | "target_seconds" | "stage" | "progress" | "error" | "generation_id" | "created_at" | "updated_at"
> & { clipNames: string[]; summary: string | null; resultUrl: string | null };

export async function listEdits(): Promise<{ error: string | null; edits: EditSummary[] }> {
  const access = await editorAccess();
  if (access.error !== null) return { error: access.error, edits: [] };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("video_edits")
    .select("id, brief, aspect, target_seconds, stage, progress, error, generation_id, created_at, updated_at, clips, plan")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { error: "Couldn't load your edits.", edits: [] };
  const ids = (data ?? []).map((r) => r.generation_id).filter((v): v is string => typeof v === "string");
  const results = new Map<string, string>();
  if (ids.length) {
    const { data: gens } = await supabase.from("generations").select("id, result_url").in("id", ids);
    for (const g of gens ?? []) if (typeof g.result_url === "string") results.set(g.id, g.result_url);
  }
  return {
    error: null,
    edits: (data ?? []).map((r) => ({
      id: r.id,
      brief: r.brief,
      aspect: r.aspect,
      target_seconds: r.target_seconds,
      stage: r.stage,
      progress: r.progress,
      error: r.error,
      generation_id: r.generation_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      clipNames: Array.isArray(r.clips) ? r.clips.map((c: { name?: unknown }) => String(c?.name ?? "clip")) : [],
      summary: Array.isArray(r.plan?.outputs) && r.plan.outputs[0] ? String(r.plan.outputs[0].summary ?? "") || null : null,
      resultUrl: r.generation_id ? results.get(r.generation_id) ?? null : null,
    })),
  };
}

/** `editable`: Opus handed over the project, so it opens on the timeline (openProject). */
export type EditOutput = { title: string; summary: string; aspect: string; seconds: number; turn: number; url: string | null; generationId: string; editable: boolean };

export type EditDetail = {
  id: string;
  stage: EditRow["stage"];
  phase: Phase;
  brief: string;
  aspect: AspectHint;
  targetSeconds: number | null;
  clips: { name: string; duration: number | null; hasVideo: boolean }[];
  analyzed: number;
  /** Every video delivered, newest turn first. */
  outputs: EditOutput[];
  notes: Note[];
  /** While it works: its own latest words, else what it is doing (a code the page translates). */
  activity: { text: string | null; code: Activity | null } | null;
  error: string | null;
  /** 1 for the first delivery, then +1 per change. */
  cutNumber: number;
  /** Timeline edits sent to render (Export), newest last. */
  exports: { id: string; source: string; status: "rendering" | "done" | "failed"; error: string | null; resultId: string | null }[];
  /** Music the composer wrote, newest last. */
  takes: { id: string; source: string; engine: "eleven" | "ace"; file: string; seconds: number }[];
};

/** One edit in full, for the bench. */
export async function getEdit(editId: string): Promise<{ error: string | null; edit: EditDetail | null }> {
  const access = await editorAccess();
  if (access.error !== null) return { error: access.error, edit: null };
  const row = await ownEdit(access.userId, editId);
  if (!row) return { error: "That edit isn't yours or no longer exists.", edit: null };
  const delivered = row.plan?.outputs ?? [];
  const urls = new Map<string, string>();
  if (delivered.length) {
    const { data } = await createAdminClient()
      .from("generations")
      .select("id, result_url")
      .in("id", delivered.map((o) => o.generationId))
      .eq("user_id", access.userId);
    for (const g of data ?? []) if (typeof g.result_url === "string") urls.set(g.id, g.result_url);
  }
  return {
    error: null,
    edit: {
      id: row.id,
      stage: row.stage,
      phase: phaseOf(row),
      brief: row.brief,
      aspect: row.aspect,
      targetSeconds: row.target_seconds,
      clips: row.clips.map((c) => ({ name: c.name, duration: c.probe?.duration ?? null, hasVideo: c.probe?.hasVideo ?? c.contentType.startsWith("video/") })),
      analyzed: row.clips.filter((c) => c.analyzed).length,
      outputs: [...delivered]
        .sort((a, b) => b.turn - a.turn)
        .map((o) => ({
          title: o.title,
          summary: o.summary,
          aspect: o.aspect,
          seconds: o.seconds,
          turn: o.turn,
          url: urls.get(o.generationId) ?? null,
          generationId: o.generationId,
          editable: Boolean(o.project),
        })),
      notes: row.plan?.history ?? [],
      activity:
        row.stage === "directing" && row.render
          ? { text: row.render.latest, code: (row.render.activity as Activity | null | undefined) ?? null }
          : null,
      error: row.error,
      cutNumber: row.render?.turn ?? 1,
      exports: (row.plan?.exports ?? []).map((x) => ({ id: x.id, source: x.source, status: x.status, error: x.error ?? null, resultId: x.resultId ?? null })),
      takes: (row.plan?.takes ?? []).map((x) => ({ id: x.id, source: x.source, engine: x.engine, file: x.file, seconds: x.seconds })),
    },
  };
}

/** The first step right away, after the reply is sent; the minute cron carries on from there. */
/** The largest composition the editor saves: the page is text; its media are files beside it. */
const MAX_PROJECT_HTML = 3 * 1024 * 1024;

export type OpenedProject =
  | { error: null; html: string; base: string; aspect: string; seconds: number; title: string; draft: boolean }
  | { error: string };

/**
 * A delivered video's editable project, for the timeline: the working copy
 * (else the delivered page) as text for the HyperFrames SDK, and the base the
 * sealed preview frame loads it from (project.ts, project-serve.ts).
 */
export async function openProject(editId: string, generationId: string): Promise<OpenedProject> {
  const access = await editorAccess();
  if (access.error !== null) return { error: access.error };
  const row = await ownEdit(access.userId, editId);
  const output = row?.plan?.outputs.find((o) => o.generationId === generationId);
  if (!row || !output) return { error: "That video isn't yours or no longer exists." };
  if (!output.project) return { error: "This video was made before the timeline existed. Ask for a change and the new version opens here." };
  const admin = createAdminClient();
  let html: string | null = null;
  let draft = false;
  for (const [name, isDraft] of [[PROJECT_DRAFT, true], [output.project.entry, false]] as const) {
    const { data } = await admin.storage.from(EDITOR_BUCKET).download(`${output.project.dir}/${name}`);
    if (data) {
      html = await data.text();
      draft = isDraft;
      break;
    }
  }
  if (html === null) return { error: "Couldn't open this video's project. Try again." };
  return {
    error: null,
    html,
    base: `/api/edit-project/${projectToken(row.id, generationId)}/`,
    aspect: output.aspect,
    seconds: output.seconds,
    title: output.title,
    draft,
  };
}

/** The timeline's working copy, kept beside the delivered page; the preview plays it with ?draft=1. */
export async function saveProjectDraft(editId: string, generationId: string, html: string): Promise<{ error: string | null }> {
  const access = await editorAccess();
  if (access.error !== null) return { error: access.error };
  if (typeof html !== "string" || html.length > MAX_PROJECT_HTML || !html.includes("data-composition-id")) {
    return { error: "That doesn't look like this video's project." };
  }
  if (await rateLimited(access.userId, "video-edit-draft", 60 * 60, 600)) {
    return { error: "That's a lot of saves in an hour — give it a minute." };
  }
  const row = await ownEdit(access.userId, editId);
  const output = row?.plan?.outputs.find((o) => o.generationId === generationId);
  if (!row || !output?.project) return { error: "That video isn't yours or no longer exists." };
  const { error } = await createAdminClient()
    .storage.from(EDITOR_BUCKET)
    .upload(`${output.project.dir}/${PROJECT_DRAFT}`, new TextEncoder().encode(html), { contentType: "text/html", upsert: true });
  if (error) return { error: "Couldn't save. Try again." };
  return { error: null };
}

/**
 * Export: the timeline's working copy, rendered (export.ts). Bundles the page,
 * the project's files and the clips it plays, sends them to HeyGen's
 * renderer, and records the render on the edit; checkExport collects it.
 */
export async function exportProject(editId: string, generationId: string): Promise<{ error: null; exportId: string } | { error: string }> {
  const access = await editorAccess();
  if (access.error !== null) return { error: access.error };
  if (!heygenConfigured()) return { error: "Export isn't switched on yet." };
  if (await rateLimited(access.userId, "video-edit-export", 60 * 60, 20)) {
    return { error: "That's a lot of exports in an hour — try again a little later." };
  }
  const row = await ownEdit(access.userId, editId);
  const output = row?.plan?.outputs.find((o) => o.generationId === generationId);
  if (!row || !output?.project) return { error: "That video isn't yours or no longer exists." };
  if ((row.plan?.exports ?? []).some((x) => x.source === generationId && x.status === "rendering")) {
    return { error: "This edit is already rendering." };
  }
  const admin = createAdminClient();
  const bucket = admin.storage.from(EDITOR_BUCKET);
  const read = async (path: string) => {
    const { data } = await bucket.download(path);
    return data ? new Uint8Array(await data.arrayBuffer()) : null;
  };
  const page = (await read(`${output.project.dir}/${PROJECT_DRAFT}`)) ?? (await read(`${output.project.dir}/${output.project.entry}`));
  if (!page) return { error: "Couldn't open this video's project. Try again." };
  const html = new TextDecoder().decode(page);
  const plan = bundlePlan(html, output.project, row.clips);
  const entries: ZipEntry[] = [{ name: "index.html", data: page }];
  for (const p of plan.project) {
    const data = await read(`${output.project.dir}/${p}`);
    if (data) entries.push({ name: p, data });
  }
  for (const f of plan.footage) {
    const data = await read(f.path);
    if (!data) return { error: "One of your clips couldn't be read. Try again." };
    entries.push({ name: f.name, data });
  }
  const exportId = crypto.randomUUID();
  let renderId: string;
  try {
    const zip = buildZip(entries);
    if (zip.byteLength > HEYGEN_MAX_BUNDLE_BYTES) return { error: "This edit is too large to render in one go (over 200 MB)." };
    const assetId = await uploadBundle(zip, { filename: `${exportId}.zip`, idempotencyKey: exportId });
    const aspect = (["16:9", "9:16", "1:1"] as const).find((a) => a === output.aspect) ?? "16:9";
    renderId = await startRender(assetId, { aspect, fps: 30, quality: "high", title: output.title, idempotencyKey: `render-${exportId}` });
  } catch (err) {
    console.error(`[editor] export for ${row.id} failed:`, err instanceof Error ? err.message : err);
    return { error: "The renderer didn't take this edit. Try again in a moment." };
  }
  const record: ExportRecord = { id: exportId, source: generationId, renderId, status: "rendering", startedAt: Date.now() };
  const { error } = await admin
    .from("video_edits")
    .update({ plan: { ...row.plan!, exports: [...(row.plan?.exports ?? []), record] }, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) return { error: "Couldn't keep track of the render. Try again." };
  return { error: null, exportId };
}

/** An export's render, read back; when it is finished, the video goes into History (once) and onto the bench. */
export async function checkExport(editId: string, exportId: string): Promise<{ error: string | null; status: ExportRecord["status"] | null; generationId?: string | null }> {
  const access = await editorAccess();
  if (access.error !== null) return { error: access.error, status: null };
  const row = await ownEdit(access.userId, editId);
  const record = row?.plan?.exports?.find((x) => x.id === exportId);
  if (!row || !record) return { error: "That export isn't yours or no longer exists.", status: null };
  if (record.status !== "rendering") return { error: null, status: record.status, generationId: record.resultId ?? null };
  let state;
  try {
    state = await readRender(record.renderId);
  } catch (err) {
    console.error(`[editor] export ${exportId} unreadable:`, err instanceof Error ? err.message : err);
    return { error: null, status: "rendering" };
  }
  if (state.status === "queued" || state.status === "rendering") return { error: null, status: "rendering" };
  const admin = createAdminClient();
  const source = row.plan!.outputs.find((o) => o.generationId === record.source);
  const settle = async (patch: Partial<ExportRecord>, output?: Output) => {
    const exports = (row.plan?.exports ?? []).map((x) => (x.id === exportId ? { ...x, ...patch } : x));
    const outputs = output && !row.plan!.outputs.some((o) => o.generationId === output.generationId) ? [...row.plan!.outputs, output] : row.plan!.outputs;
    await admin
      .from("video_edits")
      .update({ plan: { ...row.plan!, outputs, exports }, updated_at: new Date().toISOString() })
      .eq("id", row.id);
  };
  if (state.status === "failed" || !state.videoUrl || !source) {
    await settle({ status: "failed", error: state.failure ?? "The render failed." });
    return { error: null, status: "failed" };
  }
  const res = await fetch(state.videoUrl, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) return { error: null, status: "rendering" };
  const bytes = new Uint8Array(await res.arrayBuffer());
  const generationId = derivedUuid(`video-edit-export:${exportId}`);
  const seconds = state.duration ?? source.seconds;
  const title = `${source.title || "Your edit"} · your edit`;
  await deliverOne(admin, row, generationId, { title, summary: "", aspect: source.aspect, seconds, bytes });
  await settle(
    { status: "done", resultId: generationId },
    { title, summary: "Your edit on the timeline, rendered.", aspect: source.aspect, seconds, generationId, turn: source.turn, project: source.project ?? null },
  );
  return { error: null, status: "done", generationId };
}

/**
 * The track composer (composer.ts): up to three takes of music timed to the
 * cut, from ElevenLabs Music v2.5 or ACE-Step on fal. Each take is kept in the
 * video's project (so the preview plays it and Export carries it) and costs
 * what fal lists, recorded on the edit.
 */
export async function composeTrack(
  editId: string,
  generationId: string,
  input: { engine: ComposerEngine; prompt: string; styles: string[]; instrumental: boolean; seconds: number; sections: Section[]; takes: number },
): Promise<{ error: null; takes: EditDetail["takes"] } | { error: string }> {
  const access = await editorAccess();
  if (access.error !== null) return { error: access.error };
  if (!process.env.FAL_KEY) return { error: "The composer isn't switched on yet." };
  if (await rateLimited(access.userId, "video-edit-compose", 60 * 60, 30)) {
    return { error: "That's a lot of music in an hour — try again a little later." };
  }
  const row = await ownEdit(access.userId, editId);
  const output = row?.plan?.outputs.find((o) => o.generationId === generationId);
  if (!row || !output?.project) return { error: "That video isn't yours or no longer exists." };
  const engine: ComposerEngine = input?.engine === "ace" ? "ace" : "eleven";
  const prompt = typeof input?.prompt === "string" ? input.prompt.trim().slice(0, 800) : "";
  const styles = (Array.isArray(input?.styles) ? input.styles : []).filter((s): s is string => typeof s === "string").map((s) => s.slice(0, 40)).slice(0, 12);
  if (!prompt && styles.length === 0) return { error: "Describe the music, or pick a mood." };
  const seconds = Math.min(ENGINES[engine].maxSeconds, Math.max(5, Number(input?.seconds) || output.seconds || 30));
  const sections = sectionsFromCuts(seconds, (Array.isArray(input?.sections) ? input.sections : []).map((s) => Number(s?.start)).filter(Number.isFinite));
  const takes = Math.max(1, Math.min(MAX_TAKES, Math.round(Number(input?.takes) || MAX_TAKES)));
  const req = { engine, prompt, styles, instrumental: input?.instrumental !== false, seconds, sections, takes };
  const admin = createAdminClient();
  const made = await Promise.allSettled(
    Array.from({ length: takes }, async () => {
      const seed = Math.floor(Math.random() * 2_000_000_000);
      const res = await fetch(`https://fal.run/${ENGINES[engine].endpoint}`, {
        method: "POST",
        headers: { authorization: `Key ${process.env.FAL_KEY}`, "content-type": "application/json" },
        body: JSON.stringify(engine === "eleven" ? elevenBody(req, seed) : aceBody(req, seed)),
        signal: AbortSignal.timeout(240_000),
      });
      if (!res.ok) throw new Error(`${engine} ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const url = ((await res.json()) as { audio?: { url?: unknown } }).audio?.url;
      if (typeof url !== "string" || !/^https:\/\/[a-z0-9.-]*fal\.media\//i.test(url)) throw new Error(`${engine}: no audio`);
      const audio = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!audio.ok) throw new Error(`${engine}: download ${audio.status}`);
      const bytes = new Uint8Array(await audio.arrayBuffer());
      const id = crypto.randomUUID();
      const type = audio.headers.get("content-type") ?? "";
      const ext = /mpeg|mp3/i.test(type) || /\.mp3$/i.test(url) ? "mp3" : /wav/i.test(type) || /\.wav$/i.test(url) ? "wav" : engine === "eleven" ? "mp3" : "wav";
      const file = `assets/music/take-${id.slice(0, 8)}.${ext}`;
      const { error } = await admin.storage
        .from(EDITOR_BUCKET)
        .upload(`${output.project!.dir}/${file}`, bytes, { contentType: ext === "mp3" ? "audio/mpeg" : "audio/wav", upsert: true });
      if (error) throw new Error(`keep take: ${error.message}`);
      const take: ComposerTake = { id, source: generationId, engine, file, seconds, prompt: promptText(req).slice(0, 400), costUsd: composeCostUsd(engine, seconds, 1), createdAt: Date.now() };
      return { take, bytes: bytes.byteLength };
    }),
  );
  const done = made.flatMap((m) => (m.status === "fulfilled" ? [m.value] : []));
  for (const m of made) if (m.status === "rejected") console.error(`[editor] compose for ${row.id} failed:`, m.reason instanceof Error ? m.reason.message : m.reason);
  if (done.length === 0) return { error: "The composer couldn't make music this time. Try again." };
  // The takes join the project (Export bundles them) and the edit's record; fal charges each one it made.
  const outputs = row.plan!.outputs.map((o) =>
    o.generationId === generationId && o.project
      ? { ...o, project: { ...o.project, files: [...o.project.files, ...done.map((d) => ({ path: d.take.file, bytes: d.bytes }))] } }
      : o,
  );
  const spent = done.reduce((n, d) => n + d.take.costUsd, 0);
  await admin
    .from("video_edits")
    .update({
      plan: { ...row.plan!, outputs, takes: [...(row.plan?.takes ?? []), ...done.map((d) => d.take)] },
      cost_usd: Math.round((Number(row.cost_usd) + spent) * 10000) / 10000,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  return { error: null, takes: done.map((d) => ({ id: d.take.id, source: d.take.source, engine: d.take.engine, file: d.take.file, seconds: d.take.seconds })) };
}

function kick(editId: string): void {
  after(async () => {
    try {
      await advanceEdit(editId, { admin: createAdminClient(), heavyStartBudgetMs: 5_000, tickBudgetMs: 20_000 });
    } catch (err) {
      console.error(`[editor] first tick for ${editId} failed:`, err instanceof Error ? err.message : err);
    }
  });
}
