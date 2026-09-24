"use server";

import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { ContentPolicyRefusal } from "@/lib/generations/content-policy";
import { checkGenerationAllowance, consumeBonusCredits, consumePurchasedCredits } from "@/lib/generations/core";
import { refundGenerationCosts } from "@/lib/generations/job-runner";
import { isRepeatReservation } from "@/lib/generations/repeat-send";
import { judgeRender, OutputPolicyRefusal } from "@/lib/generations/output-policy";
import { gatePrompt, recordPolicyRefusal } from "@/lib/generations/policy-log";
import { mediaStoragePath, mediaUrl, toMediaUrl } from "@/lib/media/url";
import { isLiveEnabled, isLiveOpenToPlans, liveAllowed } from "./enabled";
import {
  isLiveLength,
  LIVE_ASPECTS,
  LIVE_DIRECTION_MAX,
  LIVE_LABEL,
  LIVE_MODEL_ID,
  LIVE_PROMPT_MAX,
  LIVE_RESOLUTIONS,
  liveConfigureMessage,
  newLiveMeter,
  readLiveMeter,
  type LiveAspect,
  type LiveErrorCode,
  type LiveResolution,
} from "./live";
import { LIVE_ROW_COLUMNS, liveLogStep, settleLiveTake, sweepLiveTakes, type LiveRow } from "./store";

// Live's server actions (2026-09-24). A take's life:
//
//   startLiveTake       judge the words, charge the whole paid length, write
//                       the row with its meter, and hand the page the opening
//                       message it sends fal once the session is up;
//   checkLiveDirection  judge each direction BEFORE the page sends it — the
//                       directions travel peer to peer to fal's runner and
//                       never pass through us, so this is where they are read;
//   stopLiveTake        settle: charge the seconds it ran, refund the rest;
//   reserveLiveRecording / keepLiveRecording
//                       the page's own recording of the stream (fal keeps no
//                       file), uploaded straight to storage, judged by the
//                       output gate like every other render, then kept.
//
// The relay (app/api/live/relay) stamps the session and the heartbeats.

type Failure = { error: string; code: LiveErrorCode };
const fail = (code: LiveErrorCode, error: string): Failure => ({ error, code });

const RECORDING_BUCKET = "generated-videos";
const RECORDING_MAX_BYTES = 100 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 60 * 60 * 24;

async function signedIn() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

async function ownTake(userId: string, takeId: unknown): Promise<LiveRow | null> {
  if (typeof takeId !== "string" || !UUID.test(takeId)) return null;
  const { data } = await createAdminClient()
    .from("generations")
    .select(LIVE_ROW_COLUMNS)
    .eq("id", takeId)
    .eq("user_id", userId)
    .eq("model_id", LIVE_MODEL_ID)
    .maybeSingle<LiveRow>();
  return data ?? null;
}

export type LiveStart = {
  error: null;
  takeId: string;
  paidSeconds: number;
  paidCredits: number;
  configure: ReturnType<typeof liveConfigureMessage>;
};

/** The picture a take opens on: a character's photo, or one of the person's own finished stills (a Helios shot). */
async function openingImage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  input: { characterId?: unknown; photoPath?: unknown; fromId?: unknown },
): Promise<{ url: string | null; characterId: string | null; from: string | null } | Failure> {
  const admin = createAdminClient();
  if (typeof input.fromId === "string" && input.fromId) {
    if (!UUID.test(input.fromId)) return fail("badImage", "That picture couldn't be found.");
    const { data: still } = await supabase
      .from("generations")
      .select("id, result_url")
      .eq("id", input.fromId)
      .eq("user_id", userId)
      .eq("content_type", "image")
      .eq("status", "succeeded")
      .is("deleted_at", null)
      .maybeSingle<{ id: string; result_url: string | null }>();
    const stored = mediaStoragePath(toMediaUrl(still?.result_url ?? null));
    if (!still || !stored) return fail("badImage", "That picture couldn't be found.");
    const { data } = await admin.storage.from(stored.bucket).createSignedUrl(stored.path, DAY);
    if (!data?.signedUrl) return fail("badImage", "That picture couldn't be found.");
    return { url: data.signedUrl, characterId: null, from: still.id };
  }
  if (typeof input.characterId === "string" && input.characterId) {
    if (!UUID.test(input.characterId)) return fail("badImage", "Couldn't find that character.");
    const { data: character } = await supabase
      .from("character_profiles")
      .select("id, reference_image_urls")
      .eq("id", input.characterId)
      .eq("user_id", userId)
      .maybeSingle<{ id: string; reference_image_urls: string[] | null }>();
    const photos = character?.reference_image_urls ?? [];
    if (!character || photos.length === 0) return fail("badImage", "Couldn't find that character.");
    const chosen = typeof input.photoPath === "string" && photos.includes(input.photoPath) ? input.photoPath : photos[0];
    const { data } = await admin.storage.from("character-references").createSignedUrl(chosen, DAY);
    if (!data?.signedUrl) return fail("badImage", "Couldn't find that character.");
    return { url: data.signedUrl, characterId: character.id, from: null };
  }
  return { url: null, characterId: null, from: null };
}

