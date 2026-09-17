"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { checkGenerationAllowance, consumePurchasedCredits } from "@/lib/generations/core";
import { refundGenerationCosts, saveVideoJob } from "@/lib/generations/job-runner";
import { judgeRender, OutputPolicyRefusal } from "@/lib/generations/output-policy";
import { recentRefusalCount, recordPolicyRefusal } from "@/lib/generations/policy-log";
import { cancelQueuedJob, submitRecastJob, type QueuedJob } from "@/lib/generations/providers/fal";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/generations/user-facing-error";
import { probeMp4 } from "@/lib/media/mp4-probe";
import { toMediaUrl } from "@/lib/media/url";
import { isRecastEnabled } from "@/lib/recast/enabled";
import {
  RECAST_ALREADY_STARTED,
  RECAST_CHARACTER_NEEDS_PHOTO,
  RECAST_CLIP_TOO_BIG,
  RECAST_CLIP_UNCHECKED,
  RECAST_COULDNT_START,
  RECAST_NEEDS_DATABASE,
  RECAST_NEEDS_RIGHTS,
  RECAST_NOT_A_VIDEO,
  RECAST_NOT_OPEN,
  RECAST_SCENE_TOO_LONG,
  RECAST_TOO_FAST,
  RECAST_UNAVAILABLE,
  RECAST_UPLOAD_UNREADABLE,
  recastClipProblemMessage,
} from "@/lib/recast/messages";
import {
  parseRecastEngine,
  parseRecastSourcePath,
  RECAST_BUCKET,
  RECAST_ENGINE_ORDER,
  RECAST_ENGINES,
  RECAST_MAX_BYTES,
  RECAST_MODEL_IDS,
  recastClipProblem,
  recastContainerOf,
  recastCreditCost,
  recastEngineFits,
  recastSourcePath,
  type RecastClip,
  type RecastEngine,
} from "@/lib/recast/recast";

// Recast — "Mystique" on the door (working title, 2026-09-17). A clip of
// someone performing goes in; the same performance comes out with a saved
// character in their place.
//
// THE ORDER, and why:
//
//   reserve a path (the take's id is minted here — the clip is stored under
//   it, which is how the before/after viewer finds a take's footage with no
//   column) → the BROWSER uploads straight to storage, the upscaler's shape
//   → INSPECT reads the file and quotes every engine from it → START:
//   rights ticked → the file read AGAIN (the money path reads the file, not
//   the form, and not the inspect's answer) → the character is the caller's
//   own and has a photo → THE CLIP IS JUDGED (its middle frame, the strict
//   lane, the same judge a finished video meets) before anything is spent →
//   allowance → reserve the row → guarded spend → submit → record the job.
//
// FROM THE JOB ROW ON, A RECAST IS AN ORDINARY VIDEO RENDER: stage "video",
// so the webhook, the poll, the reaper, Stop, the output gate (strict — the
// lane rides the job payload), the poster, the identity score against the
// character's first photo, the notification and the refund rules are the
// ones every video already runs. Nothing in job-runner knows this lane
// exists.
//
// WHO: admins only while it is proved, behind the `recast` switch. The
// operator's decision (2026-09-17) is every paid plan after that, credits
// doing the gating — a change to recastAccess alone.
//
// TWO JOBS (lib/recast/recast.ts has the probe that found them): "scene"
// puts the character inside the clip; "motion" brings the character's
// photo to life with the clip's performance. The engine names the job.
//
// NOT IN THIS CUT (the draft's cut 1 lists them; said plainly so nobody
// assumes them): the read that writes a brief, the proof pass (each job's
// lighter engine is the cheap pass for now), multi-frame scoring, more
// than one person. The engines take no prompt here, so there is no text
// to gate.

type Access =
  | { error: string }
  | { error: null; supabase: Awaited<ReturnType<typeof createClient>>; userId: string; isAdmin: boolean };

async function recastAccess(): Promise<Access> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: SESSION_EXPIRED_MESSAGE };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  const isAdmin = profile?.role === "admin";
  if (!isAdmin) return { error: RECAST_NOT_OPEN };
  if (!(await isRecastEnabled(supabase))) return { error: RECAST_UNAVAILABLE };
  return { error: null, supabase, userId: data.user.id, isAdmin };
}

type Admin = ReturnType<typeof createAdminClient>;

async function removeSource(admin: Admin, path: string): Promise<void> {
  const { error } = await admin.storage.from(RECAST_BUCKET).remove([path]);
  if (error) console.error("recast source remove failed:", error.message);
}

