// One tick of an edit: take the lock, do the next step (or a few quick ones),
// write down where it got to, let go. Called every minute by
// /api/cron/edits for every edit still working, and once right after the
// customer presses Edit so the first step starts at once.
//
// Every step is resumable from the row alone. A function that dies mid-step
// leaves the lock to go stale (LOCK_STALE_MS) and the step is redone; a step
// that fails MAX_ATTEMPTS times in a row fails the edit with its reason. No
// step is charged to the customer while the editor is admins-only; what each
// step cost US is added to cost_usd from the providers' own numbers.
//
// HeyGen's render is polled here rather than waited for by a webhook: a
// render takes minutes, a tick comes every minute, and polling leaves no
// endpoint to forge.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";

import { sheetIntervalFor } from "./analyze";
import { directStep, newDirectorState, DirectorError, type ClipBrief, type DirectorInput } from "./director";
import { readRender, startRender, uploadBundle, HeygenError } from "./heygen";
import {
  EDITOR_BUCKET,
  EDIT_COLUMNS,
  footageProblem,
  isHeavy,
  LOCK_STALE_MS,
  MAX_ATTEMPTS,
  nextStep,
  progressLine,
  RENDER_DEADLINE_MS,
  totalVideoSeconds,
  type ClipRecord,
  type EditRow,
  type Step,
} from "./job";
import { planDuration } from "./plan";
import { opusCostUsd, renderCostUsd, whisperCostUsd } from "./prices";
import { transcribeSpeech } from "./transcribe";
import { analyzeClip, buildBundle, probeClip } from "./work";
import { mediaUrl } from "../media/url";

type Admin = SupabaseClient;

export type AdvanceDeps = {
  admin: Admin;
  anthropic?: Anthropic;
  now?: () => number;
  /** Heavy steps start only while the tick is younger than this. */
  heavyStartBudgetMs?: number;
  /** The tick stops starting steps after this. */
  tickBudgetMs?: number;
};

export type AdvanceOutcome = "locked" | "missing" | "idle" | "advanced" | "done" | "failed";

const SIGNED_URL_SECONDS = 2 * 60 * 60;
const DIRECTOR_TIMEOUT_MS = 230_000;