export async function startLiveTake(input: {
  sendId: string;
  length: number;
  resolution: string;
  aspect: string;
  prompt: string;
  characterId?: string | null;
  photoPath?: string | null;
  fromId?: string | null;
}): Promise<LiveStart | Failure> {
  const { supabase, user } = await signedIn();
  if (!user) return fail("signedOut", "Your session expired — please log in again.");
  const userId = user.id;
  const { data: profile } = await supabase.from("profiles").select("plan, role, status").eq("id", userId).maybeSingle();
  const access = liveAllowed(profile, profile?.role === "admin" || (await isLiveOpenToPlans(supabase)));
  if (access.error) return fail(access.code ?? "needsPlan", access.error);
  if (!(await isLiveEnabled(supabase))) return fail("off", "Live is switched off for the moment.");

  if (typeof input?.sendId !== "string" || !UUID.test(input.sendId)) return fail("couldntStart", "Couldn't start this take — try again.");
  if (!isLiveLength(input.length)) return fail("couldntStart", "Couldn't start this take — try again.");
  const resolution: LiveResolution = (LIVE_RESOLUTIONS as readonly string[]).includes(input.resolution) ? (input.resolution as LiveResolution) : "768p";
  const aspect: LiveAspect = (LIVE_ASPECTS as readonly string[]).includes(input.aspect) ? (input.aspect as LiveAspect) : "16:9";
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return fail("noPrompt", "Describe the opening of the take first.");
  if (prompt.length > LIVE_PROMPT_MAX) return fail("noPrompt", `Keep the opening under ${LIVE_PROMPT_MAX} characters.`);

  const admin = createAdminClient();

  // The same press delivered twice (repeat-send.ts): the second finds the
  // first's row by its id and follows it, as long as it has not opened yet —
  // its words judged like any start's (review, 2026-09-24: this branch used
  // to hand back an opening nobody had read).
  const follow = async (existing: LiveRow): Promise<LiveStart | Failure> => {
    const meter = readLiveMeter(existing.live);
    if (!meter || meter.settledAt !== null || meter.sessionId !== null || meter.openingAt !== null || existing.status !== "generating") {
      return fail("couldntStart", "Couldn't start this take — try again.");
    }
    const image = await openingImage(supabase, userId, input);
    if ("code" in image) return image;
    try {
      await gatePrompt({ prompt, userId, hasRealPersonReference: meter.withImage });
    } catch (err) {
      if (err instanceof ContentPolicyRefusal) return fail("refused", err.userMessage);
      throw err;
    }
    return {
      error: null,
      takeId: existing.id,
      paidSeconds: meter.paidSeconds,
      paidCredits: meter.paidCredits,
      configure: liveConfigureMessage({ prompt, resolution: meter.resolution, aspect: meter.aspect, imageUrl: image.url }),
    };
  };
  const existing = await ownTake(userId, input.sendId);
  if (existing) return follow(existing);

  if (await rateLimited(userId, "live-start", 3600, access.isAdmin ? 60 : 12)) {
    return fail("tooFast", "You're generating a bit fast — wait a few seconds and try again.");
  }

  // One take at a time: whatever was left open settles first, and a take
  // still running refuses a second.
  await sweepLiveTakes(admin, userId);
  const { data: open } = await admin
    .from("generations")
    .select("id, live")
    .eq("user_id", userId)
    .eq("model_id", LIVE_MODEL_ID)
    .eq("status", "generating")
    .limit(5);
  if ((open ?? []).some((r) => readLiveMeter(r.live)?.settledAt === null)) {
    return fail("busy", "A live take is already running — stop it first.");
  }

  const image = await openingImage(supabase, userId, input);
  if ("code" in image) return image;

  // The words, judged before anything is spent — in the strict lane when a
  // photo of a person opens the take.
  try {
    await gatePrompt({ prompt, userId, hasRealPersonReference: image.url !== null });
  } catch (err) {
    if (err instanceof ContentPolicyRefusal) return fail("refused", err.userMessage);
    throw err;
  }

  const meter = newLiveMeter({ paidSeconds: input.length, resolution, aspect, from: image.from, withImage: image.url !== null });
  const total = meter.paidCredits;
  const allowance = await checkGenerationAllowance(supabase, userId, total);
  if (allowance.error) return fail("noCredits", allowance.error);
  const consumePurchased = allowance.consumePurchased ?? 0;
  const consumeBonus = allowance.consumeBonus ?? 0;
  const monthlyPortion = allowance.isAdmin ? 0 : Math.max(0, total - consumePurchased - consumeBonus);

  const row = {
    id: input.sendId,
    character_profile_id: image.characterId,
    character_profile_ids: image.characterId ? [image.characterId] : [],
    prompt_input: prompt.slice(0, 200),
    content_type: "video",
    status: "generating",
    attempts: 0,
    result_url: null,
    pipeline_log: [liveLogStep(`${LIVE_LABEL} · ${meter.paidSeconds} s paid · ${resolution} · ${aspect}`, prompt)],
    video_model_id: LIVE_MODEL_ID,
    model_id: LIVE_MODEL_ID,
    video_duration_seconds: meter.paidSeconds,
    video_aspect_ratio: aspect,
    credits_used: total,
    purchased_credits_used: consumePurchased,
    bonus_credits_used: consumeBonus,
    free_generation_used: false,
    live: meter,
  };
  const { data: reservedIds, error: reserveError } = await admin.rpc("reserve_generations", {
    p_user_id: userId,
    p_monthly_portion: monthlyPortion,
    p_limit: allowance.monthlyLimit ?? 0,
    p_since: allowance.periodStartIso ?? new Date(0).toISOString(),
    p_rows: [row],
  });
  if (reserveError) {
    // Both deliveries of one press got past the look-up above at once: the
    // other reserved this id first, so this one follows it.
    if (isRepeatReservation(reserveError) || /duplicate key/i.test(reserveError.message)) {
      const first = await ownTake(userId, input.sendId);
      if (first) return follow(first);
    }
    console.error("[live] reserve_generations failed:", reserveError.message);
    return fail("couldntStart", "Couldn't start this take — try again.");
  }
  if (!((reservedIds as string[] | null) ?? []).length) {
    return fail("noCredits", "You've used all the credits included in your plan this month.");
  }

  const bonusOk = await consumeBonusCredits(supabase, userId, consumeBonus);
  if (!(await consumePurchasedCredits(supabase, userId, consumePurchased)) || !bonusOk) {
    await admin
      .from("generations")
      .update({ status: "failed", credits_used: 0, purchased_credits_used: 0, bonus_credits_used: 0, progress_stage: null })
      .eq("id", input.sendId);
    return fail("noCredits", "You're out of credits — that request couldn't be covered.");
  }

  // The meter must have landed: reserve_generations drops a column it does
  // not know, so before live.sql runs the row is written without one — and
  // the relay would refuse every call on it. Refund it whole and say why.
  const { data: written } = await admin.from("generations").select("live").eq("id", input.sendId).maybeSingle();
  if (!readLiveMeter(written?.live)) {
    await admin.from("generations").update({ status: "failed", progress_stage: null }).eq("id", input.sendId);
    await refundGenerationCosts(input.sendId, { force: true });
    console.error("[live] the `live` column is missing — run supabase/pending/live.sql");
    return fail("couldntStart", "Live isn't ready yet — try again later.");
  }

  revalidatePath("/app/history");
  return {
    error: null,
    takeId: input.sendId,
    paidSeconds: meter.paidSeconds,
    paidCredits: meter.paidCredits,
    configure: liveConfigureMessage({ prompt, resolution, aspect, imageUrl: image.url }),
  };
}

