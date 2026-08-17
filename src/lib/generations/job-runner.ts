import { createAdminClient } from "@/lib/supabase/server";
import {
  cancelQueuedJob,
  checkQueuedJob,
  fetchQueuedAudioUrl,
  fetchQueuedVideoUrl,
  submitLipSyncJob,
  submitSpeechJob,
  type QueuedJob,
} from "@/lib/generations/providers/fal";
import type { AttemptLog } from "@/lib/generations/pipeline";
import { autoReportFailedGeneration } from "@/lib/generations/reports";
import { recordModelFailure, recordModelSuccess } from "@/lib/generations/model-health";
import { notifyUser } from "@/lib/push/send";

// Fire-and-poll orchestrator.
//
// The problem this exists to solve: a generation used to run inside a single
// server action that stayed open from "Generate" until the video came back.
// A Kling render takes roughly six to ten minutes, and dialogue adds another
// two or three on top, but Vercel's Hobby plan kills any function at 300
// seconds. So long jobs were being executed and paid for on fal.ai's side and
// then killed on ours before the result could be saved. Multi-angle and
// storyboard, which are the longest jobs of all, had never once completed.
//
// The fix is that no request waits for anything. The pipeline prepares the
// prompt and hands the render to fal.ai's queue (see submitVideoOnly in
// pipeline.ts), then we record the queue handle here and return. From then on
// the client polls advanceGeneration, and each poll does exactly one short
// step — check the status, and if it's finished, move to the next stage. No
// individual request runs for more than a few seconds, so the 300s ceiling
// stops being a constraint rather than being worked around.
//
// The second benefit matters just as much for the mobile apps: because the
// state lives in the database rather than in a running function, a generation
// survives a page reload, a closed tab, and a phone locking mid-render. The
// old design lost the job in all three cases.

// A video generation can pass through several queued provider jobs in turn.
// Each is submitted only once its predecessor has finished, because each one
// consumes the previous one's output.
export type JobStage = "video" | "dialogue_tts" | "dialogue_lipsync";

// What advanceGeneration tells the caller after one tick.
export type AdvanceResult =
  | { state: "pending"; stage: JobStage; progress: string }
  | { state: "succeeded"; resultUrl: string }
  // `message`, not `error` — pollGeneration returns this intersected with its
  // own { error: null } success envelope, and two differently-typed `error`
  // fields collapse that variant to never, silently deleting the failure case
  // from the union the client sees.
  | { state: "failed"; message: string }
  | { state: "cancelled" }
  // No job row: either it finished on an earlier poll (two polls can overlap)
  // or it never existed. The caller should read the generations row to find
  // out which — never treat this as an error.
  | { state: "gone" };

type ResumeState = {
  dialogueText?: string;
  dialogueVoiceId?: string;
  // The pipeline's attempt log so far. Carried through so the finished
  // generation ends up with the same complete pipeline_log it would have had
  // when this all ran inline, rather than losing the drafting and validation
  // history that happened before the job was queued.
  attempts: AttemptLog[];
};

type JobRow = {
  generation_id: string;
  user_id: string;
  stage: JobStage;
  provider_request_id: string | null;
  status_url: string | null;
  response_url: string | null;
  cancel_url: string | null;
  payload: { videoUrl?: string; audioUrl?: string };
  resume: ResumeState;
  started_at: string;
};

// User-facing progress labels, written to generations.progress_stage so the
// composer can say what's actually happening instead of showing one opaque
// spinner for ten minutes. Kept deliberately non-technical.
const STAGE_PROGRESS: Record<JobStage, string> = {
  video: "Rendering your video",
  dialogue_tts: "Generating the voice",
  dialogue_lipsync: "Syncing the lips to the dialogue",
};

// How long a job may go unpolled before the reaper assumes nobody is coming
// back for it. Generous, because a phone can be locked for a long while and
// the whole point of this rewrite is that the job survives that. This only
// needs to be short enough that abandoned rows don't sit at "generating"
// indefinitely.
const STALE_AFTER_MS = 30 * 60_000;

