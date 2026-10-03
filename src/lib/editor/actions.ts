"use server";

// The editor's doors from the browser. Each checks who is asking (admins,
// and paid plans once `video_editor_paid_plans` is on — enabled.ts
// editorGate), then only ever writes through the service role: video_edits
// has no write policy for people, and the footage bucket has no policy for
// people at all.
//
// Credits (operator, 2026-10-03: "Pay what it uses"): "Cut it" and a change
// HOLD their most (pricing.ts) before Opus starts, settled when the turn
// ends (advance.ts); music and Export are fixed prices, given back when
// they fail (charge.ts).
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

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { checkGenerationAllowance, consumeBonusCredits, consumePurchasedCredits } from "@/lib/generations/core";
import { offered } from "@/lib/models/controls";
import { rateLimited } from "@/lib/rate-limit";
import { alertEditorOutOfCredit } from "@/lib/push/admin-alerts";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/generations/user-facing-error";
import { deliverOne, derivedUuid, OUT_OF_CREDIT_ERROR } from "./advance";
import { kickEdit } from "./kick";
import { isEffectsRow } from "./effects";
import { isBillingError, raiseBudget, sendChange, type Activity } from "./agent";
import {
  DAILY_FAILED_LIMIT,
  EDITOR_EXPORT_MODEL_ID,
  EDITOR_MODEL_ID,
  EDITOR_MUSIC_MODEL_ID,
  failedToday,
  placeHold,
  settleHold,
  type Hold,
  type HoldDeps,
} from "./charge";
import { changeHold, composeCredits, cutHold, EXPORT_USD_PER_MINUTE, exportCredits } from "./pricing";
import type { ChangeExtras } from "./agent-prompt";
import type { ProbeResult } from "./analyze";
import { probeClip } from "./work";
import { PROJECT_DRAFT, projectToken } from "./project";
import { bundlePlan, type ExportRecord } from "./export";
import { aceBody, composeCostUsd, elevenBody, ENGINES, MAX_TAKES, promptText, sectionsFromCuts, type ComposerEngine, type Section } from "./composer";
import { buildZip, type ZipEntry } from "./zip";
import { HEYGEN_MAX_BUNDLE_BYTES, heygenConfigured, readRender, startRender, uploadBundle } from "./heygen";
import { EDITOR_UNAVAILABLE, editorGate, isEditorEnabled, isEditorOpenToPlans } from "./enabled";
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

type Access = { error: string } | { error: null; userId: string; isAdmin: boolean };

async function editorAccess(): Promise<Access> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: SESSION_EXPIRED_MESSAGE };
  const { data: profile } = await supabase.from("profiles").select("role, status, plan, plan_status").eq("id", data.user.id).maybeSingle();
  const isAdmin = profile?.role === "admin";
  const gate = editorGate(profile, isAdmin || (await isEditorOpenToPlans(supabase)));
  if (gate.error !== null) return { error: gate.error };
  if (!(await isEditorEnabled(supabase))) return { error: EDITOR_UNAVAILABLE };
  return { error: null, userId: data.user.id, isAdmin };
}

/** The hold's rails for the person asking (charge.ts placeHold). */
async function holdDeps(userId: string): Promise<HoldDeps> {
  const supabase = await createClient();
  return {
    admin: createAdminClient(),
    allowance: (credits) => checkGenerationAllowance(supabase, userId, credits, { skipCooldown: true }),
    consumePurchased: (n) => consumePurchasedCredits(supabase, userId, n),
    consumeBonus: (n) => consumeBonusCredits(supabase, userId, n),
  };
}

/** A cut or change that failed gives its credits back — so after a few in a day, the next waits for tomorrow. */
async function tooManyFailures(access: { userId: string; isAdmin: boolean }): Promise<boolean> {
  return !access.isAdmin && (await failedToday(createAdminClient(), access.userId)) >= DAILY_FAILED_LIMIT;
}
const TOO_MANY_FAILURES = "A few of your edits didn't finish today, so new ones wait until tomorrow. Write to hello@picacho.ai if something looks wrong.";

/** A hold refused for credits says what it needed. */
function holdRefusal(hold: Exclude<Hold, { error: null }>, credits: number, what: "cut" | "change" | "music" | "export"): string {
  if (hold.code === "busy") return hold.error;
  const lead =
    what === "cut"
      ? `A cut holds up to ${credits} credits while Opus works — you pay what it uses and the rest comes back.`
      : what === "change"
        ? `A change holds up to ${credits} credits while Opus works — you pay what it uses and the rest comes back.`
        : `This costs ${credits} credit${credits === 1 ? "" : "s"}.`;
  // The shared allowance words explain video models' weights; nothing here has one.
  return `${lead} ${hold.error.replace(" (some models cost more than 1 per video)", "")}`;
}