// A direction's seal: proof the server judged these exact words for this
// take. History keeps only sealed directions, so what a page claims it sent
// can never put unread text on a take (review, 2026-09-24). Stateless on
// purpose — no row write per direction, nothing to race the heartbeat.
function sealDirection(takeId: string, text: string): string {
  const key = process.env.MEDIA_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return createHmac("sha256", key).update(`live-direction:${takeId}:${text}`).digest("base64url").slice(0, 22);
}

function sealedDirections(takeId: string, sent: unknown): string[] {
  if (!Array.isArray(sent)) return [];
  const kept: string[] = [];
  for (const d of sent) {
    if (!d || typeof d !== "object") continue;
    const { text, seal } = d as { text?: unknown; seal?: unknown };
    if (typeof text !== "string" || typeof seal !== "string") continue;
    const expected = Buffer.from(sealDirection(takeId, text));
    const given = Buffer.from(seal);
    if (expected.length === given.length && timingSafeEqual(expected, given)) kept.push(text);
  }
  return kept;
}

/** Judges one direction before the page sends it to fal. */
export async function checkLiveDirection(takeId: string, text: string): Promise<{ error: null; text: string; seal: string } | Failure> {
  const { user } = await signedIn();
  if (!user) return fail("signedOut", "Your session expired — please log in again.");
  const direction = typeof text === "string" ? text.trim() : "";
  if (!direction) return fail("noPrompt", "Type a direction first.");
  if (direction.length > LIVE_DIRECTION_MAX) return fail("noPrompt", `Keep a direction under ${LIVE_DIRECTION_MAX} characters.`);
  const row = await ownTake(user.id, takeId);
  const meter = readLiveMeter(row?.live);
  if (!row || !meter || meter.settledAt !== null || row.status !== "generating") return fail("ended", "This take has ended.");
  if (await rateLimited(user.id, "live-direction", 60, 40)) {
    return fail("tooFast", "You're generating a bit fast — wait a few seconds and try again.");
  }
  try {
    await gatePrompt({ prompt: direction, userId: user.id, hasRealPersonReference: meter.withImage, generationId: row.id });
  } catch (err) {
    if (err instanceof ContentPolicyRefusal) return fail("refused", err.userMessage);
    throw err;
  }
  return { error: null, text: direction, seal: sealDirection(row.id, direction) };
}