export async function advanceEdit(editId: string, deps: AdvanceDeps): Promise<AdvanceOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const heavyBudget = deps.heavyStartBudgetMs ?? 20_000;
  const tickBudget = deps.tickBudgetMs ?? 60_000;
  const { admin } = deps;

  let row = await claim(admin, editId, now());
  if (!row) return (await exists(admin, editId)) ? "locked" : "missing";

  let outcome: AdvanceOutcome = "idle";
  try {
    for (;;) {
      const step = nextStep(row);
      if (step.kind === "none") break;
      const elapsed = now() - started;
      if (elapsed > tickBudget || (isHeavy(step) && elapsed > heavyBudget)) break;
      await save(admin, row.id, { progress: progressLine(step, row) });
      let next: Partial<EditRow> | "wait";
      try {
        next = await runStep(step, row, deps, now);
      } catch (err) {
        const fatal = err instanceof DirectorError && (err.kind === "refused" || err.kind === "invalid");
        const cost = err instanceof DirectorError ? err.costUsd : 0;
        const attempts = row.attempts + 1;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[editor] ${row.id} ${step.kind} failed (attempt ${attempts}):`, message);
        if (fatal || attempts >= MAX_ATTEMPTS) {
          await save(admin, row.id, { stage: "failed", error: customerError(step, err), progress: null, attempts, cost_usd: round4(row.cost_usd + cost) });
          outcome = "failed";
        } else {
          await save(admin, row.id, { attempts, cost_usd: round4(row.cost_usd + cost) });
        }
        break;
      }
      if (next === "wait") break;
      const stageChanged = next.stage !== undefined && next.stage !== row.stage;
      const patch: Partial<EditRow> = { ...next, attempts: stageChanged ? 0 : next.attempts ?? 0 };
      await save(admin, row.id, patch);
      row = { ...row, ...patch } as EditRow;
      outcome = row.stage === "done" ? "done" : row.stage === "failed" ? "failed" : "advanced";
      if (row.stage === "done" || row.stage === "failed") break;
    }
  } finally {
    await admin.from("video_edits").update({ locked_at: null }).eq("id", editId);
  }
  return outcome;
}

async function runStep(step: Step, row: EditRow, deps: AdvanceDeps, now: () => number): Promise<Partial<EditRow> | "wait"> {
  const { admin } = deps;
  switch (step.kind) {
    case "probe": {
      const clips = await Promise.all(
        row.clips.map(async (c) => (c.probe ? c : { ...c, probe: await probeClip(await signedUrl(admin, c.path)) })),
      );
      const problem = footageProblem(clips);
      if (problem) return { clips, stage: "failed", error: problem, progress: null };
      const total = totalVideoSeconds(clips);
      return { clips: clips.map((c) => ({ ...c, interval: c.probe!.hasVideo ? sheetIntervalFor(c.probe!.duration, total) : null })) };
    }

    case "analyze": {
      const clip = row.clips[step.clip];
      const probe = clip.probe!;
      const analyzed = await analyzeClip(await signedUrl(admin, clip.path), probe, clip.interval ?? 1);
      const sheets: string[] = [];
      for (const [k, bytes] of analyzed.sheets.entries()) {
        const path = `${row.user_id}/${row.id}/sheets/c${step.clip}-${String(k).padStart(3, "0")}.jpg`;
        const { error } = await admin.storage.from(EDITOR_BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: true });
        if (error) throw new Error(`couldn't keep contact sheet ${k}: ${error.message}`);
        sheets.push(path);
      }
      let words = clip.words;
      let cost = 0;
      if (analyzed.speech && analyzed.speech.byteLength > 0) {
        words = (await transcribeSpeech(analyzed.speech, { filename: `clip-${step.clip}.mp3` })).words;
        cost = whisperCostUsd(probe.duration);
      }
      const done: ClipRecord = {
        ...clip,
        sheets,
        sceneChanges: analyzed.sceneChanges,
        silences: analyzed.silences,
        words,
        analyzed: true,
      };
      const clips = row.clips.map((c, i) => (i === step.clip ? done : c));
      const allDone = clips.every((c) => c.analyzed);
      return {
        clips,
        cost_usd: round4(row.cost_usd + cost),
        ...(allDone ? { stage: "directing" as const, director: row.director ?? newDirectorState() } : {}),
      };
    }

    case "direct": {
      const state = row.director ?? newDirectorState();
      const before = opusCostUsd(state.usage);
      const input = await directorInput(admin, row);
      const after = await directStep(input, state, deps.anthropic, { timeoutMs: DIRECTOR_TIMEOUT_MS });
      const cost = opusCostUsd(after.usage) - before;
      const patch: Partial<EditRow> = { director: after, cost_usd: round4(row.cost_usd + cost), stage: "directing" };
      if (after.phase === "done" && after.plan) {
        patch.plan = after.plan;
        patch.stage = "bundling";
      }
      return patch;
    }

    case "bundle": {
      const plan = row.plan!;
      const urls = await Promise.all(row.clips.map((c) => signedUrl(admin, c.path)));
      const bundle = await buildBundle(
        plan,
        row.clips.map((c) => c.words),
        urls,
        row.clips.map((c) => c.probe?.hasAudio === true),
      );
      const tag = `${row.id}-${turnCount(row)}`;
      const assetId = await uploadBundle(bundle.zip, { filename: `edit-${row.id}.zip`, idempotencyKey: `edit-asset-${tag}` });
      const renderId = await startRender(assetId, {
        aspect: plan.aspect,
        title: `Picacho edit ${row.id}`,
        callbackId: row.id,
        idempotencyKey: `edit-render-${tag}`,
      });
      return { stage: "rendering", render: { assetId, renderId, startedAt: now() } };
    }

    case "poll": {
      const render = row.render!;
      const state = await readRender(render.renderId);
      if (state.status === "failed") {
        return { stage: "failed", error: "The render didn't finish. Nothing was charged; try again.", progress: null };
      }
      if (state.status !== "completed" || !state.videoUrl) {
        if (now() - render.startedAt > RENDER_DEADLINE_MS) {
          return { stage: "failed", error: "The render took too long. Nothing was charged; try again.", progress: null };
        }
        return "wait";
      }
      return deliver(admin, row, state.videoUrl, state.duration);
    }

    default:
      return "wait";
  }
}

