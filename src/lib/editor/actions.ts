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
import { advanceEdit } from "./advance";
import { sendChange, type Activity } from "./agent";
import type { ChangeExtras } from "./agent-prompt";
import type { ProbeResult } from "./analyze";
import { probeClip } from "./work";
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
  type EditRow,
  type FileOffer,
  type Note,
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

export type EditOutput = { title: string; summary: string; aspect: string; seconds: number; turn: number; url: string | null };

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
        .map((o) => ({ title: o.title, summary: o.summary, aspect: o.aspect, seconds: o.seconds, turn: o.turn, url: urls.get(o.generationId) ?? null })),
      notes: row.plan?.history ?? [],
      activity:
        row.stage === "directing" && row.render
          ? { text: row.render.latest, code: (row.render.activity as Activity | null | undefined) ?? null }
          : null,
      error: row.error,
      cutNumber: row.render?.turn ?? 1,
    },
  };
}

/** The first step right away, after the reply is sent; the minute cron carries on from there. */
function kick(editId: string): void {
  after(async () => {
    try {
      await advanceEdit(editId, { admin: createAdminClient(), heavyStartBudgetMs: 5_000, tickBudgetMs: 20_000 });
    } catch (err) {
      console.error(`[editor] first tick for ${editId} failed:`, err instanceof Error ? err.message : err);
    }
  });
}
