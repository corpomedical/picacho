// One tick of an edit: take the lock, do the next step (or a few quick ones),
// write down where it got to, let go. Called every minute by
// /api/cron/edits for every edit still working, and once right after the
// customer presses Cut it (or asks for a change) so the first step starts at
// once.
//
// v2 (2026-09-25): probe → listen to each clip (transcript + no-speech guard)
// → start ONE Managed Agent session that makes the whole video → watch it →
// deliver whatever it finished into History. Every step is resumable from the
// row alone; a lock left by a dead function goes stale (LOCK_STALE_MS); a step
// that fails MAX_ATTEMPTS times in a row fails the edit. Nothing is charged
// to the customer while the editor is admins-only; cost_usd records what the
// edit cost US (transcription + the session's own list cost).

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";

import { collectDelivery, readSession, startSession, AgentError, type JobClip } from "./agent";
import {
  EDITOR_BUCKET,
  EDIT_COLUMNS,
  FOOTAGE_URL_SECONDS,
  footageProblem,
  isHeavy,
  LOCK_STALE_MS,
  MAX_ATTEMPTS,
  nextStep,
  SESSION_DEADLINE_MS,
  type ClipRecord,
  type DeliveryRecord,
  type EditRow,
  type Output,
  type SessionRecord,
  type Step,
} from "./job";
import { whisperCostUsd } from "./prices";
import { transcribeTwice } from "./transcribe";
import { extractSpeech, probeClip } from "./work";
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