/** The finished file into our own storage, and one finished row in History. */
async function deliver(admin: Admin, row: EditRow, videoUrl: string, duration: number | null): Promise<Partial<EditRow>> {
  const res = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`couldn't fetch the rendered video: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Derived, not random: a tick that dies between this insert and saving
  // "done" is redone by the next one, which must land on the SAME History
  // row and file rather than add a second. A revise is a new turn, so a new
  // take.
  const generationId = derivedUuid(`video-edit:${row.id}:${turnCount(row)}`);
  const path = `${row.user_id}/${generationId}.mp4`;
  const { error: upErr } = await admin.storage.from("generated-videos").upload(path, bytes, { contentType: "video/mp4", upsert: true });
  if (upErr) throw new Error(`couldn't keep the rendered video: ${upErr.message}`);
  const plan = row.plan!;
  const seconds = duration ?? planDuration(plan);
  const { data: already } = await admin.from("generations").select("id").eq("id", generationId).maybeSingle();
  if (already) {
    return { stage: "done", progress: null, error: null, generation_id: generationId, cost_usd: round4(row.cost_usd + renderCostUsd(seconds)) };
  }
  const { data, error } = await admin
    .from("generations")
    .insert({
      id: generationId,
      user_id: row.user_id,
      prompt_input: (row.brief.trim() || plan.summary || "Edited video").slice(0, 2000),
      status: "succeeded",
      content_type: "video",
      model_id: "video-editor",
      result_url: mediaUrl("generated-videos", path),
      credits_used: 0,
      video_duration_seconds: Math.round(seconds),
      video_aspect_ratio: plan.aspect,
      pipeline_log: [],
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    await admin.storage.from("generated-videos").remove([path]);
    throw new Error(`couldn't add the edit to History: ${error?.message ?? "no row"}`);
  }
  return {
    stage: "done",
    progress: null,
    error: null,
    generation_id: data.id,
    cost_usd: round4(row.cost_usd + renderCostUsd(seconds)),
  };
}

/** The opening the director sees, rebuilt from the row (byte-identical each time, so it stays cached). */
async function directorInput(admin: Admin, row: EditRow): Promise<DirectorInput> {
  const clips: ClipBrief[] = await Promise.all(
    row.clips.map(async (c) => {
      const sheets = await Promise.all(
        c.sheets.map(async (path) => {
          const { data, error } = await admin.storage.from(EDITOR_BUCKET).download(path);
          if (error || !data) throw new Error(`couldn't read contact sheet ${path}: ${error?.message ?? "no data"}`);
          return new Uint8Array(await data.arrayBuffer());
        }),
      );
      const p = c.probe!;
      return {
        name: c.name,
        duration: p.duration,
        hasVideo: p.hasVideo,
        hasAudio: p.hasAudio,
        width: p.width,
        height: p.height,
        interval: c.interval ?? 1,
        sheets,
        sceneChanges: c.sceneChanges,
        silences: c.silences,
      };
    }),
  );
  return {
    brief: row.brief,
    clips,
    transcripts: row.clips.map((c) => c.words),
    aspect: row.aspect,
    targetSeconds: row.target_seconds,
  };
}

async function claim(admin: Admin, editId: string, nowMs: number): Promise<EditRow | null> {
  const stale = new Date(nowMs - LOCK_STALE_MS).toISOString();
  const { data, error } = await admin
    .from("video_edits")
    .update({ locked_at: new Date(nowMs).toISOString() })
    .eq("id", editId)
    .in("stage", ["analyzing", "directing", "bundling", "rendering"])
    .or(`locked_at.is.null,locked_at.lt.${stale}`)
    .select(EDIT_COLUMNS)
    .maybeSingle<EditRow>();
  if (error) {
    console.error(`[editor] claim ${editId} failed:`, error.message);
    return null;
  }
  return data ? { ...data, cost_usd: Number(data.cost_usd) || 0, clips: data.clips ?? [] } : null;
}

async function exists(admin: Admin, editId: string): Promise<boolean> {
  const { data } = await admin.from("video_edits").select("id").eq("id", editId).maybeSingle();
  return Boolean(data);
}

async function save(admin: Admin, editId: string, patch: Partial<EditRow>): Promise<void> {
  const { error } = await admin
    .from("video_edits")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", editId);
  if (error) throw new Error(`couldn't save edit ${editId}: ${error.message}`);
}

async function signedUrl(admin: Admin, path: string): Promise<string> {
  const { data, error } = await admin.storage.from(EDITOR_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(`couldn't open ${path}: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

/** How many director answers the conversation holds — a revise makes a new render, a retry does not. */
function turnCount(row: EditRow): number {
  return (row.director?.turns ?? []).filter((t) => t.role === "assistant").length;
}

function customerError(step: Step, err: unknown): string {
  if (err instanceof DirectorError) {
    if (err.kind === "refused") return "The editor can't work with this footage or brief.";
    if (err.kind === "invalid") return "The editor couldn't make a cut that fits this footage. Try a simpler brief.";
    return "The editor didn't answer. Try again in a few minutes.";
  }
  if (err instanceof HeygenError) return "The renderer didn't accept this edit. Try again.";
  if (step.kind === "probe" || step.kind === "analyze") return "We couldn't read one of your files. Try exporting it as MP4.";
  return "Something went wrong making this edit. Try again.";
}

/** A stable UUID (v4 layout) from a string — the same input always names the same row. */
export function derivedUuid(seed: string): string {
  const h = createHash("sha256").update(seed).digest();
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
