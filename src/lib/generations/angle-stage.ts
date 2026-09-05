"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { mediaUrl } from "@/lib/media/url";
import { persistImageBytes, latestMonthlyAnniversary } from "@/lib/generations/core";
import { providerDownloadUrl } from "@/lib/generations/providers/provider-url";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";
import {
  angleStageEligible,
  ANGLE_STAGE_MONTHLY_LIMITS,
  MAX_STAGE_FRAMES_PER_TAKE,
  stageProxyPath,
  stageFramesPrefix,
} from "@/lib/generations/angle-stage-config";
import type { PlanId } from "@/lib/plans";

// The Angle Stage's server half (2026-09-05). Two submit/poll pairs — the
// 3D proxy and the guided angle re-render — both through fal's queue API,
// because a Hunyuan3D proxy takes ~3 minutes and a Seedream edit ~30s:
// far past what one server action invocation should hold open. Each poll
// call is short; the CLIENT owns the waiting.
//
// The VIDEO leg deliberately has no code here: the stage hands its two
// frames to runGeneration as storyboard_start_path / storyboard_end_path
// (relative /api/media capability URLs, which resolveMaybeSignedUrl already
// accepts), so the quote, the charge, the refund rules, identity scoring
// and History treat a staged render as what it is — a normal take on the
// frames lane.

const HUNYUAN_ENDPOINT = "fal-ai/hunyuan3d/v2";
const SEEDREAM_EDIT_ENDPOINT = "fal-ai/bytedance/seedream/v4/edit";
const MAX_PROXY_BYTES = 40 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 3 * 1024 * 1024;

// Poll targets come back from the client, but are refetched only when they
// are provably fal's own queue host talking about a single request — never
// an arbitrary URL (same SSRF stance as resolveMaybeSignedUrl). Auth rides
// our key, so the worst a forged id can reach is this account's own queue.
const QUEUE_URL_RE = /^https:\/\/queue\.fal\.run\/[a-z0-9._\-/]+\/requests\/[a-z0-9-]+(\/status)?$/i;

type StageJobHandle = { requestId: string; statusUrl: string; responseUrl: string };