export type LiveSettled = { error: null; usedSeconds: number; refunded: number; paidCredits: number; ran: boolean };

/** Stop: settles the take — the seconds it ran are charged, the rest comes back. Safe to call twice. */
export async function stopLiveTake(takeId: string, directions: { text: string; seal: string }[]): Promise<LiveSettled | Failure> {
  const { user } = await signedIn();
  if (!user) return fail("signedOut", "Your session expired — please log in again.");
  const row = await ownTake(user.id, takeId);
  const meter = readLiveMeter(row?.live);
  if (!row || !meter) return fail("ended", "This take has ended.");
  const settled =
    meter.settledAt === null
      ? await settleLiveTake(createAdminClient(), row, { nowMs: Date.now(), directions: sealedDirections(row.id, directions) })
      : null;
  const final = settled ?? readLiveMeter((await ownTake(user.id, takeId))?.live) ?? meter;
  revalidatePath("/app/history");
  return {
    error: null,
    usedSeconds: final.usedSeconds ?? 0,
    refunded: final.refunded ?? 0,
    paidCredits: final.paidCredits,
    ran: final.startedAt !== null,
  };
}

function recordingPath(userId: string, takeId: string): string {
  return `${userId}/live-${takeId}.mp4`;
}

/** A place in storage for the page's recording of a settled take. MP4 only: WebM cannot be judged or sent on. */
export async function reserveLiveRecording(
  takeId: string,
  file: { type: string; size: number },
): Promise<{ error: null; path: string; token: string } | Failure> {
  const { user } = await signedIn();
  if (!user) return fail("signedOut", "Your session expired — please log in again.");
  const row = await ownTake(user.id, takeId);
  const meter = readLiveMeter(row?.live);
  if (!row || !meter || meter.settledAt === null || meter.startedAt === null || row.status !== "generating") {
    return fail("ended", "This take has ended.");
  }
  const mime = typeof file?.type === "string" ? file.type.split(";")[0].trim().toLowerCase() : "";
  if (mime !== "video/mp4") return fail("recordingFormat", "This browser records in a format we can't keep — save it to your device instead.");
  if (!(typeof file.size === "number" && file.size > 0 && file.size <= RECORDING_MAX_BYTES)) {
    return fail("recordingFormat", "The recording is too large to keep — save it to your device instead.");
  }
  const path = recordingPath(user.id, row.id);
  const { data, error } = await createAdminClient().storage.from(RECORDING_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data?.token) {
    console.error("[live] recording upload URL failed:", error?.message);
    return fail("recordingMissing", "Couldn't save the recording — try again.");
  }
  return { error: null, path, token: data.token };
}

