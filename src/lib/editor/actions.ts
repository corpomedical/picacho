"use server";

// The editor's doors from the browser. Each checks who is asking (admins
// only — lib/editor/enabled.ts), then only ever writes through the service
// role: video_edits has no write policy for people, and the footage bucket
// has no policy for people at all.
//
//   startEdit   → a row in `uploading` and one signed upload token per file,
//                 for a path the server chose.
//   submitEdit  → the files are really there → `analyzing`, first tick now.
//   reviseEdit  → a finished edit + the customer's note → the director
//                 revises its own cut in the same conversation → re-render.
//   listEdits   → the person's recent edits, for the page.

import { after } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/generations/user-facing-error";
import { advanceEdit } from "./advance";
import { reviseDirector } from "./director";
import { EDITOR_NOT_OPEN, EDITOR_UNAVAILABLE, editorAllowed, isEditorEnabled } from "./enabled";
import {
  EDITOR_BUCKET,
  EDIT_COLUMNS,
  MAX_BRIEF_CHARS,
  MAX_NOTE_CHARS,
  notesFrom,
  phaseOf,
  planUploads,
  type EditRow,
  type FileOffer,
  type Note,
  type Phase,
} from "./job";
import { ASPECTS, type Aspect, type EditPlan } from "./plan";

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
  const aspect: Aspect = (ASPECTS as readonly string[]).includes(input?.aspect) ? (input.aspect as Aspect) : "16:9";
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

/** A finished edit, changed: the director revises its own cut, and it renders again. */
export async function reviseEdit(editId: string, note: string): Promise<{ error: string | null }> {
  const access = await editorAccess();
  if (access.error !== null) return { error: access.error };
  const text = typeof note === "string" ? note.trim() : "";
  if (!text) return { error: "Say what to change." };
  if (text.length > MAX_NOTE_CHARS) return { error: `Keep it under ${MAX_NOTE_CHARS} characters.` };
  if (await rateLimited(access.userId, "video-edit-revise", 60 * 60, 30)) {
    return { error: "That's a lot of changes in an hour — try again a little later." };
  }
  const row = await ownEdit(access.userId, editId);
  if (!row) return { error: "That edit isn't yours or no longer exists." };
  if (row.stage !== "done" || !row.director || row.director.phase !== "done") {
    return { error: "Wait for this edit to finish, then ask for changes." };
  }
  const { error } = await createAdminClient()
    .from("video_edits")
    .update({
      director: reviseDirector(row.director, text),
      stage: "directing",
      progress: "Cutting the edit",
      render: null,
      error: null,
      attempts: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("stage", "done");
  if (error) return { error: "Couldn't send the change. Try again." };
  kick(row.id);
  return { error: null };
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
      summary: typeof r.plan?.summary === "string" ? r.plan.summary : null,
      resultUrl: r.generation_id ? results.get(r.generation_id) ?? null : null,
    })),
  };
}

export type EditDetail = {
  id: string;
  stage: EditRow["stage"];
  phase: Phase;
  brief: string;
  aspect: Aspect;
  targetSeconds: number | null;
  clips: { name: string; duration: number | null; hasVideo: boolean }[];
  analyzed: number;
  /** The cut as the page draws it — no source paths, no model internals. */
  cut: {
    summary: string;
    look: EditPlan["look"];
    captions: EditPlan["captions"];
    shots: { clip: number; seconds: number; fit: "cover" | "contain" }[];
    texts: { text: string; kind: string }[];
    music: boolean;
  } | null;
  notes: Note[];
  resultUrl: string | null;
  error: string | null;
  /** Which cut this is: 1, then 2 after a change, and so on. */
  cutNumber: number;
};

/** One edit in full, for the bench. */
export async function getEdit(editId: string): Promise<{ error: string | null; edit: EditDetail | null }> {
  const access = await editorAccess();
  if (access.error !== null) return { error: access.error, edit: null };
  const row = await ownEdit(access.userId, editId);
  if (!row) return { error: "That edit isn't yours or no longer exists.", edit: null };
  let resultUrl: string | null = null;
  if (row.generation_id) {
    const { data } = await createAdminClient()
      .from("generations")
      .select("result_url")
      .eq("id", row.generation_id)
      .eq("user_id", access.userId)
      .maybeSingle<{ result_url: string | null }>();
    resultUrl = data?.result_url ?? null;
  }
  const notes = notesFrom(row.director);
  const plan = row.plan;
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
      cut: plan
        ? {
            summary: plan.summary,
            look: plan.look,
            captions: plan.captions,
            shots: plan.shots.map((s) => ({ clip: s.clip, seconds: Math.round((s.to - s.from) * 100) / 100, fit: s.fit ?? "cover" })),
            texts: plan.texts.map((t) => ({ text: t.text, kind: t.kind })),
            music: plan.music !== null,
          }
        : null,
      notes,
      resultUrl,
      error: row.error,
      cutNumber: Math.max(1, notes.filter((n) => n.role === "you").length + 1),
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