async function submitToQueue(endpoint: string, input: unknown): Promise<StageJobHandle | { error: string }> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) return { error: "FAL_KEY is missing — add it to .env.local first." };
  const res = await fetchWithTimeout(
    `https://queue.fal.run/${endpoint}`,
    {
      method: "POST",
      headers: { authorization: `Key ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(input),
    },
    30_000,
  );
  if (!res.ok) {
    console.error(`angle-stage submit ${endpoint} failed:`, res.status, (await res.text()).slice(0, 300));
    return { error: "The studio couldn't start that — try again in a moment." };
  }
  const job = (await res.json()) as { request_id?: string; status_url?: string; response_url?: string };
  if (!job.request_id || !QUEUE_URL_RE.test(job.status_url ?? "") || !QUEUE_URL_RE.test(job.response_url ?? "")) {
    return { error: "The studio couldn't start that — try again in a moment." };
  }
  return { requestId: job.request_id, statusUrl: job.status_url!, responseUrl: job.response_url! };
}

async function pollQueue(
  handle: StageJobHandle,
): Promise<{ state: "working" } | { state: "done"; result: unknown } | { state: "failed" }> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) return { state: "failed" };
  if (!QUEUE_URL_RE.test(handle.statusUrl) || !QUEUE_URL_RE.test(handle.responseUrl)) {
    return { state: "failed" };
  }
  const auth = { authorization: `Key ${apiKey}` };
  const statusRes = await fetchWithTimeout(handle.statusUrl, { headers: auth }, 15_000);
  if (!statusRes.ok) return { state: "working" };
  const status = (await statusRes.json()) as { status?: string };
  if (status.status === "COMPLETED") {
    const res = await fetchWithTimeout(handle.responseUrl, { headers: auth }, 20_000);
    if (!res.ok) return { state: "failed" };
    return { state: "done", result: await res.json() };
  }
  if (status.status === "FAILED" || status.status === "CANCELLED") return { state: "failed" };
  return { state: "working" };
}

// The take being staged, with everything the page needs in one round trip.
// The still is the identity/style truth: an image take's result, or a video
// take's saved poster frame.
export async function getAngleStage(generationId: string): Promise<
  | { error: string }
  | {
      error: null;
      stillUrl: string;
      promptInput: string;
      characterProfileId: string | null;
      proxyUrl: string | null;
      frames: { path: string; url: string }[];
      framesLimit: number;
      eligible: boolean;
      stagedThisMonth: number;
      monthlyLimit: number;
    }
> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const { data: gen } = await supabase
    .from("generations")
    .select("id, user_id, content_type, status, result_url, poster_url, prompt_input, character_profile_id")
    .eq("id", generationId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!gen || gen.status !== "succeeded") {
    return { error: "That take can't be staged — it must be one of your own finished takes." };
  }
  const stillUrl = gen.content_type === "image" ? gen.result_url : gen.poster_url;
  if (!stillUrl || !stillUrl.startsWith("/api/media/")) {
    return {
      error:
        gen.content_type === "video"
          ? "This video doesn't have its still frame saved yet — it arrives within a day of rendering."
          : "That take can't be staged — it must be one of your own finished takes.",
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, role, current_period_start")
    .eq("id", userData.user.id)
    .single();
  const plan = (profile?.plan ?? "none") as PlanId;
  const isAdmin = profile?.role === "admin";

  const admin = createAdminClient();
  const userId = userData.user.id;

  const proxyPath = stageProxyPath(userId, generationId);
  const { data: proxyList } = await admin.storage
    .from("generated-videos")
    .list(`${userId}/proxies`, { limit: 100 });
  const proxyExists = (proxyList ?? []).some((f) => f.name === `${generationId}.glb`);

  const periodStart = profile?.current_period_start
    ? latestMonthlyAnniversary(new Date(profile.current_period_start as string))
    : (() => {
        const d = new Date();
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        return d;
      })();
  const stagedThisMonth = (proxyList ?? []).filter(
    (f) => f.created_at && new Date(f.created_at) >= periodStart,
  ).length;

  const { data: frameList } = await admin.storage
    .from("generated-images")
    .list(stageFramesPrefix(userId, generationId), { limit: MAX_STAGE_FRAMES_PER_TAKE + 5 });
  const frames = (frameList ?? [])
    .filter((f) => f.name.endsWith(".jpg"))
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))
    .map((f) => {
      const path = `${stageFramesPrefix(userId, generationId)}/${f.name}`;
      return { path, url: mediaUrl("generated-images", path) };
    });

  return {
    error: null,
    stillUrl,
    promptInput: gen.prompt_input ?? "",
    characterProfileId: (gen.character_profile_id as string | null) ?? null,
    proxyUrl: proxyExists ? mediaUrl("generated-videos", proxyPath) : null,
    frames,
    framesLimit: MAX_STAGE_FRAMES_PER_TAKE,
    eligible: angleStageEligible(plan, isAdmin),
    stagedThisMonth,
    // -1 = unlimited (admin). Infinity would not survive the server→client
    // serialization boundary — it arrives as null.
    monthlyLimit: isAdmin ? -1 : ANGLE_STAGE_MONTHLY_LIMITS[plan],
  };
}

// Start building the 3D proxy for a take. The upload of the finished GLB is
// what spends the monthly slot — a submit that never completes costs the cap
// nothing, and re-staging an already-proxied take reuses the file free.
export async function createAngleProxy(
  generationId: string,
): Promise<{ error: string } | { error: null; handle: StageJobHandle }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const stage = await getAngleStage(generationId);
  if (stage.error !== null) return { error: stage.error };
  if (!stage.eligible) {
    return { error: "The Angle Stage is part of the Studio and Elite plans — upgrade to stage your takes." };
  }
  if (stage.proxyUrl) return { error: "This take already has its stage — reload the page." };
  if (stage.monthlyLimit >= 0 && stage.stagedThisMonth >= stage.monthlyLimit) {
    return {
      error: `You've staged ${stage.stagedThisMonth} takes this billing month — the limit on your plan. It resets with your billing period.`,
    };
  }
  // Burst brake on top of the monthly cap: proxies are the expensive call,
  // and the cap check above is read-then-act (no counter row to reserve —
  // the GLB itself is the record), so this bounds what a same-instant burst
  // could slip past it. Fails closed like every other limiter.
  if (await rateLimited(userData.user.id, "angle-stage-proxy", 60 * 60, 4)) {
    return { error: "You're staging quickly — give it a minute and try again." };
  }

  return submitToQueue(HUNYUAN_ENDPOINT, {
    input_image_url: providerDownloadUrl(stage.stillUrl),
    textured_mesh: true,
  }).then((r) => ("error" in r ? r : { error: null as null, handle: r }));
}