const sumBytes = (clips: { bytes: number }[]) => clips.reduce((n, c) => n + (Number(c.bytes) || 0), 0);

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

  // Before anything is uploaded: can this account cover the cut's hold?
  // (The hold itself is taken on submit, once the files are really there.)
  if (!access.isAdmin) {
    if (await tooManyFailures(access)) return { error: TOO_MANY_FAILURES };
    const credits = cutHold(sumBytes(planned.clips));
    const allowance = await checkGenerationAllowance(await createClient(), access.userId, credits, { skipCooldown: true });
    if (allowance.error) return { error: holdRefusal({ error: allowance.error, code: "noCredits" }, credits, "cut") };
  }

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
  // The cut's hold: the most it can cost, settled when Opus delivers (advance.ts).
  if (await tooManyFailures(access)) return { error: TOO_MANY_FAILURES };
  const bytes = sumBytes(row.clips);
  const credits = cutHold(bytes);
  const hold = await placeHold(await holdDeps(access.userId), {
    userId: access.userId,
    rowId: crypto.randomUUID(),
    credits,
    modelId: EDITOR_MODEL_ID,
    prompt: row.brief || "Director's Cut",
    detail: `Director's Cut · cutting · holding ${credits} credits`,
    hidden: true,
  });
  if (hold.error !== null) return hold.code === "busy" ? { error: null } : { error: holdRefusal(hold, credits, "cut") };
  const { data: moved, error } = await admin
    .from("video_edits")
    .update({
      stage: "analyzing",
      progress: "Reading your footage",
      plan: { ...(row.plan ?? { outputs: [], history: [] }), holds: [{ turn: 1, rowId: hold.rowId, credits: hold.credits, bytes }] },
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("stage", "uploading")
    .select("id");
  if (error || !moved?.length) {
    if (hold.rowId) await settleHold(admin, hold.rowId, { charge: 0, outcome: "failed", detail: "Director's Cut · the cut didn't start, so nothing was charged." });
    return { error: error ? "Couldn't start the edit. Try again." : null };
  }
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

  // The change's hold (the turn's first video is its row), then Opus's
  // budget for it: what the session has spent plus the change's own limit.
  if (await tooManyFailures(access)) return { error: TOO_MANY_FAILURES };
  const turn = row.render.turn + 1;
  const bytes = sumBytes(clips);
  const credits = changeHold(bytes);
  const hold = await placeHold(await holdDeps(access.userId), {
    userId: access.userId,
    rowId: crypto.randomUUID(),
    credits,
    modelId: EDITOR_MODEL_ID,
    prompt: text || row.brief || "Director's Cut",
    detail: `Director's Cut · Cut ${turn} · holding ${credits} credits`,
    hidden: true,
  });
  if (hold.error !== null) return { error: holdRefusal(hold, credits, "change") };
  const giveBack = async (detail: string) => {
    if (hold.rowId) await settleHold(admin, hold.rowId, { charge: 0, outcome: "failed", detail }).catch(() => null);
  };

  let turnStartUsd: number;
  try {
    turnStartUsd = await raiseBudget(row.render.sessionId);
  } catch (err) {
    console.error(`[editor] budget for ${row.id} not raised:`, err instanceof Error ? err.message : err);
    await giveBack("Director's Cut · the change didn't start, so nothing was charged.");
    if (isBillingError(err)) {
      await alertEditorOutOfCredit();
      return { error: OUT_OF_CREDIT_ERROR };
    }
    return { error: "The editor didn't take the change. Try again in a moment." };
  }

  const now = Date.now();
  const said: Note = song ? { role: "you", text, song: clips[clips.length - 1].name } : { role: "you", text };
  // Claim the turn, so two presses cannot send two notes.
  const { data: claimed, error } = await admin
    .from("video_edits")
    .update({
      stage: "directing",
      progress: "Making your change",
      clips,
      render: { ...row.render, turn, turnStartedAt: now, turnStartUsd },
      plan: {
        ...(row.plan ?? { outputs: [] }),
        outputs: row.plan?.outputs ?? [],
        history: [...(row.plan?.history ?? []), said],
        holds: [...(row.plan?.holds ?? []), { turn, rowId: hold.rowId, credits: hold.credits, bytes }],
      },
      error: null,
      attempts: 0,
      updated_at: new Date(now).toISOString(),
    })
    .eq("id", row.id)
    .eq("stage", "done")
    .select("id");
  if (error || !claimed?.length) {
    await giveBack("Director's Cut · the change didn't start, so nothing was charged.");
    return { error: "Couldn't send the change. Try again." };
  }
  try {
    await sendChange(row.render.sessionId, text, extras);
  } catch (err) {
    console.error(`[editor] change for ${row.id} not sent:`, err instanceof Error ? err.message : err);
    await admin
      .from("video_edits")
      .update({ stage: "done", progress: null, clips: row.clips, render: row.render, plan: row.plan, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    await giveBack("Director's Cut · the change didn't reach the editor, so nothing was charged.");
    if (isBillingError(err)) {
      await alertEditorOutOfCredit();
      return { error: OUT_OF_CREDIT_ERROR };
    }
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
  const { data: rows, error } = await supabase
    .from("video_edits")
    .select("id, brief, aspect, target_seconds, stage, progress, error, generation_id, created_at, updated_at, clips, plan, director")
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) return { error: "Couldn't load your edits.", edits: [] };
  // Effects jobs share the table and have their own door (effects.ts); the bench lists edits only.
  const data = (rows ?? []).filter((r) => !isEffectsRow(r)).slice(0, 20);
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
export type EditOutput = { title: string; summary: string; aspect: string; seconds: number; turn: number; url: string | null; generationId: string; editable: boolean; cover: string | null };

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
  /** What each cut (turn 1) and change held, and what it came to once it ended (null while it works). */
  holds: { turn: number; held: number; charged: number | null }[];
  /** The footage (and songs) a change downloads again — what its hold is sized on (pricing.ts changeHold). */
  footageBytes: number;
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
          cover: o.cover ?? null,
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
      holds: (row.plan?.holds ?? []).map((h) => ({ turn: h.turn, held: h.credits, charged: typeof h.charged === "number" ? h.charged : null })),
      footageBytes: sumBytes(row.clips),
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
  const zip = buildZip(entries);
  if (zip.byteLength > HEYGEN_MAX_BUNDLE_BYTES) return { error: "This edit is too large to render in one go (over 200 MB)." };
  // A fixed price (pricing.ts exportCredits), given back if the render fails.
  const credits = exportCredits(output.seconds);
  const hold = await placeHold(await holdDeps(access.userId), {
    userId: access.userId,
    rowId: crypto.randomUUID(),
    credits,
    modelId: EDITOR_EXPORT_MODEL_ID,
    prompt: `Export · ${output.title || "your edit"}`,
    detail: `Director's Cut · Export · ${credits} credit${credits === 1 ? "" : "s"}`,
    hidden: true,
  });
  if (hold.error !== null) return { error: holdRefusal(hold, credits, "export") };
  const refund = async () => {
    if (hold.rowId) await settleHold(admin, hold.rowId, { charge: 0, outcome: "failed", detail: "Director's Cut · the export didn't render, so it was free." }).catch(() => null);
  };
  let renderId: string;
  try {
    const assetId = await uploadBundle(zip, { filename: `${exportId}.zip`, idempotencyKey: exportId });
    const aspect = (["16:9", "9:16", "1:1"] as const).find((a) => a === output.aspect) ?? "16:9";
    renderId = await startRender(assetId, { aspect, fps: 30, quality: "high", title: output.title, idempotencyKey: `render-${exportId}` });
  } catch (err) {
    console.error(`[editor] export for ${row.id} failed:`, err instanceof Error ? err.message : err);
    await refund();
    return { error: "The renderer didn't take this edit. Try again in a moment." };
  }
  const record: ExportRecord = { id: exportId, source: generationId, renderId, status: "rendering", startedAt: Date.now(), chargeRowId: hold.rowId, credits: hold.credits };
  const { error } = await admin
    .from("video_edits")
    .update({ plan: { ...row.plan!, exports: [...(row.plan?.exports ?? []), record] }, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) {
    await refund();
    return { error: "Couldn't keep track of the render. Try again." };
  }
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
    if (record.chargeRowId) {
      await settleHold(admin, record.chargeRowId, { charge: 0, outcome: "failed", detail: "Director's Cut · the export didn't render, so it was free." }).catch(() => null);
    }
    return { error: null, status: "failed" };
  }
  const res = await fetch(state.videoUrl, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) return { error: null, status: "rendering" };
  const bytes = new Uint8Array(await res.arrayBuffer());
  const generationId = derivedUuid(`video-edit-export:${exportId}`);
  const seconds = state.duration ?? source.seconds;
  const title = `${source.title || "Your edit"} · your edit`;
  await deliverOne(admin, row, generationId, { title, summary: "", aspect: source.aspect, seconds, bytes });
  if (record.chargeRowId) {
    const credits = record.credits ?? 0;
    await settleHold(admin, record.chargeRowId, { charge: credits, outcome: "succeeded", detail: `Director's Cut · Export · ${credits} credit${credits === 1 ? "" : "s"}` });
  }
  await settle(
    { status: "done", resultId: generationId },
    { title, summary: "Your edit on the timeline, rendered.", aspect: source.aspect, seconds, generationId, turn: source.turn, project: source.project ?? null },
  );
  // What the render cost us, on the edit's record (and outside the session's own figure, advance.ts).
  const renderUsd = Math.max(1, Math.ceil(seconds / 60)) * EXPORT_USD_PER_MINUTE;
  await bumpCost(admin, row.id, renderUsd);
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
  if (!(await offered("music", engine))) return { error: "That music engine isn't offered right now. Pick the other one." };
  const prompt = typeof input?.prompt === "string" ? input.prompt.trim().slice(0, 800) : "";
  const styles = (Array.isArray(input?.styles) ? input.styles : []).filter((s): s is string => typeof s === "string").map((s) => s.slice(0, 40)).slice(0, 12);
  if (!prompt && styles.length === 0) return { error: "Describe the music, or pick a mood." };
  const seconds = Math.min(ENGINES[engine].maxSeconds, Math.max(5, Number(input?.seconds) || output.seconds || 30));
  const sections = sectionsFromCuts(seconds, (Array.isArray(input?.sections) ? input.sections : []).map((s) => Number(s?.start)).filter(Number.isFinite));
  const takes = Math.max(1, Math.min(MAX_TAKES, Math.round(Number(input?.takes) || MAX_TAKES)));
  const req = { engine, prompt, styles, instrumental: input?.instrumental !== false, seconds, sections, takes };
  const admin = createAdminClient();
  // A fixed price for the takes asked for (pricing.ts composeCredits); the ones that fail come back.
  const credits = composeCredits(engine, seconds, takes);
  const hold = await placeHold(await holdDeps(access.userId), {
    userId: access.userId,
    rowId: crypto.randomUUID(),
    credits,
    modelId: EDITOR_MUSIC_MODEL_ID,
    prompt: `Music · ${prompt || styles.join(", ")}`,
    detail: `Director's Cut · music · ${takes} take${takes === 1 ? "" : "s"} · ${credits} credit${credits === 1 ? "" : "s"}`,
    hidden: true,
  });
  if (hold.error !== null) return { error: holdRefusal(hold, credits, "music") };
  const made = await Promise.allSettled(
    Array.from({ length: takes }, async () => {
      const res = await fetch(`https://fal.run/${ENGINES[engine].endpoint}`, {
        method: "POST",
        headers: { authorization: `Key ${process.env.FAL_KEY}`, "content-type": "application/json" },
        body: JSON.stringify(engine === "eleven" ? elevenBody(req) : aceBody(req, Math.floor(Math.random() * 2_000_000_000))),
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
  if (hold.rowId) {
    const kept = done.length > 0 ? Math.min(credits, composeCredits(engine, seconds, done.length)) : 0;
    await settleHold(admin, hold.rowId, {
      charge: kept,
      outcome: kept > 0 ? "succeeded" : "failed",
      detail: `Director's Cut · music · ${done.length} of ${takes} take${takes === 1 ? "" : "s"} made · ${kept} credit${kept === 1 ? "" : "s"}`,
    }).catch((err: unknown) => console.error(`[editor] compose settle for ${row.id} failed:`, err instanceof Error ? err.message : err));
  }
  if (done.length === 0) return { error: "The composer couldn't make music this time. Nothing was charged. Try again." };
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  await bumpCost(admin, row.id, spent);
  return { error: null, takes: done.map((d) => ({ id: d.take.id, source: d.take.source, engine: d.take.engine, file: d.take.file, seconds: d.take.seconds })) };
}

function kick(editId: string): void {
  kickEdit(editId);
}

/**
 * Our spend outside the editing session (music, a render) onto the edit's
 * record. The session's own figure is re-read every tick on top of
 * render.preUsd (advance.ts), so the spend goes there too, or the next tick
 * would write over it.
 */
async function bumpCost(admin: ReturnType<typeof createAdminClient>, editId: string, usd: number): Promise<void> {
  if (!(usd > 0)) return;
  const { data } = await admin.from("video_edits").select("cost_usd, render").eq("id", editId).maybeSingle<{ cost_usd: number | null; render: EditRow["render"] }>();
  if (!data) return;
  const round = (n: number) => Math.round(n * 10000) / 10000;
  await admin
    .from("video_edits")
    .update({
      cost_usd: round((Number(data.cost_usd) || 0) + usd),
      ...(data.render ? { render: { ...data.render, preUsd: round((Number(data.render.preUsd) || 0) + usd) } } : {}),
    })
    .eq("id", editId);
}