/** The file, read — never the form. An error when it is gone or is not a video we can read. */
async function readClip(admin: Admin, path: string): Promise<{ clip: RecastClip } | { error: string }> {
  const { data: blob, error } = await admin.storage.from(RECAST_BUCKET).download(path);
  if (error || !blob) return { error: RECAST_UPLOAD_UNREADABLE };
  const buf = Buffer.from(await blob.arrayBuffer());
  const probe = probeMp4(buf);
  if (!probe) return { error: RECAST_NOT_A_VIDEO };
  return {
    clip: { seconds: probe.seconds, frames: probe.frames, width: probe.width, height: probe.height, bytes: buf.length },
  };
}

/** Step 1: a place for the clip, and the id the take will carry. */
export async function reserveRecastUpload(input: {
  size: number;
  type: string;
}): Promise<{ error: string } | { error: null; path: string; contentType: string }> {
  const access = await recastAccess();
  if (access.error !== null) return { error: access.error };

  const container = recastContainerOf(typeof input?.type === "string" ? input.type : "");
  if (!container) return { error: RECAST_NOT_A_VIDEO };
  const size = typeof input?.size === "number" ? input.size : 0;
  if (!(size > 0) || size > RECAST_MAX_BYTES) return { error: RECAST_CLIP_TOO_BIG };
  if (await rateLimited(access.userId, "recast-upload", 600, 12)) return { error: RECAST_TOO_FAST };

  // The bucket arrives with recast.sql; without it the browser's upload
  // would fail with storage's own words.
  const admin = createAdminClient();
  const { error: bucketError } = await admin.storage.getBucket(RECAST_BUCKET);
  if (bucketError) return { error: RECAST_NEEDS_DATABASE };

  return {
    error: null,
    path: recastSourcePath(access.userId, crypto.randomUUID(), container),
    contentType: input.type,
  };
}

export type RecastQuote = { engine: RecastEngine; credits: number; fits: boolean };

/** Step 2: what the uploaded file really is, and what each engine would cost for it. */
export async function inspectRecastUpload(
  path: string,
): Promise<{ error: string } | { error: null; seconds: number; width: number; height: number; quotes: RecastQuote[] }> {
  const access = await recastAccess();
  if (access.error !== null) return { error: access.error };
  const parsed = parseRecastSourcePath(typeof path === "string" ? path : "");
  if (!parsed || parsed.userId !== access.userId) return { error: RECAST_UPLOAD_UNREADABLE };

  const admin = createAdminClient();
  const read = await readClip(admin, path);
  if ("error" in read) {
    await removeSource(admin, path);
    return { error: read.error };
  }
  const problem = recastClipProblem(read.clip);
  if (problem) {
    await removeSource(admin, path);
    return { error: recastClipProblemMessage(problem) };
  }
  return {
    error: null,
    seconds: Math.round(read.clip.seconds * 10) / 10,
    width: read.clip.width,
    height: read.clip.height,
    quotes: RECAST_ENGINE_ORDER.map((engine) => ({
      engine,
      credits: recastCreditCost(engine, read.clip),
      fits: recastEngineFits(engine, read.clip),
    })),
  };
}

/** A clip the person changed their mind about: gone, unless a take already stands on it. */
export async function discardRecastUpload(path: string): Promise<void> {
  const access = await recastAccess();
  if (access.error !== null) return;
  const parsed = parseRecastSourcePath(typeof path === "string" ? path : "");
  if (!parsed || parsed.userId !== access.userId) return;
  const admin = createAdminClient();
  const { data: take } = await admin.from("generations").select("id").eq("id", parsed.takeId).maybeSingle();
  if (take) return;
  await removeSource(admin, path);
}

