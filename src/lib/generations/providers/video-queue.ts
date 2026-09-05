// Which provider runs a video, and the four verbs that follow from it.
//
// WHY THIS FILE EXISTS (2026-09-04, operator: "Lets add Seedance 2.0 and 2.5
// from byteplus now"). Until now fal was not a provider behind an interface —
// fal WAS the shape of a queued render. The job row stores fal's own queue
// response in four columns (provider_request_id, status_url, response_url,
// cancel_url), and every poll, collect and cancel rebuilds it from there.
// ModelArk hands back an id and nothing else.
//
// So the seam is here, below every caller and above both clients, because
// there are TWO paid submit sites — pipeline.ts (single send) and actions.ts
// (multi-angle, which bypasses the pipeline entirely) — and a fork placed in
// either one silently leaves the other on fal. One function decides the
// provider; single send, multi-angle, polling, the reaper and Stop all read
// that one decision.
//
// SAFE BY DEFAULT. videoProviderFor returns "fal" unless BOTH switches are
// present: the API key, and an explicit lane flag. Adding a key alone must
// never reroute live customer traffic onto a lane nobody has watched work.
import {
  cancelQueuedJob as cancelFalJob,
  checkQueuedJob as checkFalJob,
  fetchQueuedVideoUrl as fetchFalVideoUrl,
  submitVideoJob as submitFalVideoJob,
  type QueuedJob,
  type QueuedJobState,
  type VideoGenerationOptions,
} from "./fal";
import {
  ARK_MODELS,
  checkArkTasks,
  isArkContentRefusal,
  deleteArkTask,
  fetchArkVideo,
  submitArkVideoJob,
} from "./byteplus";
import { getVideoModel } from "./video-models";
// The decision itself lives in video-provider.ts, which imports nothing, so
// it can be covered by tests — see the note there. Re-exported here so callers
// have one place to import from.
export {
  BYTEPLUS_MODEL_IDS,
  isByteplusCapable,
  providerFromPayload,
  providerKeyNameFor,
  videoProviderFor,
  type ByteplusModelId,
  type VideoProvider,
} from "./video-provider";
import {
  arkCallbackUrl,
  videoProviderFor,
  type ByteplusModelId,
  type VideoProvider,
} from "./video-provider";

// Compile-time coupling in the direction that matters: if ARK_MODELS loses a
// row or renames one, this assignment stops type-checking, so the hand-written
// list in video-provider.ts cannot quietly name an id the client can no longer
// send. It does NOT catch an ADDED row — assigning a reference to a Record
// permits extra keys — so a third ModelArk model still has to be added to
// BYTEPLUS_MODEL_IDS by hand to be routable.
const _arkCoverage: Record<ByteplusModelId, string> = ARK_MODELS;
void _arkCoverage;

/**
 * A queued render, plus which provider is holding it.
 *
 * The provider rides in the job row's `payload` alongside the label, which is
 * a jsonb column that already exists — so no migration, and, more usefully, a
 * row written before this code shipped has no `provider` key and reads as
 * "fal", which is exactly what it is. Rows in flight across the deploy keep
 * being polled against the provider that actually has them.
 */
export type QueuedVideoJob = QueuedJob & { provider: VideoProvider };