/** Keeps the uploaded recording as the take's video — after the output gate, like every render. */
export async function keepLiveRecording(takeId: string, seconds: number): Promise<{ error: null; url: string } | Failure> {
  const { user } = await signedIn();
  if (!user) return fail("signedOut", "Your session expired — please log in again.");
  const row = await ownTake(user.id, takeId);
  const meter = readLiveMeter(row?.live);
  if (!row || !meter || meter.settledAt === null || row.status !== "generating") return fail("ended", "This take has ended.");

  const admin = createAdminClient();
  const path = recordingPath(user.id, row.id);
  const { data: signed } = await admin.storage.from(RECORDING_BUCKET).createSignedUrl(path, 60 * 60);
  if (!signed?.signedUrl) return fail("recordingMissing", "Couldn't save the recording — try again.");

  try {
    await judgeRender({ url: signed.signedUrl, kind: "video", strictLane: meter.withImage });
  } catch (err) {
    if (!(err instanceof OutputPolicyRefusal)) throw err;
    if (err.reason === "unavailable") {
      // Not a refusal — the check itself could not run. Nothing is removed;
      // pressing Save again retries it.
      return fail("recordingUnchecked", "We couldn't check the recording just now — try Save again in a moment.");
    }
    await recordPolicyRefusal({ userId: user.id, gate: "output", reason: err.reason, strictLane: meter.withImage, bands: err.readings, generationId: row.id, provider: "live" });
    await admin.storage.from(RECORDING_BUCKET).remove([path]);
    await admin
      .from("generations")
      .update({
        status: "failed",
        progress_stage: null,
        pipeline_log: [liveLogStep(`The live take ran ${meter.usedSeconds ?? 0} s; its recording didn't pass our content check, so it wasn't kept.`)],
      })
      .eq("id", row.id)
      .eq("status", "generating");
    return fail("recordingRefused", err.userMessage);
  }

  const kept = Math.max(1, Math.min(Math.round(Number(seconds) || 0) || (meter.usedSeconds ?? 0), meter.usedSeconds ?? meter.paidSeconds));
  const url = mediaUrl(RECORDING_BUCKET, path);
  const lines = [`${LIVE_LABEL} · ran ${meter.usedSeconds ?? 0} s of ${meter.paidSeconds} s · ${meter.refunded ?? 0} credits back`];
  meter.directions.forEach((d, i) => lines.push(`Direction ${i + 1}: ${d}`));
  const { data: done } = await admin
    .from("generations")
    .update({
      status: "succeeded",
      result_url: url,
      video_duration_seconds: kept,
      progress_stage: null,
      pipeline_log: [liveLogStep(lines.join("\n"))],
    })
    .eq("id", row.id)
    .eq("status", "generating")
    .select("id");
  if (!done?.length) return fail("ended", "This take has ended.");
  revalidatePath("/app/media");
  revalidatePath("/app/history");
  return { error: null, url: toMediaUrl(url) ?? url };
}
