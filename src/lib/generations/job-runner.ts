import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { refundedFailureDailyCap, type PlanId } from "@/lib/plans";
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
import { getDialogueCreditWeight } from "@/lib/generations/providers/video-models";
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
  // Rewritten on every stage transition, so it marks when the CURRENT provider
  // job began — used by reapStaleJobs' absolute-timeout backstop.
  updated_at: string;
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

// Absolute per-stage deadline. STALE_AFTER_MS decides when nobody is watching a
// job; this decides when a job the provider has silently LOST — one that never
// completes, never fails, and never fires its webhook — should stop being
// retried and be written off, instead of sitting at "generating" forever while
// each reap re-checks it and fal keeps saying "pending".
//
// Measured against updated_at, which is rewritten on every stage transition, so
// it is the age of the CURRENT provider job — a generation legitimately moving
// through video → dialogue → lip-sync resets it at each step and is never
// caught here; only one genuinely stuck on the same provider job ages out. Set
// well above any real render (video 6-10 min, dialogue a few more) so a merely
// slow render is never mistaken for a lost one.
const ABSOLUTE_JOB_TIMEOUT_MS = 45 * 60_000;

// How long one advance may hold the exclusive claim before another poll is
// allowed to assume the holder died and take over. Comfortably longer than a
// real advance takes (a status check plus at most one queue submit — a few
// seconds) and far shorter than a render, so a genuinely crashed advance is
// retried promptly while two live callers can never overlap.
const ADVANCE_LEASE_SECONDS = 90;

// Wins the exclusive right to ACT on this job's current stage — to submit the
// next paid provider job, or to finish the generation — for the span of one
// advance. Returns false when another caller already holds it: the client poll
// and fal's webhook (and two overlapping polls) both re-check status with fal
// and can both see the same stage "completed", so without this both would call
// the paid submitSpeechJob / submitLipSyncJob and double-charge, orphaning one
// render. The loser must do nothing and report the job still pending; the
// holder drives it forward.
//
// Status POLLING itself is deliberately not gated on this — checkQueuedJob is a
// read and safe to run concurrently. Only the money-spending and terminal
// transitions are claimed. The claim is keyed on provider_request_id (server
// side), so once a winner advances to the next stage — changing that id — a
// stale caller keyed to the old id claims nothing.
async function claimAdvance(
  admin: SupabaseClient,
  generationId: string,
  providerRequestId: string | null,
): Promise<boolean> {
  const { data } = await admin.rpc("claim_job_advance", {
    p_generation_id: generationId,
    p_provider_request_id: providerRequestId,
    p_lease_seconds: ADVANCE_LEASE_SECONDS,
  });
  return data === true;
}

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
// Returns true only when it actually released credits, false when it did not
// (kill switch off, row missing, or the daily cap reached) — callers that
// report billing to a customer rely on this to avoid claiming "not charged"
// when the credit was in fact kept.
export async function refundGenerationCosts(generationId: string): Promise<boolean> {
  const admin = createAdminClient();

  // Master switch (Admin > Feature flags > automatic_refunds), currently OFF.
  //
  // The 2026-08-17 audit found the refund policy unsafe as designed: nothing
  // bounded what a refunded failure cost us, and several paths handed credits
  // back for work a provider had already billed. Rather than run a
  // half-designed policy, the whole mechanism is paused here — one place,
  // covering all eleven call sites — until it is designed properly.
  //
  // While it is off a failed generation costs a credit, and the remedy is
  // deliberate rather than automatic: an admin grants bonus credits to anyone
  // genuinely wronged, which leaves a decision on the record instead of a
  // silent reversal nobody reviews.
  const { data: refundFlag } = await admin
    .from("feature_flags")
    .select("enabled")
    .eq("key", "automatic_refunds")
    .maybeSingle<{ enabled: boolean }>();

  if (refundFlag?.enabled !== true) {
    console.info("Automatic refunds are off; not refunding", { generationId });
    return false;
  }

  const { data: row } = await admin
    .from("generations")
    .select("user_id, purchased_credits_used, free_generation_used")
    .eq("id", generationId)
    .maybeSingle<{ user_id: string; purchased_credits_used: number; free_generation_used: boolean }>();
  if (!row) return false;

  // The daily ceiling is enforced HERE rather than at each of the eleven
  // call sites: this is the single function every refund in the product
  // passes through, so one check cannot be forgotten by a future caller.
  //
  // A refunded failure is a row that already ran, already failed, and had
  // its credits zeroed — so counting those in the last 24 hours is exactly
  // "how much has this account already been forgiven today".
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ data: profile }, { count: forgivenToday }] = await Promise.all([
    admin.from("profiles").select("plan, role").eq("id", row.user_id).maybeSingle<{
      plan: PlanId;
      role: string | null;
    }>(),
    admin
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", row.user_id)
      .eq("status", "failed")
      .eq("credits_used", 0)
      .gte("created_at", dayAgo),
  ]);

  // Admins are exempt, same as everywhere else — support and testing must
  // never be blocked by a customer-facing limit.
  if (profile?.role !== "admin") {
    const cap = refundedFailureDailyCap((profile?.plan ?? "none") as PlanId);
    if ((forgivenToday ?? 0) >= cap) {
      console.warn("Refund withheld: daily refunded-failure cap reached", {
        userId: row.user_id,
        cap,
        forgivenToday,
        generationId,
      });
      return false;
    }
  }

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
      // Atomic add — a read-then-write here would race a concurrent spend and
      // lose the refund (or the spend).
      await admin.rpc("add_purchased_credits", {
        p_user_id: row.user_id,
        p_amount: row.purchased_credits_used,
      });
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

  return true;
}

