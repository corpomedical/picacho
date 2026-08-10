import { getVideoModel } from "@/lib/generations/providers/video-models";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";
import type { VideoAspectRatio } from "@/lib/generations/aspect-ratio";

// Generate step — sends the compiled prompt to the selected video model on
// fal.ai and returns a URL to the finished clip. fal.ai fronts many
// providers (Kling, Veo, and others) behind one API key, which is what
// makes the model switcher in Admin > AI Providers a one-line change
// instead of a new integration each time.

export type VideoGenerationOptions = {
  // "Multi-image reference" — send several of the character's reference
  // photos at once so the model has more to anchor identity to than one
  // photo + a text rulebook. Kling-specific (the "elements" endpoint), so
  // this only applies when the active model resolves to Kling — callers are
  // expected to have already checked that (see actions.ts).
  referenceImageUrls?: string[];
  // "Storyboard" — an optional first frame and/or last frame for the shot.
  // Also Kling-specific (image-to-video with a tail image), same caveat.
  startImageUrl?: string | null;
  endImageUrl?: string | null;
  // Baseline identity anchor — the character's own first reference photo.
  // Used automatically (every plan) whenever the caller hasn't already
  // supplied multi-image or storyboard options — see the 2026-08-07
  // incident notes below for why this exists and why it shares the
  // "elements" endpoint rather than image-to-video.
  characterAnchorImageUrl?: string | null;
  // Kling O3 only: whether to request O3's own native audio generation
  // (speech + ambient sound baked into the render itself, no separate TTS
  // call). Real incident, 2026-08-07: this defaults to off on fal.ai's side
  // — omitting it entirely (as the first O3 integration did) produces a
  // silent video even when the prompt describes a character speaking.
  // Defaults to true here; the caller sets it to false when the separate
  // ElevenLabs/Sync Labs dialogue pipeline is already going to run on this
  // same video, so we're not paying for two competing audio tracks (Sync
  // Labs' lipsync step re-renders the video with its own audio anyway,
  // which would just throw away whatever O3 generated).
  generateNativeAudio?: boolean;
  // Clip length in seconds. Every video endpoint wired up here (Kling 1.6's
  // three tiers, the storyboard endpoint, O3) defaults to a fixed 5s if this
  // is omitted — real incident, 2026-08-07: nothing ever set this, so every
  // video rendered at 5 seconds regardless of what the user asked for. The
  // caller (pipeline.ts) is responsible for only sending values actually
  // valid for the selected model (see video-models.ts's durations list,
  // enforced server-side in actions.ts) — this function just formats
  // whatever it's given.
  durationSeconds?: number;
  // Real incident, 2026-08-07: a character's reference photo wasn't 16:9,
  // and a Kling O3 video anchored to it came out in that photo's native
  // shape (black bars, ignored the prompt entirely) — O3's endpoint has no
  // aspect_ratio parameter, so there was nothing to set. Resolved server-side
  // in actions.ts (prompt text > composer icon pick > 16:9 default) before
  // it gets here. Defaults to 16:9 if omitted.
  aspectRatio?: VideoAspectRatio | null;
};

// Confirmed directly against fal.ai's published API docs (not guessed):
// - Elements: https://fal.ai/models/fal-ai/kling-video/v1.6/standard/elements/api
//   (prompt, input_image_urls[] — up to 4 images, aspect_ratio, no stated minimum on the list)
// - Storyboard (start/end frame): https://fal.ai/docs/model-api-reference/video-generation-api/kling-video-v2.1-pro
//   (prompt, image_url required, tail_image_url optional — no aspect_ratio param)
// - Kling O3 Standard (image-to-video): https://fal.ai/models/fal-ai/kling-video/o3/standard/image-to-video/api
//   (image_url required, prompt, end_image_url optional, duration, generate_audio —
//   note it's `image_url`/`end_image_url`, not `start_image_url`/`tail_image_url`
//   like the endpoints above; fal.ai's own docs flag this as a common mixup)
// - Reframe (image-to-image, used only to fix O3's missing aspect_ratio
//   param — see reframeImage below): https://fal.ai/models/fal-ai/image-editing/reframe/api
//   (image_url required, aspect_ratio — 16:9/9:16/others — "intelligently
//   adjusts an image's aspect ratio while preserving the main subject's
//   position, composition, pose, and perspective"; ~$0.04/image per fal.ai's
//   published pricing)
const KLING_ELEMENTS_ENDPOINT = "fal-ai/kling-video/v1.6/standard/elements";
const KLING_STORYBOARD_ENDPOINT = "fal-ai/kling-video/v2.1/pro/image-to-video";
const KLING_O3_STANDARD_ENDPOINT = "fal-ai/kling-video/o3/standard/image-to-video";
const REFRAME_ENDPOINT = "fal-ai/image-editing/reframe";