// Who absorbs the cost when a generation doesn't produce anything.
//
// The asymmetry to keep in mind: fal bills for a render that actually ran,
// whether or not anyone collected it. So refunding a user's credit for work
// that genuinely rendered means paying twice — once to fal, and once in
// unearned allowance. A refund is only fair where the fault is ours or the
// provider's.
//
//   provider_failed  fal errored or lost the job. Failed work generally isn't
//                    billed, so refunding costs nothing and is plainly right.
//   our_error        a bug on our side. We caused it, we absorb it.
//   user_cancelled   they pressed Stop. We cancel at fal immediately, so
//                    little or nothing is billed, and refunding keeps Stop
//                    honest rather than a penalty.
//   abandoned        nobody came back for it. The render ran and was billed.
//                    Since the webhook landed this is rare and genuinely means
//                    the person walked away, so the credit stands.
//
// Set deliberately, per Wigly, 2026-08-10. Worth revisiting if support
// requests pile up — an unrefunded abandoned render tends to cost more in
// goodwill than the credit is worth.
export type FailureFault = "provider_failed" | "our_error" | "user_cancelled" | "abandoned";

const REFUNDS: Record<FailureFault, boolean> = {
  provider_failed: true,
  our_error: true,
  user_cancelled: true,
  abandoned: false,
};

// Gives back everything a failed generation consumed, across all three
// credit sources. The monthly allowance refunds itself the moment
// credits_used hits 0 (getMonthlyUsage sums that column), but purchased
// top-up credits and free-trial generations are decremented on the
// *profile* at insert time, so they need an explicit refund — without this,
// a free-trial user whose generation failed permanently lost one of their 5
// trial generations, which is the exact opposite of the published
// "failed generations never consume your allowance" promise.
//
// Idempotent under overlapping polls: each profile-side refund is gated on
// an optimistic conditional update that zeroes the generation row's
// consumption record first — whichever caller wins the update does the
// refund; the loser matches zero rows and does nothing.
export async function refundGenerationCosts(generationId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: row } = await admin
    .from("generations")
    .select("user_id, purchased_credits_used, free_generation_used")
    .eq("id", generationId)
    .maybeSingle<{ user_id: string; purchased_credits_used: number; free_generation_used: boolean }>();
  if (!row) return;

  // Always release the monthly allowance, even when there's nothing else to
  // refund — some callers reach here without having zeroed credits_used.
  await admin.from("generations").update({ credits_used: 0 }).eq("id", generationId);

  if ((row.purchased_credits_used ?? 0) > 0) {
    const { data: claimed } = await admin
      .from("generations")
      .update({ purchased_credits_used: 0 })
      .eq("id", generationId)
      .eq("purchased_credits_used", row.purchased_credits_used)
      .select("id");
    if (claimed?.length) {
      const { data: profile } = await admin
        .from("profiles")
        .select("purchased_credits")
        .eq("id", row.user_id)
        .maybeSingle<{ purchased_credits: number }>();
      await admin
        .from("profiles")
        .update({ purchased_credits: (profile?.purchased_credits ?? 0) + row.purchased_credits_used })
        .eq("id", row.user_id);
    }
  }

  // The lifetime trial counter is deliberately NOT given back.
  //
  // It used to be, and that quietly turned "5 free generations" into
  // "unlimited free attempts": every failure returned the trial credit, so a
  // free account could sit at free_generations_used = 0 forever while
  // burning real provider spend on our side. A trial is a budget for
  // ATTEMPTS, not a guarantee of five good pictures — that is what makes it
  // bounded, and bounded is the whole point of a trial.
  //
  // The row flag is still cleared so the row tells the truth about what it
  // consumed; only the profile counter stays where it is.
  if (row.free_generation_used) {
    await admin
      .from("generations")
      .update({ free_generation_used: false })
      .eq("id", generationId)
      .eq("free_generation_used", true);
  }
}

function jobHandle(row: JobRow): QueuedJob {
  return {
    requestId: row.provider_request_id ?? "",
    statusUrl: row.status_url ?? "",
    responseUrl: row.response_url ?? "",
    cancelUrl: row.cancel_url ?? "",
    label: row.stage === "video" ? "Kling" : row.stage === "dialogue_tts" ? "ElevenLabs TTS" : "Sync Lipsync",
  };
}