// One poll tick for the proxy job; on completion the GLB lands in storage
// and the stable media URL comes back.
export async function pollAngleProxy(
  generationId: string,
  handle: StageJobHandle,
): Promise<{ error: string } | { error: null; state: "working" } | { error: null; state: "done"; proxyUrl: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };
  const userId = userData.user.id;

  const polled = await pollQueue(handle);
  if (polled.state === "working") return { error: null, state: "working" };
  if (polled.state === "failed") {
    return { error: "The 3D proxy couldn't be built from this take — try a different one." };
  }

  const mesh = (polled.result as { model_mesh?: { url?: string; file_size?: number } }).model_mesh;
  if (!mesh?.url) return { error: "The 3D proxy couldn't be built from this take — try a different one." };
  if ((mesh.file_size ?? 0) > MAX_PROXY_BYTES) {
    return { error: "That proxy came out too large to store — try a simpler take." };
  }
  const glbRes = await fetchWithTimeout(mesh.url, {}, 45_000);
  if (!glbRes.ok) return { error: "The 3D proxy couldn't be fetched — try again." };
  const bytes = Buffer.from(await glbRes.arrayBuffer());
  if (bytes.byteLength > MAX_PROXY_BYTES) {
    return { error: "That proxy came out too large to store — try a simpler take." };
  }

  const path = stageProxyPath(userId, generationId);
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from("generated-videos")
    .upload(path, bytes, { contentType: "model/gltf-binary", upsert: false });
  if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) {
    console.error("angle-stage proxy upload failed:", uploadError.message);
    return { error: "Couldn't save the proxy — try again." };
  }
  return { error: null, state: "done", proxyUrl: mediaUrl("generated-videos", path) };
}

// Start re-rendering one picked angle: the client's proxy snapshot guides
// the composition, the take's own still carries identity and style. The
// prompt is built HERE, from the take's stored prompt — a client-authored
// prompt would let the guided re-render drift from the take it claims to
// re-shoot.
export async function renderAngleFrame(
  generationId: string,
  snapshotDataUri: string,
): Promise<{ error: string } | { error: null; handle: StageJobHandle }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(snapshotDataUri)) {
    return { error: "That angle couldn't be read — try saving it again." };
  }
  if (snapshotDataUri.length > MAX_SNAPSHOT_BYTES * 1.4) {
    return { error: "That snapshot is too large — try again." };
  }

  const stage = await getAngleStage(generationId);
  if (stage.error !== null) return { error: stage.error };
  if (!stage.eligible) {
    return { error: "The Angle Stage is part of the Studio and Elite plans — upgrade to stage your takes." };
  }
  if (stage.frames.length >= stage.framesLimit) {
    return {
      error: `This take already has its ${stage.framesLimit} full-quality angles — pick your start and end from those.`,
    };
  }
  if (await rateLimited(userData.user.id, "angle-stage-frame", 60 * 10, 8)) {
    return { error: "You're rendering angles quickly — give it a moment." };
  }

  const scene = stage.promptInput.trim().slice(0, 400);
  return submitToQueue(SEEDREAM_EDIT_ENDPOINT, {
    prompt:
      "Recreate the scene from image 2 at exactly the camera angle, subject pose and composition of image 1. " +
      "Image 1 is a rough 3D sketch of the same scene — follow its framing precisely, but take every detail of " +
      "the subject's face, hair, clothing, lighting and background from image 2. Photorealistic cinematic film " +
      "still, same color grade as image 2." +
      (scene ? ` The scene: ${scene}` : ""),
    image_urls: [snapshotDataUri, providerDownloadUrl(stage.stillUrl)],
    image_size: "landscape_16_9",
  }).then((r) => ("error" in r ? r : { error: null as null, handle: r }));
}

// One poll tick for an angle re-render; on completion the frame is persisted
// next to the take's other stage frames and its capability URL comes back —
// the exact value the composer's frames lane accepts as a storyboard path.
export async function pollAngleFrame(
  generationId: string,
  handle: StageJobHandle,
): Promise<
  | { error: string }
  | { error: null; state: "working" }
  | { error: null; state: "done"; frame: { path: string; url: string } }
> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };
  const userId = userData.user.id;

  const polled = await pollQueue(handle);
  if (polled.state === "working") return { error: null, state: "working" };
  if (polled.state === "failed") {
    return { error: "That angle couldn't be re-rendered — try a slightly different one." };
  }
  const image = (polled.result as { images?: { url?: string }[] }).images?.[0];
  if (!image?.url) return { error: "That angle couldn't be re-rendered — try a slightly different one." };

  const imgRes = await fetchWithTimeout(image.url, {}, 30_000);
  if (!imgRes.ok) return { error: "That angle couldn't be fetched — try again." };
  const bytes = new Uint8Array(await imgRes.arrayBuffer());

  const admin = createAdminClient();
  const path = `${stageFramesPrefix(userId, generationId)}/${crypto.randomUUID()}.jpg`;
  const url = await persistImageBytes(admin, userId, path, bytes, imgRes.headers.get("content-type") ?? "image/jpeg");
  return { error: null, state: "done", frame: { path, url } };
}