/** Step 3: the take. */
export async function startRecastTake(input: {
  path: string;
  characterId: string;
  /**
   * Which of the character's saved photos the engine is given. In a motion
   * take the photo IS the frame, so the choice is the look; absent, photo
   * one. Only ever one of the character's own saved paths.
   */
  photoPath?: string;
  engine: string;
  rights: boolean;
}): Promise<{ error: string } | { error: null; id: string }> {
  const access = await recastAccess();
  if (access.error !== null) return { error: access.error };
  const { supabase, userId } = access;

  if (input?.rights !== true) return { error: RECAST_NEEDS_RIGHTS };
  const engine = parseRecastEngine(input?.engine);
  if (!engine) return { error: RECAST_COULDNT_START };
  const parsed = parseRecastSourcePath(typeof input?.path === "string" ? input.path : "");
  // Re-checked, not trusted: exactly one of our own paths, in this user's folder.
  if (!parsed || parsed.userId !== userId) return { error: RECAST_UPLOAD_UNREADABLE };
  const { path } = input;
  const takeId = parsed.takeId;

  if (await rateLimited(userId, "recast-start", 60 * 60, access.isAdmin ? 30 : 8)) return { error: RECAST_TOO_FAST };

  // The caller's own character, and the photo the product calls its identity.
  const { data: character } = await supabase
    .from("character_profiles")
    .select("id, name, reference_image_urls")
    .eq("id", typeof input?.characterId === "string" ? input.characterId : "")
    .eq("user_id", userId)
    .maybeSingle<{ id: string; name: string; reference_image_urls: string[] | null }>();
  if (!character) return { error: "Couldn't find that character." };
  const photos = character.reference_image_urls ?? [];
  if (photos.length === 0) return { error: RECAST_CHARACTER_NEEDS_PHOTO };
  // A path that is not one of this character's own saved photos is ignored,
  // never signed (the composer's anchor rule).
  const identityPath = typeof input?.photoPath === "string" && photos.includes(input.photoPath) ? input.photoPath : photos[0];

  // THE MONEY PATH READS THE FILE. Length and frame count price the take.
  const admin = createAdminClient();
  const read = await readClip(admin, path);
  if ("error" in read) return { error: read.error };
  const { clip } = read;
  const problem = recastClipProblem(clip);
  if (problem) {
    await removeSource(admin, path);
    return { error: recastClipProblemMessage(problem) };
  }
  // The clip stays: it may still suit the other mode.
  if (!recastEngineFits(engine, clip)) return { error: RECAST_SCENE_TOO_LONG };

  // Both inputs as URLs the provider can fetch — generous enough to outlive
  // any queue wait (the upscaler's reasoning, and its number).
  const DAY = 60 * 60 * 24;
  const [{ data: clipSigned }, { data: faceSigned }] = await Promise.all([
    admin.storage.from(RECAST_BUCKET).createSignedUrl(path, DAY),
    admin.storage.from("character-references").createSignedUrl(identityPath, DAY),
  ]);
  if (!clipSigned?.signedUrl || !faceSigned?.signedUrl) return { error: RECAST_COULDNT_START };

  // THE CLIP IS JUDGED before anything is spent: real footage of real
  // people, so the strict lane, and a frame that cannot be read is a
  // refusal — the judge a finished video meets, met on the way in.
  try {
    await judgeRender({
      url: clipSigned.signedUrl,
      kind: "video",
      strictLane: true,
      sessionPriorHits: await recentRefusalCount(userId),
    });
  } catch (err) {
    if (!(err instanceof OutputPolicyRefusal)) throw err;
    await recordPolicyRefusal({
      userId,
      gate: "output",
      reason: err.reason,
      strictLane: true,
      bands: err.readings,
      provider: "recast-source",
    });
    if (err.reason === "unavailable") return { error: RECAST_CLIP_UNCHECKED };
    await removeSource(admin, path);
    return { error: err.userMessage };
  }

  const spec = RECAST_ENGINES[engine];
  const creditWeight = recastCreditCost(engine, clip);
  const seconds = Math.max(1, Math.round(clip.seconds));
  const promptInput = `Recast: ${character.name}`;

  // The free daily slot never covers a recast — plan or purchased credits
  // only, the upscaler's rule.
  const allowance = await checkGenerationAllowance(supabase, userId, creditWeight);
  if (allowance.error) return { error: allowance.error };
  const consumePurchased = allowance.consumePurchased ?? 0;
  const monthlyPortion = allowance.isAdmin ? 0 : Math.max(0, creditWeight - consumePurchased);

  const { data: reservedId, error: reserveError } = await admin.rpc("reserve_generation", {
    p_user_id: userId,
    p_monthly_portion: monthlyPortion,
    p_limit: allowance.monthlyLimit ?? 0,
    p_since: allowance.periodStartIso ?? new Date(0).toISOString(),
    p_row: {
      // The id the clip is stored under: one take per upload, and a second
      // press on the same upload meets the primary key, not a second bill.
      id: takeId,
      character_profile_id: character.id,
      character_profile_ids: [character.id],
      prompt_input: promptInput,
      content_type: "video",
      status: "generating",
      attempts: 0,
      result_url: null,
      pipeline_log: [],
      video_model_id: spec.modelId,
      model_id: spec.modelId,
      video_duration_seconds: seconds,
      video_aspect_ratio: null,
      credits_used: creditWeight,
      purchased_credits_used: consumePurchased,
      free_generation_used: false,
    },
  });
  if (reserveError) {
    const duplicate = reserveError.code === "23505" || /duplicate key/i.test(reserveError.message);
    if (!duplicate) console.error("reserve_generation failed for recast:", reserveError);
    return { error: duplicate ? RECAST_ALREADY_STARTED : RECAST_COULDNT_START };
  }
  if (!reservedId) return { error: "You've used all the credits included in your plan this month." };
  const generationId = reservedId as string;

  // Guarded purchased-credit spend — nothing paid has run yet, so losing the
  // race releases the placeholder (the render path's abort contract).
  if (!(await consumePurchasedCredits(supabase, userId, consumePurchased))) {
    const { error: releaseError } = await admin
      .from("generations")
      .update({ status: "failed", credits_used: 0, purchased_credits_used: 0, progress_stage: null })
      .eq("id", generationId);
    if (releaseError) console.error("recast guarded-spend abort couldn't release the placeholder:", releaseError.message);
    return { error: "You're out of credits — top up under Settings → Usage (credit packs need no plan)." };
  }

  // Submit, then record; on a bookkeeping failure cancel the job and refund
  // — the order every queued lane keeps.
  const submittedLine = `Submitted a ${seconds}s clip to ${spec.label}. The sender confirmed the clip is theirs to use.`;
  let pendingJob: QueuedJob | null = null;
  try {
    pendingJob = await submitRecastJob(engine, { characterImageUrl: faceSigned.signedUrl, clipUrl: clipSigned.signedUrl });
    await saveVideoJob({
      generationId,
      userId,
      job: { ...pendingJob, provider: "fal" },
      strictLane: true,
      attempts: [
        {
          attempt: 1,
          passed: true,
          issues: [],
          compiledPrompt: promptInput,
          steps: [{ step: "generate" as const, detail: submittedLine }],
        },
      ],
    });
  } catch (err) {
    if (pendingJob) await cancelQueuedJob(pendingJob);
    const message = err instanceof Error ? err.message : "Couldn't start the take.";
    await admin
      .from("generations")
      .update({
        status: "failed",
        progress_stage: null,
        pipeline_log: [
          {
            attempt: 1,
            passed: false,
            issues: [],
            compiledPrompt: promptInput,
            steps: [{ step: "generate" as const, detail: message }],
          },
        ],
      })
      .eq("id", generationId);
    try {
      // Nothing was delivered, so nothing was billed — force the refund.
      await refundGenerationCosts(generationId, { force: true });
    } catch (refundErr) {
      console.error(`recast submit-failure refund failed for ${generationId}:`, refundErr);
    }
    return { error: RECAST_COULDNT_START };
  }

  revalidatePath("/app/mystique");
  revalidatePath("/app/history");
  return { error: null, id: generationId };
}