// Gives back ONLY the dialogue surcharge when a video is delivered silent.
//
// A dialogue request is charged up front for two extra paid steps — ElevenLabs
// speech and a Sync Labs lip-sync (see getDialogueCreditWeight). When one of
// those stages fails we still ship the already-rendered video rather than throw
// it away, and mark the whole generation SUCCEEDED — which means the ordinary
// failure-refund path never runs, and the person keeps paying for dialogue they
// did not receive. This refunds exactly that surcharge (never the video), from
// the same sources it was drawn from: the monthly allowance always (by lowering
// credits_used, which is what getMonthlyUsage sums), and the purchased-credit
// balance for the part that overflowed onto it.
//
// The atomic advance claim already means only one caller ships the silent
// video, but the write is made idempotent (conditional on the pre-refund
// values) so it can never double-apply.
async function refundDialogueSurcharge(generationId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("generations")
    .select("user_id, video_duration_seconds, credits_used, purchased_credits_used")
    .eq("id", generationId)
    .maybeSingle<{
      user_id: string;
      video_duration_seconds: number | null;
      credits_used: number | null;
      purchased_credits_used: number | null;
    }>();
  if (!row) return;

  const seconds = Number(row.video_duration_seconds) || 0;
  if (seconds <= 0) return;
  const surcharge = getDialogueCreditWeight(seconds);
  if (surcharge <= 0) return;

  const creditsUsed = Number(row.credits_used) || 0;
  const purchasedUsed = Number(row.purchased_credits_used) || 0;
  // The surcharge is the top of the charge, so the part that overflowed onto
  // purchased credits is refunded there; the rest comes off the monthly usage.
  const purchasedRefund = Math.min(surcharge, purchasedUsed);
  const newCreditsUsed = Math.max(0, creditsUsed - surcharge);
  const newPurchasedUsed = purchasedUsed - purchasedRefund;

  const { data: claimed } = await admin
    .from("generations")
    .update({ credits_used: newCreditsUsed, purchased_credits_used: newPurchasedUsed })
    .eq("id", generationId)
    .eq("credits_used", creditsUsed)
    .eq("purchased_credits_used", purchasedUsed)
    .select("id");

  if (claimed?.length && purchasedRefund > 0) {
    // Atomic add — a read-then-write would race a concurrent spend.
    await admin.rpc("add_purchased_credits", { p_user_id: row.user_id, p_amount: purchasedRefund });
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

  const { data: transitioned } = await admin
    .from("generations")
    .update({
      status: outcome.status,
      attempts: outcome.attempts.length,
      result_url: outcome.status === "succeeded" ? outcome.resultUrl : null,
      pipeline_log: outcome.attempts,
      progress_stage: null,
      // NOTE: credits are NOT zeroed here. Releasing the monthly allowance is a
      // refund, and every refund must pass through the single, flag-gated
      // refundGenerationCosts below — otherwise (as happened here) a cancelled
      // video would release its credit even with automatic_refunds OFF, letting
      // start→stop loops run unbounded paid renders at zero metered cost.
    })
    .eq("id", generationId)
    .eq("user_id", userId)
    // Only transition a row that is STILL running. If the person already
    // stopped-and-discarded it (discardStoppedGeneration sets status "failed"
    // but the job row survives), a late webhook or reaper must NOT resurrect it
    // to "succeeded" and re-charge them for a render they were told was
    // discarded. Matching zero rows here means it's already terminal.
    .eq("status", "generating")
    .select("id");

  // Always clear the job row, even when we didn't transition — a discarded
  // generation still needs its queue handle cleaned up so nothing re-processes
  // it.
  await admin.from("generation_jobs").delete().eq("generation_id", generationId);

  // Already terminal (discarded/cancelled by the user, or finished by a
  // concurrent caller): stop here. Do not refund again, notify, or feed the
  // circuit breaker for a transition that didn't happen.
  if (!transitioned?.length) return;

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
// concurrently. Terminal transitions delete the job row, so a later poll gets
// { state: "gone" }; but the INTERMEDIATE transitions (video → dialogue TTS →
// lip-sync) each submit a NEW paid provider job and merely update the row, so
// "the row still exists" is not enough on its own. Before any paid submit or
// any finish, the caller must first win claimAdvance() — an atomic per-job
// claim — so that when the client poll and fal's webhook reach a completed
// stage at the same instant, exactly one of them spends money and the other
// reports the job still pending.
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
    // Ask fal what actually happened BEFORE honouring the stop.
    //
    // This check used to come first, which meant a stop pressed at minute
    // nine of a ten-minute render refunded a video that had already
    // COMPLETED and been billed in full — we simply never looked. A cancel
    // is a request to stop work that is still running; once the work is
    // done, there is nothing left to cancel and the render has been paid
    // for either way, so the honest outcome is to deliver it.
    let finished = false;
    try {
      const late = await checkQueuedJob(jobHandle(row));
      finished = late.state === "completed";
    } catch {
      // Couldn't reach fal — fall through and treat it as a normal stop
      // rather than holding the user's credit on a guess.
    }

    if (!finished) {
      // Cancelling is a terminal, money-affecting action (it cancels the fal
      // job and finishes the row). Claim first so a poll and the webhook can't
      // both cancel-and-finish the same job.
      if (!(await claimAdvance(admin, generationId, row.provider_request_id))) {
        return { state: "pending", stage: row.stage, progress: STAGE_PROGRESS[row.stage] };
      }
      await cancelQueuedJob(jobHandle(row));
      await finish(generationId, userId, {
        status: "failed",
        attempts: appendStep(row.resume.attempts ?? [], "Stopped.", "generate"),
        fault: "user_cancelled",
      });
      return { state: "cancelled" };
    }
    // Completed before the stop landed: fall through to the normal
    // collection path below, which delivers the video and keeps the charge.
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
    // Finishing is terminal and may refund — claim so only one caller does it.
    if (!(await claimAdvance(admin, generationId, row.provider_request_id))) {
      return { state: "pending", stage: row.stage, progress: STAGE_PROGRESS[row.stage] };
    }
    // Dialogue is an enhancement on an already-rendered video, never a reason
    // to throw that video away — same rule the inline pipeline followed. If
    // the voice or lip-sync stage fails we ship the silent video instead.
    if (row.stage !== "video" && row.payload.videoUrl) {
      // Delivered silent because dialogue failed — give back the dialogue
      // surcharge the person was charged for a feature they didn't receive.
      await refundDialogueSurcharge(generationId);
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
  //
  // Claim BEFORE collecting: every branch here either submits a paid job
  // (video → TTS, TTS → lip-sync) or finishes. Two callers observing the same
  // completed stage would otherwise both submit and double-charge. The winner
  // holds the claim across its submit; the follow-up UPDATE that records the
  // next stage clears it, and finish() deletes the row — so the next stage
  // starts unclaimed and a stale caller keyed to this stage's request id can't
  // reacquire it.
  if (!(await claimAdvance(admin, generationId, row.provider_request_id))) {
    return { state: "pending", stage: row.stage, progress: STAGE_PROGRESS[row.stage] };
  }
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
          // Release the claim: the next stage is a different provider job and
          // its own advance must be able to claim it fresh.
          advance_lock: null,
          advance_locked_at: null,
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
          // Release the claim for the final stage's own advance.
          advance_lock: null,
          advance_locked_at: null,
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
      // Delivered silent because dialogue failed — refund the dialogue
      // surcharge (see the matching branch above).
      await refundDialogueSurcharge(generationId);
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

// Drives jobs nobody has polled in a long time.
//
// Run lazily whenever a workspace page loads rather than on a schedule,
// because Vercel's Hobby plan only allows one cron run per day, which is far
// too coarse. The trade-off is that this only fires while somebody is using
// the app — acceptable, since the only cost of a late reap is a stale row
// sitting at "generating" a while longer.
//
// Scoped to one user's own jobs so it stays a small, cheap query on a page
// load and can't turn into an accidental full-table sweep.
//
// Each stale job is handed to advanceGeneration — the SAME state machine the
// poller and the webhook drive — rather than a completion path reimplemented
// here. The reimplemented version this replaced only understood the `video`
// stage: a stale job whose dialogue TTS or lip-sync had already COMPLETED fell
// through to cancel-and-abandon, discarding a finished, fully-paid render and
// billing the user for a failure. Reusing advanceGeneration means every stage
// and status is handled the one correct way — collect a finished render,
// advance the next dialogue stage, ship the silent video when a dialogue stage
// fails, finish — and, because advanceGeneration takes an atomic claim before
// any paid or terminal step, this is safe even when a late poll or the fal
// webhook fires for the same job at the same instant.
//
// advanceGeneration refreshes last_polled_at as its first act and swallows fal
// transport errors as "pending", so a job that is genuinely still rendering (or
// briefly unreachable) simply drops out of the stale window and is retried on a
// later page load — never cancelled out from under a render that is still in
// progress.
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
    let result: AdvanceResult | null = null;
    try {
      result = await advanceGeneration(row.generation_id, row.user_id);
    } catch {
      // advanceGeneration handles fal transport errors internally (returning
      // "pending"), so reaching here is genuinely unexpected. Leave the row for
      // the next reap rather than deleting work we couldn't classify.
    }

    // Absolute deadline. If a real advance still left the job "pending" and its
    // current stage is older than any render could legitimately take, the
    // provider has lost it — waiting longer just keeps the row at "generating".
    if (result?.state === "pending" && Date.now() - Date.parse(row.updated_at) > ABSOLUTE_JOB_TIMEOUT_MS) {
      // Re-read: advanceGeneration may have just advanced this to a fresh stage
      // (which rewrites updated_at and the provider job id). Confirm against
      // current state so a job that genuinely progressed is never written off.
      const { data: current } = await admin
        .from("generation_jobs")
        .select("*")
        .eq("generation_id", row.generation_id)
        .maybeSingle<JobRow>();
      if (!current) continue; // already finished or collected in the meantime
      if (Date.now() - Date.parse(current.updated_at) <= ABSOLUTE_JOB_TIMEOUT_MS) continue; // advanced — fresh
      // Claim so a late poll or webhook can't be mid-advance on this same job.
      if (!(await claimAdvance(admin, current.generation_id, current.provider_request_id))) continue;
      // Stop paying fal for a render whose output will never be collected.
      // Best-effort: if fal is unreachable we still finish the row rather than
      // leave it stuck at "generating" waiting for a cancel that can't be sent.
      try {
        await cancelQueuedJob(jobHandle(current));
      } catch {
        // ignore — finishing the row is what matters
      }
      await finish(current.generation_id, current.user_id, {
        status: "failed",
        attempts: appendStep(
          current.resume?.attempts ?? [],
          "This render didn't finish in time and was stopped.",
          "generate",
        ),
        // "fal errored or lost the job" — the provider-fault case by definition.
        fault: "provider_failed",
      });
    }
  }
}