// Records a freshly queued render so later polls can pick it up. Called by
// runGeneration immediately after the pipeline returns a pendingVideoJob.
export async function saveVideoJob(params: {
  generationId: string;
  userId: string;
  job: QueuedJob;
  dialogueText?: string;
  dialogueVoiceId?: string | null;
  attempts: AttemptLog[];
}): Promise<void> {
  const admin = createAdminClient();
  await admin.from("generation_jobs").upsert({
    generation_id: params.generationId,
    user_id: params.userId,
    stage: "video" satisfies JobStage,
    provider_request_id: params.job.requestId,
    status_url: params.job.statusUrl,
    response_url: params.job.responseUrl,
    cancel_url: params.job.cancelUrl,
    payload: {},
    resume: {
      dialogueText: params.dialogueText,
      dialogueVoiceId: params.dialogueVoiceId ?? undefined,
      attempts: params.attempts,
    } satisfies ResumeState,
    started_at: new Date().toISOString(),
    last_polled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await admin
    .from("generations")
    .update({ progress_stage: STAGE_PROGRESS.video })
    .eq("id", params.generationId);
}

async function finish(
  generationId: string,
  userId: string,
  outcome:
    | { status: "succeeded"; resultUrl: string; attempts: AttemptLog[] }
    | { status: "failed"; attempts: AttemptLog[]; fault?: FailureFault },
): Promise<void> {
  const admin = createAdminClient();

  await admin
    .from("generations")
    .update({
      status: outcome.status,
      attempts: outcome.attempts.length,
      result_url: outcome.status === "succeeded" ? outcome.resultUrl : null,
      pipeline_log: outcome.attempts,
      progress_stage: null,
      // Refund decided by fault, not by circumstance — see REFUNDS above.
      ...(outcome.status === "failed" && outcome.fault && REFUNDS[outcome.fault]
        ? { credits_used: 0 }
        : {}),
    })
    .eq("id", generationId)
    .eq("user_id", userId);

  await admin.from("generation_jobs").delete().eq("generation_id", generationId);

  // Refund the other two credit sources (purchased top-ups, free-trial
  // generations) for refundable faults — the update above only released the
  // monthly allowance via credits_used.
  if (outcome.status === "failed" && outcome.fault && REFUNDS[outcome.fault]) {
    await refundGenerationCosts(generationId);
  }

  // Tell the phone. This is the pay-off from the webhook work: a render now
  // completes server-side whether or not anyone is watching, so the person
  // can be told rather than having to keep checking. Deep-linked to the
  // generation itself, so tapping it opens the result.
  //
  // Not awaited, and it swallows its own errors: the row above is already
  // saved, and a notification failure must never be able to affect a
  // generation someone paid for.
  void notifyUser(userId, {
    title: outcome.status === "succeeded" ? "Your video is ready" : "That generation didn't finish",
    body:
      outcome.status === "succeeded"
        ? "Tap to watch it."
        : "Tap to see what happened — your credits weren't charged if it was our fault.",
    path: `/app/history/${generationId}`,
  });

  // Feed the circuit breaker. A model that fails three times in a row takes
  // itself out of service, so a broken provider stops costing money the
  // moment it breaks rather than when somebody notices. Reading the model id
  // from the generation row keeps this correct for every path that lands
  // here — poll, webhook or reaper.
  const { data: gen } = await admin
    .from("generations")
    .select("video_model_id, content_type")
    .eq("id", generationId)
    .maybeSingle<{ video_model_id: string | null; content_type: string | null }>();

  const modelId = gen?.video_model_id ?? "";
  const kind = (gen?.content_type === "image" ? "image" : "video") as "video" | "image";

  if (modelId) {
    if (outcome.status === "succeeded") {
      await recordModelSuccess(modelId, kind);
    } else if (outcome.fault === "provider_failed") {
      // Only provider faults count. A user cancelling or walking away says
      // nothing about whether the model works.
      const lastDetail =
        outcome.attempts[outcome.attempts.length - 1]?.steps.slice(-1)[0]?.detail ?? "Generation failed.";
      await recordModelFailure(modelId, kind, lastDetail, userId);
    }
  }

  // Failures used to auto-file a report from runGeneration. Now that a queued
  // render finishes here instead of there, this has to happen here too —
  // otherwise moving to fire-and-poll would have silently switched off failure
  // reporting for exactly the long jobs that fail most often.
  //
  // Reaped jobs are excluded: those are abandoned-and-refunded housekeeping,
  // not a product fault, and filing reports for them would bury the real ones.
  if (outcome.status === "failed" && outcome.fault !== "abandoned" && outcome.fault !== "user_cancelled") {
    await autoReportFailedGeneration(generationId, userId, outcome.attempts);
  }
}

function appendStep(attempts: AttemptLog[], detail: string, step: AttemptLog["steps"][number]["step"]) {
  const last = attempts[attempts.length - 1];
  if (last) {
    last.steps.push({ step, detail });
    return attempts;
  }
  // No attempt log to append to. Shouldn't happen — the pipeline always
  // records one before queueing — but dropping the message on the floor would
  // leave a failed generation with no stated reason anywhere, which is the
  // single most confusing outcome for the person looking at it.
  return [{ attempt: 1, steps: [{ step, detail }], passed: false, issues: [], compiledPrompt: "" }];
}

// Advances a job by exactly one step. Safe to call repeatedly and safe to call
// concurrently — every terminal transition deletes the job row, so a second
// overlapping poll just gets { state: "gone" } rather than doing the work
// twice or double-charging.
export async function advanceGeneration(
  generationId: string,
  userId: string,
): Promise<AdvanceResult> {
  const admin = createAdminClient();

  const { data: row } = await admin
    .from("generation_jobs")
    .select("*")
    .eq("generation_id", generationId)
    .eq("user_id", userId)
    .maybeSingle<JobRow>();

  if (!row) return { state: "gone" };

  await admin
    .from("generation_jobs")
    .update({ last_polled_at: new Date().toISOString() })
    .eq("generation_id", generationId);

  // Stop, as requested from the composer. Now genuinely effective rather than
  // best-effort: the job lives in fal.ai's queue with a real cancel URL, so we
  // can tell them to stop billing instead of just walking away from a render
  // that keeps running.
  const { data: gen } = await admin
    .from("generations")
    .select("cancel_requested")
    .eq("id", generationId)
    .maybeSingle<{ cancel_requested: boolean }>();

  if (gen?.cancel_requested) {
    await cancelQueuedJob(jobHandle(row));
    await finish(generationId, userId, {
      status: "failed",
      attempts: appendStep(row.resume.attempts ?? [], "Stopped.", "generate"),
      fault: "user_cancelled",
    });
    return { state: "cancelled" };
  }

  let status;
  try {
    status = await checkQueuedJob(jobHandle(row));
  } catch {
    // Transport hiccup reaching fal — not a job failure. Leave everything as
    // it is and let the next poll try again; last_polled_at was already
    // refreshed above so the reaper won't mistake this for an abandoned job.
    return { state: "pending", stage: row.stage, progress: STAGE_PROGRESS[row.stage] };
  }

  if (status.state === "pending") {
    return { state: "pending", stage: row.stage, progress: STAGE_PROGRESS[row.stage] };
  }

  if (status.state === "failed") {
    // Dialogue is an enhancement on an already-rendered video, never a reason
    // to throw that video away — same rule the inline pipeline followed. If
    // the voice or lip-sync stage fails we ship the silent video instead.
    if (row.stage !== "video" && row.payload.videoUrl) {
      await finish(generationId, userId, {
        status: "succeeded",
        resultUrl: row.payload.videoUrl,
        attempts: appendStep(
          row.resume.attempts ?? [],
          `${status.error} Showing the video without dialogue.`,
          "speech",
        ),
      });
      return { state: "succeeded", resultUrl: row.payload.videoUrl };
    }

    await finish(generationId, userId, {
      status: "failed",
      attempts: appendStep(row.resume.attempts ?? [], status.error, "generate"),
      fault: "provider_failed",
    });
    return { state: "failed", message: status.error };
  }

  // Completed — collect this stage's output and either move to the next stage
  // or finish. Each branch below submits at most one new queued job, so this
  // whole function stays a couple of seconds at worst.
  try {
    if (row.stage === "video") {
      const videoUrl = await fetchQueuedVideoUrl(jobHandle(row));
      const wantsDialogue = Boolean(row.resume.dialogueText?.trim() && row.resume.dialogueVoiceId);

      if (!wantsDialogue) {
        await finish(generationId, userId, {
          status: "succeeded",
          resultUrl: videoUrl,
          attempts: row.resume.attempts ?? [],
        });
        return { state: "succeeded", resultUrl: videoUrl };
      }

      const speech = await submitSpeechJob(row.resume.dialogueText!.trim(), row.resume.dialogueVoiceId!);
      await admin
        .from("generation_jobs")
        .update({
          stage: "dialogue_tts" satisfies JobStage,
          provider_request_id: speech.requestId,
          status_url: speech.statusUrl,
          response_url: speech.responseUrl,
          cancel_url: speech.cancelUrl,
          payload: { ...row.payload, videoUrl },
          updated_at: new Date().toISOString(),
        })
        .eq("generation_id", generationId);
      await admin
        .from("generations")
        .update({ progress_stage: STAGE_PROGRESS.dialogue_tts })
        .eq("id", generationId);

      return { state: "pending", stage: "dialogue_tts", progress: STAGE_PROGRESS.dialogue_tts };
    }

    if (row.stage === "dialogue_tts") {
      const audioUrl = await fetchQueuedAudioUrl(jobHandle(row));
      const lipsync = await submitLipSyncJob(row.payload.videoUrl!, audioUrl);
      await admin
        .from("generation_jobs")
        .update({
          stage: "dialogue_lipsync" satisfies JobStage,
          provider_request_id: lipsync.requestId,
          status_url: lipsync.statusUrl,
          response_url: lipsync.responseUrl,
          cancel_url: lipsync.cancelUrl,
          payload: { ...row.payload, audioUrl },
          updated_at: new Date().toISOString(),
        })
        .eq("generation_id", generationId);
      await admin
        .from("generations")
        .update({ progress_stage: STAGE_PROGRESS.dialogue_lipsync })
        .eq("id", generationId);

      appendStep(row.resume.attempts ?? [], "Generated dialogue audio via ElevenLabs.", "speech");
      return { state: "pending", stage: "dialogue_lipsync", progress: STAGE_PROGRESS.dialogue_lipsync };
    }

    // dialogue_lipsync — the last stage. Its output replaces the silent video.
    const syncedUrl = await fetchQueuedVideoUrl(jobHandle(row));
    await finish(generationId, userId, {
      status: "succeeded",
      resultUrl: syncedUrl,
      attempts: appendStep(
        row.resume.attempts ?? [],
        "Synced the character's mouth to the dialogue via Sync Labs.",
        "lipsync",
      ),
    });
    return { state: "succeeded", resultUrl: syncedUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";

    // Same rule as above: never discard a rendered video over a dialogue
    // problem, even one that surfaces while fetching or submitting.
    if (row.stage !== "video" && row.payload.videoUrl) {
      await finish(generationId, userId, {
        status: "succeeded",
        resultUrl: row.payload.videoUrl,
        attempts: appendStep(
          row.resume.attempts ?? [],
          `${message} Showing the video without dialogue.`,
          "speech",
        ),
      });
      return { state: "succeeded", resultUrl: row.payload.videoUrl };
    }

    await finish(generationId, userId, {
      status: "failed",
      attempts: appendStep(row.resume.attempts ?? [], message, "generate"),
      fault: "provider_failed",
    });
    return { state: "failed", message };
  }
}

// Clears out jobs nobody has polled in a long time.
//
// Run lazily whenever a workspace page loads rather than on a schedule,
// because Vercel's Hobby plan only allows one cron run per day, which is far
// too coarse. The trade-off is that this only fires while somebody is using
// the app — acceptable, since the only cost of a late reap is a stale row
// sitting at "generating" a while longer.
//
// Scoped to one user's own jobs so it stays a small, cheap query on a page
// load and can't turn into an accidental full-table sweep.
export async function reapStaleJobs(userId: string): Promise<void> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  const { data: stale } = await admin
    .from("generation_jobs")
    .select("*")
    .eq("user_id", userId)
    .lt("last_polled_at", cutoff)
    .limit(20)
    .returns<JobRow[]>();

  for (const row of stale ?? []) {
    // Ask once whether it actually finished before writing it off.
    //
    // "Nobody polled this for half an hour" and "this failed" are different
    // things, and the first does not imply the second — a render that
    // completed while the browser was gone is sitting there, paid for, ready
    // to collect. Binning it would throw away real money and a real result.
    // Real incident, 2026-08-10: three multi-angle renders were orphaned by a
    // client-side error and were minutes from being deleted despite running
    // to completion.
    try {
      const state = await checkQueuedJob(jobHandle(row));
      if (state.state === "completed" && row.stage === "video") {
        const videoUrl = await fetchQueuedVideoUrl(jobHandle(row));
        await finish(row.generation_id, row.user_id, {
          status: "succeeded",
          resultUrl: videoUrl,
          attempts: row.resume?.attempts ?? [],
        });
        continue;
      }
      if (state.state === "pending") {
        // Still genuinely rendering. Leave it be and give it another window
        // rather than cancelling work that's in progress.
        await admin
          .from("generation_jobs")
          .update({ last_polled_at: new Date().toISOString() })
          .eq("generation_id", row.generation_id);
        continue;
      }
    } catch {
      // Couldn't reach fal — fall through and clean up as before rather than
      // leaving the row stuck at "generating" indefinitely.
    }

    // Tell fal.ai to stop too. Without this we'd keep paying for renders whose
    // output nobody will ever collect — exactly the leak the queue API was
    // adopted to close.
    await cancelQueuedJob(jobHandle(row));
    await finish(row.generation_id, row.user_id, {
      status: "failed",
      attempts: appendStep(
        row.resume?.attempts ?? [],
        "Nobody was here to collect this when it finished, so it was stopped.",
        "generate",
      ),
      fault: "abandoned",
    });
  }
}