export async function submitVideoJob(
  prompt: string,
  modelId: string,
  options: VideoGenerationOptions = {},
): Promise<QueuedVideoJob> {
  const provider = videoProviderFor(modelId);
  if (provider === "fal") {
    return { ...(await submitFalVideoJob(prompt, modelId, options)), provider };
  }

  const model = getVideoModel(modelId);
  const label = model.name;
  // The reference list mirrors fal's Seedance branch EXACTLY (fal.ts): the
  // anchor and referenceImageUrls are either/or — the anchor IS refs[0],
  // separately signed, so prepending it double-sent that photo and pushed
  // the last real reference out of the 4-slot budget. And outfit/prop ride
  // only when they FIT the budget: the old trailing slice could drop the
  // outfit image while its citation line still said "@Image5 shows only an
  // outfit" — pointing the model at a photo of someone's face, or nothing.
  // byteplus.ts states the cap is the caller's job; Seedance budgets 4.
  const references = (
    options.referenceImageUrls?.length
      ? options.referenceImageUrls
      : options.characterAnchorImageUrl
        ? [options.characterAnchorImageUrl]
        : []
  ).slice(0, 4);
  const outfit = references.length < 4 ? options.outfitImageUrl : undefined;
  const prop = references.length + (outfit ? 1 : 0) < 4 ? options.propImageUrl : undefined;
  const images = [...references, ...(outfit ? [outfit] : []), ...(prop ? [prop] : [])];

  // Same citation lines fal's Seedance branch writes, and the same "@ImageN"
  // spelling — confirmed on 2026-09-04 against ByteDance's own request sample
  // in the ModelArk Video Generation API reference, whose prompt reads "The
  // strawberry flavor refers to @Image1". An older note in byteplus.ts said
  // their sample wrote "Image 1" without the @; it does not.
  const citations = [
    options.continueFromVideoUrl
      ? "The video continues directly from the final moment of @Video1 — same setting, same light, no cut back."
      : null,
    references.length
      ? "The person in this video is @Image1 — match their face, hair, and features exactly, but do not copy the pose or framing of that photo."
      : null,
    outfit
      ? `@Image${references.length + 1} shows only an outfit laid out, never a person — the person wears exactly that outfit: reproduce its design, colours, logos, and stitching.`
      : null,
    prop
      ? `@Image${references.length + (outfit ? 1 : 0) + 1} is an image the user attached — the prompt above says how to use it; do not copy its framing or composition unless the prompt asks for that.`
      : null,
  ].filter(Boolean);

  try {
    const taskId = await submitArkVideoJob({
      model: ARK_MODELS[modelId as keyof typeof ARK_MODELS],
      prompt: citations.length ? `${prompt}\n\n${citations.join(" ")}` : prompt,
      durationSeconds: options.durationSeconds ?? 5,
      ratio: options.aspectRatio ?? "16:9",
      // 480p is deliberately not offered, and the API reference documents no
      // default for this field — see the note in byteplus.ts.
      resolution: "720p",
      generateAudio: options.generateNativeAudio ?? true,
      watermark: false,
      referenceImageUrls: images,
      referenceVideoUrl: options.continueFromVideoUrl ?? undefined,
      // Null in local development and whenever no shared secret is set — see
      // arkCallbackUrl. Polling covers those cases, exactly as it does for
      // fal's webhook.
      callbackUrl: arkCallbackUrl(),
    });
    return {
      provider,
      requestId: taskId,
      // ModelArk addresses a task by id against one fixed path, so there are
      // no per-job URLs to keep. Empty rather than fabricated: jobHandle reads
      // these back and nothing on this lane may follow them.
      statusUrl: "",
      responseUrl: "",
      cancelUrl: "",
      label,
    };
  } catch (err) {
    // Re-thrown with the model named, matching the shape fal's errors carry —
    // "<prefix> error (NNN): <body>". Six independent classifiers key on that
    // "(NNN):" (retry, refund, transport-vs-verdict, the user-facing prefix
    // strip, the breaker, and the client-side detail scan), and every one of
    // them is already provider-agnostic. Losing the status here would make a
    // terminal 4xx look like an outage and retry it for 45 minutes.
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message.replace(/^BytePlus ModelArk error/, `BytePlus ModelArk (${label}) error`));
  }
}

/**
 * A ModelArk task that FAILED carries no HTTP status — it is a serialized
 * task object — and six classifiers in this codebase read the status out of
 * the message to decide whether a failure is the provider judging this
 * request or the provider falling over. A likeness refusal is the former, and
 * it is the same event fal reports as a 422; giving it the same shape makes
 * every one of those classifiers behave as it already does for fal, instead
 * of counting a rejected photo toward the model breaker and telling the next
 * customer the engine is unavailable.
 *
 * Anything else that failed keeps no status: a render that broke after being
 * accepted really is provider-side, which is what the breaker is for.
 */
function describeArkFailure(error: string, label: string): string {
  const refusal = isArkContentRefusal(error);
  return refusal
    ? `BytePlus ModelArk (${label}) error (422): ${error}`
    : `BytePlus ModelArk (${label}): ${error}`;
}

export async function checkVideoJob(job: QueuedVideoJob): Promise<QueuedJobState> {
  if (job.provider === "fal") return checkFalJob(job);
  const states = await checkArkTasks([job.requestId]);
  const state = states.get(job.requestId);
  if (state?.state === "failed") {
    return { state: "failed", error: describeArkFailure(state.error, job.label) };
  }
  return (
    state ?? {
      // A task ModelArk no longer lists is gone, not pending: cancelled rows
      // are queryable for 24 hours and then deleted. Reporting "pending" for
      // one would spin the poller until the 45-minute write-off.
      state: "failed",
      error: `BytePlus ModelArk (${job.label}) error (404): task ${job.requestId} is no longer listed.`,
    }
  );
}

export async function fetchVideoUrl(job: QueuedVideoJob): Promise<string> {
  if (job.provider === "fal") return fetchFalVideoUrl(job);
  const { url } = await fetchArkVideo(job.requestId);
  return url;
}

export async function cancelVideoJob(job: QueuedVideoJob): Promise<void> {
  if (job.provider === "fal") return cancelFalJob(job);
  // ANSWERED 2026-09-04. A queued task really is cancelled and not billed; a
  // RUNNING one cannot be deleted at all, and a finished one only loses its
  // record. So this call stops the work only if we got there before it
  // started. deleteArkTask returns false rather than throwing in that case,
  // because a documented refusal is not a provider fault — the caller's own
  // row still finishes as cancelled, which is the honest outcome: the customer
  // has stopped waiting, and if it was already running they were always going
  // to be billed for it.
  await deleteArkTask(job.requestId);
}
