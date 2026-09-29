// One tick of an effect job (lib/effects/job.ts). advance.ts claims the row,
// runs this, saves what it returns and lets go; the minute cron calls again.
//
//   analyzing → a video: read it, three frames to Opus, its instruction to
//               FLUX 3 edit; a photo: its one-tap effect to its engine.
//   directing → the engine still working: wait. Done: on a video, Opus
//               reads the result next to the original; a miss gets one more
//               try with the instruction it rewrote. Then the video lands in
//               History. A refusal ends it, in plain words.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueuedJob } from "../generations/providers/fal";
import { EDITOR_BUCKET, FOOTAGE_URL_SECONDS, type DeliveryRecord, type EditRow } from "../editor/job";
import { framesAt, probeClip } from "../editor/work";
import { ENGINES, engineUsd, photoPreset, presetBody, shotRecipe } from "./catalog";
import { effectsClient, judgeEffect, planEffect } from "./opus";
import { FX_FAILED, FX_REFUSED, FX_TOO_BIG, FX_TOO_LONG, MAX_TRIES, aspectOf, fxMarker, fxOf, refusalOf, type FxState, type FxTry } from "./job";

type Admin = SupabaseClient;
type Delivered = { title: string; summary: string; aspect: string; seconds: number; bytes: Uint8Array; modelId?: string };