const DEFAULT_DURATION_SECONDS = 5;
const DEFAULT_ASPECT_RATIO: VideoAspectRatio = "16:9";

// Kling O3 Standard's image-to-video endpoint (confirmed against fal.ai's
// docs, 2026-08-07) has no aspect_ratio parameter at all — unlike the
// elements/text-to-video endpoints below, it simply inherits whatever shape
// the input image already has. Real incident: a character's reference photo
// wasn't 16:9, so every O3 video came out pillarboxed in that photo's native
// shape no matter what the prompt asked for — there was no parameter
// anywhere in the request that could have fixed it. This reframes the
// reference photo itself to the target ratio first, using fal.ai's own tool
// built for exactly this ("preserving the main subject's position,
// composition, pose, and perspective" — not a plain crop, so it shouldn't
// undermine the character-consistency point of sending a reference photo in
// the first place). Costs an extra ~$0.04/generation; absorbed into the
// existing O3 credit weight rather than charged separately, same as any
// other cost of making a model actually work as advertised.
async function reframeImage(
  imageUrl: string,
  aspectRatio: VideoAspectRatio,
  apiKey: string,
): Promise<string> {
  const res = await fetchWithTimeout(
    `https://fal.run/${REFRAME_ENDPOINT}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify({ image_url: imageUrl, aspect_ratio: aspectRatio }),
    },
    60_000,
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal.ai (reframe) error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { images?: { url?: string }[] };
  const url = data.images?.[0]?.url;
  if (!url) throw new Error("fal.ai (reframe) response didn't include an image URL.");
  return url;
}

// Confirmed directly against fal.ai's docs, 2026-08-07: every Kling
// endpoint used here (1.6 text-to-video/elements, storyboard, O3) wants
// duration as a bare numeric string ("5", "10"). Veo 3.1 is the one
// exception — its schema wants an "s" suffix ("4s", "6s", "8s"); sending it
// the bare number is a documented common mistake (fal.ai's own docs call
// this out) and would just be silently ignored/rejected.
function formatDuration(modelId: string, seconds: number): string {
  return modelId === "veo" ? `${seconds}s` : String(seconds);
}

function extractVideoUrl(data: unknown): string | undefined {
  const d = data as Record<string, unknown> | undefined;
  const video = d?.video as Record<string, unknown> | undefined;
  const output = d?.output as Record<string, unknown> | undefined;
  const outputVideo = output?.video as Record<string, unknown> | undefined;
  return (
    (video?.url as string | undefined) ??
    (d?.video_url as string | undefined) ??
    (outputVideo?.url as string | undefined) ??
    (d?.url as string | undefined)
  );
}

// Real incident, 2026-08-07: this used to be one blocking POST to
// https://fal.run/{endpoint} with a 180s client-side timeout. Kling's own
// docs estimate ~6 minutes for a standard-tier text-to-video render, so that
// 180s timeout was aborting our side of the connection on every single
// generation — but aborting our fetch does NOT tell fal.ai's runner to stop;
// the job likely kept running (and billing) on their side while we silently
// threw the result away and immediately started a brand-new paid attempt.
// Three attempts of that in a row is exactly how a single request turns into
// several dollars of real charges for zero usable output.
//
// Switched to fal.ai's queue API (their own recommended pattern for
// anything long-running, confirmed against fal.ai's docs — not guessed):
// submit returns immediately with a request_id and status/cancel URLs, we
// poll status every few seconds instead of holding one connection open, and
// — critically — we can now actually tell fal.ai to cancel a job (via
// cancel_url) instead of just walking away from it. That's also what makes
// the Stop button's cancellation real for video instead of best-effort.
const POLL_INTERVAL_MS = 4_000;
const MAX_WAIT_MS = 10 * 60_000; // 10 minutes — comfortably above fal's own ~6m estimate

type QueueSubmitResponse = {
  request_id: string;
  status_url: string;
  response_url: string;
  cancel_url: string;
};

type QueueStatusResponse = {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  error?: string;
};

async function cancelQueueRequest(cancelUrl: string, apiKey: string): Promise<void> {
  try {
    await fetch(cancelUrl, { method: "PUT", headers: { authorization: `Key ${apiKey}` } });
  } catch {
    // Best effort — if this fails there's nothing more we can do from here,
    // and it must never mask whatever error/timeout triggered the cancel.
  }
}

function requireApiKey(): string {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    throw new Error(
      "FAL_KEY is not set. Add it to .env.local, or turn off the " +
        "'real_ai_providers' flag in Admin > Feature flags to use the mock pipeline.",
    );
  }
  return apiKey;
}

// Works out which fal.ai endpoint and request body a given set of options maps
// to, without submitting anything.
//
// Split out of generateVideo so the blocking path and the queued
// fire-and-poll path (submitVideoJob) share ONE definition of this routing.
// The branches below encode a lot of hard-won detail — which endpoints accept
// aspect_ratio, which need a reframed reference photo instead, which one
// blends a likeness into a new scene versus merely animating the input photo —
// and every one of those was a real bug at some point. Duplicating it for the
// queued path would guarantee the two drift.
async function buildVideoRequest(
  prompt: string,
  modelId: string,
  options: VideoGenerationOptions,
  apiKey: string,
): Promise<{ endpoint: string; body: Record<string, unknown>; label: string }> {
  const referenceImageUrls = (options.referenceImageUrls ?? []).filter(Boolean);
  const resolvedAspectRatio: VideoAspectRatio = options.aspectRatio ?? DEFAULT_ASPECT_RATIO;

  let endpoint: string;
  let body: Record<string, unknown>;
  let label: string;

  // Real incident, 2026-08-07, part 2: the first fix routed the baseline
  // single-photo case through Kling's plain image-to-video endpoint.
  // That endpoint has no aspect_ratio parameter at all — Kling just animates
  // the literal input photo, inheriting whatever shape and background that
  // photo already has — which is exactly why the result ignored the
  // requested 16:9 framing and the described makeup-station scene, and just
  // made the reference selfie itself move. The "elements" endpoint below
  // (already used for the 2-4 photo advanced multi-reference feature) is
  // built for the opposite job: blend a person's likeness into a NEW scene
  // described by the prompt, and it does take an aspect_ratio parameter
  // (default 16:9). fal.ai's own schema places no minimum on input_image_urls
  // beyond "required" — 1 image works the same way 2-4 do — so the baseline
  // single-photo anchor now shares this same endpoint instead of a
  // different one, just with a shorter image list.
  const anchorImages =
    referenceImageUrls.length > 0
      ? referenceImageUrls.slice(0, 4)
      : options.characterAnchorImageUrl && modelId === "kling"
        ? [options.characterAnchorImageUrl]
        : [];

  if (modelId === "kling-o3") {
    // O3 Standard's image-to-video endpoint has no text-to-video sibling
    // wired up here — image_url is required by fal.ai, no fallback. A
    // character with zero reference photos can't use this model; actions.ts
    // checks that before spending any credits, this is just a backstop.
    if (!options.characterAnchorImageUrl) {
      throw new Error(
        "Kling O3 needs the character to have a reference photo — add one in Character settings, or switch to Kling 1.6.",
      );
    }
    // O3 has no aspect_ratio parameter (see reframeImage above) — the only
    // lever available is the shape of the input image itself, so reframe the
    // reference photo to the resolved ratio before sending it. Best-effort:
    // if the reframe call itself fails, fall back to the original photo
    // rather than failing the whole video generation over a framing nicety.
    let o3ImageUrl = options.characterAnchorImageUrl;
    try {
      o3ImageUrl = await reframeImage(options.characterAnchorImageUrl, resolvedAspectRatio, apiKey);
    } catch {
      // Original photo it is — same behavior as before this fix existed.
    }
    endpoint = KLING_O3_STANDARD_ENDPOINT;
    body = {
      prompt,
      image_url: o3ImageUrl,
      generate_audio: options.generateNativeAudio ?? true,
      duration: formatDuration(modelId, options.durationSeconds ?? DEFAULT_DURATION_SECONDS),
      ...(options.endImageUrl ? { end_image_url: options.endImageUrl } : {}),
    };
    label = "Kling O3";
  } else if (options.startImageUrl || options.endImageUrl) {
    // Storyboard — image-to-video requires a start frame; if only an end
    // frame was supplied, use it as the start frame too rather than failing
    // outright (still gives Kling something concrete to anchor the scene to).
    // Explicit user choice (Elite-only advanced option), so it takes
    // priority over the automatic baseline anchor below.
    //
    // Note: this endpoint (v2.1 pro image-to-video) has no aspect_ratio
    // parameter either — same class of gap as O3, just not fixed here.
    // Not reframing the start/end frames the way O3's reference photo is
    // reframed above, since this path always uses photos the user picked
    // specifically as a start/end frame — silently altering their framing
    // felt like the wrong default. Worth revisiting if this becomes a
    // real complaint the way O3's did.
    endpoint = KLING_STORYBOARD_ENDPOINT;
    body = {
      prompt,
      image_url: options.startImageUrl ?? options.endImageUrl,
      duration: formatDuration(modelId, options.durationSeconds ?? DEFAULT_DURATION_SECONDS),
      ...(options.endImageUrl ? { tail_image_url: options.endImageUrl } : {}),
    };
    label = "Kling (storyboard)";
  } else if (anchorImages.length > 0) {
    // Multi-image reference (2-4, Elite advanced option) and the baseline
    // single-photo identity anchor (every plan, automatic) both land here —
    // same endpoint, same behavior, just a different-length image list.
    endpoint = KLING_ELEMENTS_ENDPOINT;
    body = {
      prompt,
      input_image_urls: anchorImages,
      aspect_ratio: resolvedAspectRatio,
      duration: formatDuration(modelId, options.durationSeconds ?? DEFAULT_DURATION_SECONDS),
      // Pushes back on the clip opening as a frozen copy of the reference
      // photo before anything happens.
      //
      // This endpoint is Elements IMAGE-TO-VIDEO: fal's own description says
      // the input images are supplied "in the order they should appear in the
      // video". With a single photo that photo is literally frame one, so
      // every clip began with the character held in exactly the pose they were
      // photographed in, and only then started moving. In multi-angle it was
      // worse — three angles sharing one first frame all opened identically,
      // because a camera instruction can't apply to a frame that's already
      // decided.
      //
      // The endpoint's default is "blur, distort, and low quality"; those are
      // kept and the static-opening terms added. This softens the effect
      // rather than removing it — the only complete fix is to stop handing
      // the raw photo in as frame one (see MOBILE_APP-style notes in the
      // pipeline, and the per-angle start frame idea).
      negative_prompt:
        "blur, distort, and low quality, static posed portrait, frozen first frame, " +
        "motionless opening shot, subject standing still facing camera",
    };
    label = anchorImages.length > 1 ? "Kling (multi-image reference)" : "Kling (character reference)";
  } else {
    // No character photo available at all (character has none saved) —
    // falls back to blind text-to-video, same as before this fix existed.
    // Both Kling 1.6 text-to-video and Veo 3.1 (the only two models that can
    // land here) have their own real aspect_ratio parameter, confirmed
    // against fal.ai's docs — unlike O3/storyboard above, no workaround
    // needed for this path.
    const model = getVideoModel(modelId);
    endpoint = model.falEndpoint;
    body = {
      prompt,
      aspect_ratio: resolvedAspectRatio,
      duration: formatDuration(modelId, options.durationSeconds ?? DEFAULT_DURATION_SECONDS),
    };
    label = model.name;
  }

  return { endpoint, body, label };
}

// ---------------------------------------------------------------------------
// Queue primitives
//
// These exist so a caller can start a job and walk away. The blocking helpers
// further down (generateVideo, generateSpeech, lipSyncVideo) are written on
// top of them and keep their original behaviour, but the orchestrator in
// lib/generations/job-runner.ts uses these directly: it submits, stores the
// returned handle in generation_jobs, and returns. Later polls each do a
// single fast status check.
//
// This is what removes the 300s ceiling. Nothing has to stay alive for the
// ten-plus minutes a Kling render with dialogue can take, because fal.ai is
// holding the work and we're only ever asking "done yet?".
// ---------------------------------------------------------------------------

export type QueuedJob = {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string;
  label: string;
};

export type QueuedJobState =
  | { state: "pending" }
  | { state: "completed" }
  | { state: "failed"; error: string };

// Where fal should POST when a job finishes, if we can work out a public URL.
//
// This is what makes completion independent of anyone's browser. Polling still
// runs while someone is watching (it updates the UI faster than a webhook
// round trip), but the webhook is the thing that guarantees a finished render
// is actually collected — including at 3am with every tab closed.
//
// Returns null in local development, where fal can't reach localhost. Polling
// covers that case, which is why this is best-effort rather than required.
function webhookUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base || base.includes("localhost") || base.includes("127.0.0.1")) return null;
  return `${base.replace(/\/$/, "")}/api/webhooks/fal`;
}

async function submitToQueue(
  endpoint: string,
  body: Record<string, unknown>,
  label: string,
  apiKey: string,
): Promise<QueuedJob> {
  const hook = webhookUrl();
  const submitUrl = hook
    ? `https://queue.fal.run/${endpoint}?fal_webhook=${encodeURIComponent(hook)}`
    : `https://queue.fal.run/${endpoint}`;

  const submitRes = await fetchWithTimeout(
    submitUrl,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Key ${apiKey}` },
      body: JSON.stringify(body),
    },
    30_000, // just queuing the job — this itself should be fast
  );

  if (!submitRes.ok) {
    const text = await submitRes.text();
    throw new Error(`fal.ai (${label}) error (${submitRes.status}): ${text.slice(0, 300)}`);
  }

  const submitted = (await submitRes.json()) as QueueSubmitResponse;
  if (!submitted.status_url || !submitted.response_url) {
    throw new Error(`fal.ai (${label}) queue response was missing status/result URLs.`);
  }

  return {
    requestId: submitted.request_id,
    statusUrl: submitted.status_url,
    responseUrl: submitted.response_url,
    cancelUrl: submitted.cancel_url,
    label,
  };
}

export async function submitVideoJob(
  prompt: string,
  modelId: string,
  options: VideoGenerationOptions = {},
): Promise<QueuedJob> {
  const apiKey = requireApiKey();
  const { endpoint, body, label } = await buildVideoRequest(prompt, modelId, options, apiKey);
  return submitToQueue(endpoint, body, label, apiKey);
}

export async function submitSpeechJob(text: string, elevenLabsVoiceId: string): Promise<QueuedJob> {
  return submitToQueue(
    ELEVENLABS_TTS_ENDPOINT,
    { text, voice: elevenLabsVoiceId },
    "ElevenLabs TTS",
    requireApiKey(),
  );
}

export async function submitLipSyncJob(videoUrl: string, audioUrl: string): Promise<QueuedJob> {
  return submitToQueue(
    SYNC_LIPSYNC_ENDPOINT,
    { video_url: videoUrl, audio_url: audioUrl },
    "Sync Lipsync",
    requireApiKey(),
  );
}

// One status check. Never throws on a job-level failure — a job that failed on
// fal's side comes back as { state: "failed" } so the caller can record a real
// error against the generation. Only genuine transport problems throw, because
// those are worth retrying on the next poll rather than failing the job.
export async function checkQueuedJob(job: QueuedJob): Promise<QueuedJobState> {
  const apiKey = requireApiKey();
  const res = await fetchWithTimeout(
    job.statusUrl,
    { headers: { authorization: `Key ${apiKey}` } },
    15_000,
  );

  if (!res.ok) {
    const text = await res.text();
    // 4xx here means the request id is gone or malformed — that won't heal, so
    // treat it as terminal. 5xx is fal having a moment; let the next poll retry.
    if (res.status >= 400 && res.status < 500) {
      return {
        state: "failed",
        error: `fal.ai (${job.label}) lost track of this job (${res.status}): ${text.slice(0, 200)}`,
      };
    }
    throw new Error(`fal.ai (${job.label}) status check error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as QueueStatusResponse;
  if (data.status === "COMPLETED") return { state: "completed" };
  if (data.error) return { state: "failed", error: `fal.ai (${job.label}): ${data.error}` };
  return { state: "pending" };
}

async function fetchQueuedResult(job: QueuedJob): Promise<unknown> {
  const apiKey = requireApiKey();
  const res = await fetchWithTimeout(
    job.responseUrl,
    { headers: { authorization: `Key ${apiKey}` } },
    30_000,
  );
  const data = await res.json();
  if (!res.ok) {
    const errorMessage = (data as { error?: string } | null)?.error;
    throw new Error(
      `fal.ai (${job.label}) error (${res.status}): ${errorMessage ?? JSON.stringify(data).slice(0, 300)}`,
    );
  }
  return data;
}

export async function fetchQueuedVideoUrl(job: QueuedJob): Promise<string> {
  const url = extractVideoUrl(await fetchQueuedResult(job));
  if (!url) throw new Error(`fal.ai (${job.label}) response didn't include a video URL.`);
  return url;
}

export async function fetchQueuedAudioUrl(job: QueuedJob): Promise<string> {
  const url = extractAudioUrl(await fetchQueuedResult(job));
  if (!url) throw new Error(`fal.ai (${job.label}) response didn't include an audio URL.`);
  return url;
}

// Best effort, and deliberately never throws — this is called from cancel and
// cleanup paths where failing to reach fal must not mask the original reason
// we were cancelling.
export async function cancelQueuedJob(job: Pick<QueuedJob, "cancelUrl">): Promise<void> {
  if (!job.cancelUrl) return;
  await cancelQueueRequest(job.cancelUrl, process.env.FAL_KEY ?? "");
}

// Blocking video generation — submit, then hold the connection open polling
// until it finishes.
//
// Retained for the paths that genuinely are short and synchronous, and as a
// fallback, but note this is the shape that caused the original problem: it
// can run for ten minutes, which no serverless function is allowed to do on
// the Hobby plan. New code should use submitVideoJob + checkQueuedJob.
export async function generateVideo(
  prompt: string,
  modelId: string,
  options: VideoGenerationOptions = {},
  checkCancelled?: () => Promise<boolean>,
): Promise<string> {
  const job = await submitVideoJob(prompt, modelId, options);
  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      await cancelQueuedJob(job);
      throw new Error(
        `fal.ai (${job.label}) didn't finish within ${Math.round(MAX_WAIT_MS / 60_000)} minutes — cancelled it.`,
      );
    }

    if (await checkCancelled?.()) {
      await cancelQueuedJob(job);
      throw new Error("__cancelled__");
    }

    const state = await checkQueuedJob(job);
    if (state.state === "completed") break;
    if (state.state === "failed") throw new Error(state.error);

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return fetchQueuedVideoUrl(job);
}

// Character dialogue — speech generation + lip-sync. Both run on the same
// FAL_KEY as everything else above (fal.ai fronts ElevenLabs and Sync Labs
// too), so this needed no new vendor account or secret.
//
// Confirmed directly against fal.ai's published schemas, not guessed:
// - TTS: https://fal.ai/models/fal-ai/elevenlabs/tts/eleven-v3/api
//   (text, voice — voice is an ElevenLabs voice_id string; returns { audio: { url } })
// - Lipsync: https://fal.ai/models/fal-ai/sync-lipsync/v2/pro/api
//   (video_url, audio_url; returns { video: { url } })
const ELEVENLABS_TTS_ENDPOINT = "fal-ai/elevenlabs/tts/eleven-v3";
const SYNC_LIPSYNC_ENDPOINT = "fal-ai/sync-lipsync/v2/pro";

function extractAudioUrl(data: unknown): string | undefined {
  const d = data as Record<string, unknown> | undefined;
  const audio = d?.audio as Record<string, unknown> | undefined;
  return (audio?.url as string | undefined) ?? (d?.audio_url as string | undefined);
}

// Generates spoken audio for a character's dialogue line using a specific,
// admin-picked ElevenLabs voice_id (see voice_presets table — never a named
// "default" voice, those are being retired by ElevenLabs at the end of 2026).
export async function generateSpeech(text: string, elevenLabsVoiceId: string): Promise<string> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    throw new Error(
      "FAL_KEY is not set. Add it to .env.local, or turn off the " +
        "'real_ai_providers' flag in Admin > Feature flags to use the mock pipeline.",
    );
  }

  const res = await fetchWithTimeout(
    `https://fal.run/${ELEVENLABS_TTS_ENDPOINT}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify({ text, voice: elevenLabsVoiceId }),
    },
    60_000,
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`fal.ai (ElevenLabs TTS) error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const url = extractAudioUrl(data);
  if (!url) throw new Error("fal.ai (ElevenLabs TTS) response didn't include an audio URL.");
  return url;
}