/** The before/after viewer's two films: the take, and the footage it stands on. */
export async function getRecastTakeMedia(
  takeId: string,
): Promise<{ error: string } | { error: null; resultUrl: string | null; sourceUrl: string | null }> {
  const access = await recastAccess();
  if (access.error !== null) return { error: access.error };
  const { data: take } = await access.supabase
    .from("generations")
    .select("id, result_url, model_id")
    .eq("id", typeof takeId === "string" ? takeId : "")
    .eq("user_id", access.userId)
    .is("deleted_at", null)
    .in("model_id", RECAST_MODEL_IDS)
    .maybeSingle<{ id: string; result_url: string | null; model_id: string }>();
  if (!take) return { error: RECAST_UPLOAD_UNREADABLE };

  // The clip sits under the take's id; which container it was is asked, not stored.
  const admin = createAdminClient();
  let sourceUrl: string | null = null;
  for (const container of ["mp4", "mov"] as const) {
    const { data } = await admin.storage
      .from(RECAST_BUCKET)
      .createSignedUrl(recastSourcePath(access.userId, take.id, container), 60 * 60);
    if (data?.signedUrl) {
      sourceUrl = data.signedUrl;
      break;
    }
  }
  return { error: null, resultUrl: toMediaUrl(take.result_url), sourceUrl };
}