export type FxDeps = {
  admin: Admin;
  now: () => number;
  deliver: (admin: Admin, row: EditRow, generationId: string, o: Delivered) => Promise<void>;
  derivedUuid: (seed: string) => string;
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

// fal is loaded when an effect runs, not when the runner is: its module
// reaches the whole generation stack, which the editor's own jobs never need.
const falApi = () => import("../generations/providers/fal");
async function submitEffectJob(endpoint: string, body: Record<string, unknown>): Promise<QueuedJob> {
  return (await falApi()).submitEffectJob(endpoint, body);
}
async function checkQueuedJob(job: QueuedJob) {
  return (await falApi()).checkQueuedJob(job);
}
async function fetchQueuedVideoUrl(job: QueuedJob): Promise<string> {
  return (await falApi()).fetchQueuedVideoUrl(job);
}

/** Three moments across a clip, for Opus's before-and-after reads. */
function moments(seconds: number): number[] {
  const d = Math.max(0.5, seconds);
  return [0.15, 0.5, 0.85].map((f) => Math.min(d - 0.1, Math.max(0, d * f)));
}

async function signed(admin: Admin, path: string): Promise<string> {
  const { data, error } = await admin.storage.from(EDITOR_BUCKET).createSignedUrl(path, FOOTAGE_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(`couldn't sign ${path}: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

function withFx(fx: FxState): Pick<EditRow, "director"> {
  return { director: fxMarker(fx) };
}

export async function runFx(row: EditRow, deps: FxDeps): Promise<Partial<EditRow>> {
  const fx = fxOf(row.director);
  if (!fx) throw new Error("not an effect job");
  const clip = row.clips[0];
  const { admin } = deps;
  const sourceUrl = await signed(admin, clip.path);

  if (row.stage === "analyzing") {
    if (fx.kind === "photo") {
      const preset = photoPreset(fx.effectId);
      if (!preset) return { stage: "failed", error: "That effect isn't in the library any more." };
      const job = await submitEffectJob(ENGINES[preset.engine].endpoint, presetBody(preset, sourceUrl, { width: fx.width, height: fx.height }));
      const next: FxState = { ...fx, tries: [{ instruction: preset.value, job, at: deps.now(), verdict: null }] };
      return { ...withFx(next), stage: "directing", progress: "Rendering the effect", cost_usd: round4(row.cost_usd + engineUsd(preset.engine, null)) };
    }

    // A video: read it, then Opus writes the one instruction the engine gets.
    const probe = clip.probe ?? (await probeClip(sourceUrl));
    if (!probe.hasVideo) return { stage: "failed", error: "That file has no picture." };
    if (probe.duration > ENGINES.flux3.maxSeconds! + 0.3) return { stage: "failed", error: FX_TOO_LONG, clips: [{ ...clip, probe }] };
    if (clip.bytes > ENGINES.flux3.maxBytes!) return { stage: "failed", error: FX_TOO_BIG, clips: [{ ...clip, probe }] };
    const client = effectsClient();
    if (!client) throw new Error("effects: no Anthropic key");
    const frames = await framesAt(sourceUrl, moments(probe.duration));
    const recipe = shotRecipe(fx.effectId);
    const plan = await planEffect(client, { effect: recipe ? `${recipe.name}: ${recipe.add}` : "", words: fx.words, frames });
    if (!plan.ok) throw new Error(`effects: Opus couldn't read the shot (${plan.error})`);
    if (!plan.value.doable) {
      return { stage: "failed", error: plan.value.whyNot || FX_REFUSED, clips: [{ ...clip, probe }], cost_usd: round4(row.cost_usd + plan.usd) };
    }
    const job = await submitEffectJob(ENGINES.flux3.endpoint, { prompt: plan.value.instruction, video_url: sourceUrl });
    const next: FxState = {
      ...fx,
      width: probe.width || null,
      height: probe.height || null,
      plan: { title: plan.value.title, summary: plan.value.summary },
      tries: [{ instruction: plan.value.instruction, job, at: deps.now(), verdict: null }],
    };
    return {
      ...withFx(next),
      clips: [{ ...clip, probe }],
      stage: "directing",
      progress: "Adding your effect",
      cost_usd: round4(row.cost_usd + plan.usd + engineUsd("flux3", probe.duration)),
    };
  }

  if (row.stage !== "directing") return {};
  const last = fx.tries[fx.tries.length - 1];
  if (!last) return { stage: "failed", error: FX_FAILED };
  const state = await checkQueuedJob(last.job);
  if (state.state === "pending") return { progress: state.started ? "Rendering the effect" : "Waiting for the engine" };

  if (state.state === "failed") {
    const refused = refusalOf(state.error);
    console.error(`[effects] ${row.id} try ${fx.tries.length} failed:`, state.error.slice(0, 300));
    if (refused || fx.tries.length >= MAX_TRIES) return { stage: "failed", error: refused ? FX_REFUSED : FX_FAILED };
    return resubmit(row, fx, last.instruction, deps);
  }

  // Done: the result, and on a video, Opus's reading of it next to the original.
  const resultUrl = await fetchQueuedVideoUrl(last.job);
  const probe = await probeClip(resultUrl);
  let verdict: FxTry["verdict"] = null;
  let extraUsd = 0;
  if (fx.kind === "shot") {
    const client = effectsClient();
    const seconds = clip.probe?.duration ?? probe.duration;
    const [before, after] = await Promise.all([framesAt(sourceUrl, moments(seconds)), framesAt(resultUrl, moments(probe.duration || seconds))]);
    const recipe = shotRecipe(fx.effectId);
    const read = client
      ? await judgeEffect(client, { effect: recipe ? `${recipe.name}: ${recipe.add}` : "", words: fx.words, instruction: last.instruction, before, after })
      : null;
    extraUsd = read?.usd ?? 0;
    if (read?.ok) {
      verdict = { ok: read.value.ok, note: read.value.note };
      if (!read.value.ok && fx.tries.length < MAX_TRIES && read.value.betterInstruction) {
        const tries = fx.tries.map((t, i) => (i === fx.tries.length - 1 ? { ...t, verdict } : t));
        return resubmit({ ...row, cost_usd: round4(row.cost_usd + extraUsd) }, { ...fx, tries }, read.value.betterInstruction, deps);
      }
    }
    // A reading that failed costs the check, never the video.
  }

  const res = await fetch(resultUrl, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`effects: couldn't fetch the result (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const aspect = aspectOf(probe.width, probe.height);
  const title = fx.plan?.title || fx.effectName;
  const summary = verdict?.note || fx.plan?.summary || `${fx.effectName}, added by Opus 5.5.`;
  const generationId = deps.derivedUuid(`video-effect:${row.id}:${fx.tries.length}`);
  await deps.deliver(admin, row, generationId, { title, summary, aspect, seconds: probe.duration, bytes, modelId: "effects" });
  const tries = fx.tries.map((t, i) => (i === fx.tries.length - 1 ? { ...t, verdict } : t));
  const plan: DeliveryRecord = {
    ...(row.plan ?? { outputs: [], history: [] }),
    outputs: [...(row.plan?.outputs ?? []), { title, summary, aspect, seconds: probe.duration, generationId, turn: 1 }],
    history: [...(row.plan?.history ?? []), { role: "editor", text: summary }],
  };
  return { ...withFx({ ...fx, tries }), stage: "done", plan, generation_id: generationId, error: null, cost_usd: round4(row.cost_usd + extraUsd) };
}

async function resubmit(row: EditRow, fx: FxState, instruction: string, deps: FxDeps): Promise<Partial<EditRow>> {
  const url = await signed(deps.admin, row.clips[0].path);
  let job;
  let added = 0;
  if (fx.kind === "photo") {
    const preset = photoPreset(fx.effectId);
    if (!preset) return { stage: "failed", error: FX_FAILED };
    job = await submitEffectJob(ENGINES[preset.engine].endpoint, presetBody(preset, url, { width: fx.width, height: fx.height }));
    added = engineUsd(preset.engine, null);
  } else {
    job = await submitEffectJob(ENGINES.flux3.endpoint, { prompt: instruction, video_url: url });
    added = engineUsd("flux3", row.clips[0].probe?.duration ?? null);
  }
  const next: FxState = { ...fx, tries: [...fx.tries, { instruction, job, at: deps.now(), verdict: null }] };
  return { ...withFx(next), progress: "Trying it again", cost_usd: round4(row.cost_usd + added) };
}