const PROGRESS: Record<Step["kind"], string> = {
  probe: "Reading your footage",
  listen: "Listening to your footage",
  start: "Handing the footage to the editor",
  watch: "Editing",
  none: "",
};

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
      let next: Partial<EditRow> | "wait";
      try {
        next = await runStep(step, row, deps, now);
      } catch (err) {
        const fatal = err instanceof AgentError;
        const attempts = row.attempts + 1;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[editor] ${row.id} ${step.kind} failed (attempt ${attempts}):`, message);
        if (fatal || attempts >= MAX_ATTEMPTS) {
          await save(admin, row.id, { stage: "failed", error: customerError(step, err), progress: null, attempts });
          outcome = "failed";
        } else {
          await save(admin, row.id, { attempts });
        }
        break;
      }
      if (next === "wait") break;
      const stageChanged = next.stage !== undefined && next.stage !== row.stage;
      const patch: Partial<EditRow> = { progress: PROGRESS[step.kind], ...next, attempts: stageChanged ? 0 : next.attempts ?? 0 };
      if (patch.stage === "done" || patch.stage === "failed") patch.progress = null;
      await save(admin, row.id, patch);
      row = { ...row, ...patch } as EditRow;
      outcome = row.stage === "done" ? "done" : row.stage === "failed" ? "failed" : "advanced";
      if (row.stage === "done" || row.stage === "failed" || step.kind === "watch") break;
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
        row.clips.map(async (c) => (c.probe ? c : { ...c, probe: await probeClip(await signedUrl(admin, c.path, 600)) })),
      );
      const problem = footageProblem(clips);
      if (problem) return { clips, stage: "failed", error: problem };
      return { clips };
    }

    case "listen": {
      const clip = row.clips[step.clip];
      const probe = clip.probe!;
      let done: ClipRecord;
      let cost = 0;
      const speechTrack = await extractSpeech(await signedUrl(admin, clip.path, 600), probe);
      if (!speechTrack || speechTrack.byteLength === 0) {
        done = { ...clip, speech: "silent", words: [], analyzed: true };
      } else {
        const heard = await transcribeTwice(speechTrack, { filename: `clip-${step.clip}.mp3` });
        cost = 2 * whisperCostUsd(probe.duration);
        done = { ...clip, speech: heard.speech ? "speech" : "no-speech", words: heard.words, analyzed: true };
      }
      return { clips: row.clips.map((c, i) => (i === step.clip ? done : c)), cost_usd: round4(row.cost_usd + cost) };
    }

    case "start": {
      const clips: JobClip[] = await Promise.all(
        row.clips.map(async (c, index) => ({
          index,
          name: c.name,
          seconds: c.probe?.duration ?? 0,
          hasVideo: c.probe?.hasVideo === true,
          hasAudio: c.probe?.hasAudio === true,
          url: await signedUrl(admin, c.path, FOOTAGE_URL_SECONDS),
          speech: c.speech ?? "silent",
          words: c.words,
        })),
      );
      const sessionId = await startSession(
        { editId: row.id, brief: row.brief, aspectHint: row.aspect, lengthHint: row.target_seconds, clips },
        deps.anthropic,
      );
      const at = now();
      const session: SessionRecord = { sessionId, startedAt: at, turn: 1, turnStartedAt: at, preUsd: row.cost_usd, lastResultId: null, latest: null };
      return { stage: "directing", render: session };
    }

    case "watch": {
      const session = row.render!;
      const view = await readSession(session.sessionId, deps.anthropic);
      const cost = round4(session.preUsd + view.costUsd);
      const latest = view.latest ?? (view.activity ? null : session.latest);
      if (view.status === "running" || view.status === "rescheduling") {
        if (now() - session.turnStartedAt > SESSION_DEADLINE_MS) {
          return { stage: "failed", error: "The editor took too long on this one. Try a shorter brief or fewer clips.", cost_usd: cost };
        }
        return { cost_usd: cost, render: { ...session, latest, activity: view.activity }, progress: latest ?? PROGRESS.watch };
      }
      if (view.status === "terminated") {
        return { stage: "failed", error: "The editing session stopped before it finished. Try again.", cost_usd: cost };
      }
      // Idle from BEFORE this turn was asked for: the change has not been picked up yet.
      if (view.idleAt !== null && view.idleAt < session.turnStartedAt) {
        return { cost_usd: cost, progress: PROGRESS.watch };
      }
      // Idle: it finished its turn — delivered, or stopped for a reason.
      if (view.stopReason === "budget_reached") {
        return { stage: "failed", error: "The editor used up this edit's budget before finishing. Try a simpler brief or fewer clips.", cost_usd: cost };
      }
      if (view.stopReason === "retries_exhausted") {
        return { stage: "failed", error: "The editor ran into repeated errors. Try again in a few minutes.", cost_usd: cost };
      }
      const delivery = await collectDelivery(session.sessionId, { alreadyDelivered: session.lastResultId }, deps.anthropic);
      if (!delivery) {
        return { stage: "failed", error: latest ? `The editor stopped without delivering a video: "${latest}"` : "The editor stopped without delivering a video.", cost_usd: cost };
      }
      const history = row.plan?.history ?? [];
      const outputs: Output[] = [];
      for (const [i, o] of delivery.outputs.entries()) {
        const generationId = derivedUuid(`video-edit:${row.id}:${session.turn}:${i}`);
        await deliverOne(admin, row, generationId, o);
        outputs.push({ title: o.title, summary: o.summary, aspect: o.aspect, seconds: o.seconds, generationId, turn: session.turn });
      }
      const said = delivery.outputs.map((o) => (o.title ? `${o.title}: ${o.summary}` : o.summary)).filter(Boolean);
      const plan: DeliveryRecord = {
        outputs: [...(row.plan?.outputs ?? []), ...outputs],
        history: [...history, ...said.map((text) => ({ role: "editor" as const, text })), ...(delivery.notes ? [{ role: "editor" as const, text: delivery.notes }] : [])],
      };
      return {
        stage: "done",
        plan,
        generation_id: outputs[0]?.generationId ?? row.generation_id,
        render: { ...session, lastResultId: delivery.resultId, latest },
        error: null,
        cost_usd: cost,
      };
    }

    default:
      return "wait";
  }
}

/** One finished video into our storage and one finished row in History. Derived id: a redone tick lands on the same row. */
async function deliverOne(
  admin: Admin,
  row: EditRow,
  generationId: string,
  o: { title: string; summary: string; aspect: string; seconds: number; bytes: Uint8Array },
): Promise<void> {
  const path = `${row.user_id}/${generationId}.mp4`;
  const { error: upErr } = await admin.storage.from("generated-videos").upload(path, o.bytes, { contentType: "video/mp4", upsert: true });
  if (upErr) throw new Error(`couldn't keep the rendered video: ${upErr.message}`);
  const { data: already } = await admin.from("generations").select("id").eq("id", generationId).maybeSingle();
  if (already) return;
  const prompt = [o.title, row.brief.trim()].filter(Boolean).join(" — ") || "Edited video";
  const { error } = await admin.from("generations").insert({
    id: generationId,
    user_id: row.user_id,
    prompt_input: prompt.slice(0, 2000),
    status: "succeeded",
    content_type: "video",
    model_id: "video-editor",
    result_url: mediaUrl("generated-videos", path),
    credits_used: 0,
    video_duration_seconds: Math.round(o.seconds) || null,
    video_aspect_ratio: o.aspect,
    pipeline_log: [],
  });
  if (error) {
    await admin.storage.from("generated-videos").remove([path]);
    throw new Error(`couldn't add the edit to History: ${error.message}`);
  }
}

async function claim(admin: Admin, editId: string, nowMs: number): Promise<EditRow | null> {
  const stale = new Date(nowMs - LOCK_STALE_MS).toISOString();
  const { data, error } = await admin
    .from("video_edits")
    .update({ locked_at: new Date(nowMs).toISOString() })
    .eq("id", editId)
    .in("stage", ["analyzing", "directing"])
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

async function signedUrl(admin: Admin, path: string, seconds: number): Promise<string> {
  const { data, error } = await admin.storage.from(EDITOR_BUCKET).createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) throw new Error(`couldn't open ${path}: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

function customerError(step: Step, err: unknown): string {
  if (err instanceof AgentError) return "The editor couldn't take this edit on. Try again.";
  if (step.kind === "probe" || step.kind === "listen") return "We couldn't read one of your files. Try exporting it as MP4.";
  if (step.kind === "start") return "The editor couldn't be started. Try again in a few minutes.";
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