// Merges the generated speech audio into the generated video so the
// character's mouth actually matches what they're saying, rather than the
// audio just playing underneath a silent clip.
export async function lipSyncVideo(videoUrl: string, audioUrl: string): Promise<string> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    throw new Error(
      "FAL_KEY is not set. Add it to .env.local, or turn off the " +
        "'real_ai_providers' flag in Admin > Feature flags to use the mock pipeline.",
    );
  }

  const res = await fetchWithTimeout(
    `https://fal.run/${SYNC_LIPSYNC_ENDPOINT}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify({ video_url: videoUrl, audio_url: audioUrl }),
    },
    120_000,
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`fal.ai (Sync Lipsync) error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const url = extractVideoUrl(data);
  if (!url) throw new Error("fal.ai (Sync Lipsync) response didn't include a video URL.");
  return url;
}

// Account balance — for the "AI provider funds" card on Admin > Stats.
// Confirmed against fal.ai's published Platform API docs
// (https://fal.ai/docs/platform-apis/v1/account/billing, 2026-08-09):
// GET https://api.fal.ai/v1/account/billing?expand=credits, same
// `authorization: Key <key>` header style as every other call in this file.
// One real wrinkle: that endpoint's docs list its security scheme as
// "adminApiKey" specifically — fal.ai lets a key be scoped to admin/account
// access or not when it's created in their dashboard, separate from whether
// it can run models. FAL_KEY here is whatever key was set up for generation
// calls, so this may 401/403 if that particular key wasn't given admin
// scope — that's a real, expected outcome (not a bug), surfaced to the
// caller as `ok: false` with a reason rather than thrown, so a scope
// mismatch on one provider never breaks the whole stats page. Never throws.
export type FalAccountBalance =
  | { ok: true; balance: number; currency: string }
  | { ok: false; reason: string };

export async function getFalAccountBalance(): Promise<FalAccountBalance> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    return { ok: false, reason: "FAL_KEY is not set." };
  }

  try {
    const res = await fetchWithTimeout(
      "https://api.fal.ai/v1/account/billing?expand=credits",
      { headers: { authorization: `Key ${apiKey}` } },
      8_000,
    );

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          reason: "This key isn't scoped for account/billing access on fal.ai.",
        };
      }
      const errText = await res.text();
      return { ok: false, reason: `fal.ai billing API error (${res.status}): ${errText.slice(0, 200)}` };
    }

    const data = await res.json();
    const balance = data?.credits?.current_balance;
    const currency = data?.credits?.currency;
    if (typeof balance !== "number" || typeof currency !== "string") {
      return { ok: false, reason: "fal.ai billing response didn't include a credit balance." };
    }
    return { ok: true, balance, currency };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Request failed." };
  }
}
