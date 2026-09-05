// THE send quote, as one pure function (2026-09-05 audit): what a send costs
// used to be computed twice — ~60 lines of inline arithmetic in the composer
// for the display, and the server's charge paths for the money — held in
// sync by comments, with four documented drift incidents: the
// 9-quoted-45-charged multi-angle batch, the storyboard-mode frame surcharge
// quoted off lingering multiref picks, the scene fan-out priced as one
// render, and the dialogue surcharge the TOTAL omitted. Both sides now call
// quoteSend, so a surcharge CONDITION exists once; the AMOUNTS come from the
// shared helpers in video-models.ts / video-resolution.ts / scene-plan.ts,
// same as before.
//
// The inputs are FACTS about what will actually be SENT — a lingering picker
// state that won't ride must not be passed in (the exact 2026-08-31
// misquote). On the server they are the validated, post-circuit-breaker
// values, so quote and charge cannot diverge by resolving against different
// models.
//
// Relative imports on purpose: quote.test.ts loads this module, and vitest
// runs configless here with no "@/" alias (the repo's standing gotcha).
import {
  getVideoModel,
  getDurationCreditWeight,
  storyboardCreditCost,
  storyboardFrameExtraCredits,
  continuationExtraCredits,
  getDialogueCreditWeight,
  FREE_TIER_GENERATION_CREDITS,
} from "./providers/video-models";
import { resolutionCreditWeight, type VideoResolution } from "./providers/video-resolution";
import { fanoutCreditCost } from "./scene-plan";

export type SendQuoteInput = {
  contentType: "image" | "video";
  // The FINAL model — on the server, after the circuit breaker has had its
  // say, so a substituted request is priced at the model that renders it.
  videoModelId: string;
  // Validated/snapped to one of the model's real durations; the storyboard
  // TOTAL when a storyboard rides (that is what the saved row records).
  videoDurationSeconds: number;
  // Already resolved against the final model's real offers — null means the
  // base resolution, priced by the duration weight alone.
  videoResolution: VideoResolution | null;
  // Total shot seconds when a multi-shot storyboard actually rides this
  // send, else null. The caller's storyboard gates already require Kling O3
  // Pro; the weight follows the model's own per-second rate either way.
  storyboardTotalSeconds: number | null;
  // Reference photos that will actually be SENT (multiref picks that ride),
  // NOT whatever lingers in a hidden panel — 2+ photos move Kling off the
  // frame-surcharged endpoint.
  referencePhotoCount: number;
  // A start/end frame that will actually be sent.
  framePicked: boolean;
  // Source clip length when continuing, else null — continuation re-prices
  // the render over BOTH clips' durations (Seedance only; the helper
  // returns 0 elsewhere).
  continuationSourceSeconds: number | null;
  // A non-empty (trimmed) dialogue line rides this send.
  dialoguePresent: boolean;
  // 1 for a plain send; the angle count or scene shot count for a fan-out.
  renderCount: number;
};

export type SendQuote = {
  // One render's price — what each fan-out row is charged and saved at.
  perRenderCredits: number;
  // Normalized (images are always 1) — what perRenderCredits is multiplied
  // by, through fanoutCreditCost, same as the server's reservation.
  renderCount: number;
  // What THIS SEND costs — the receipt's TOTAL, the shortfall gate, and the
  // number the server hands checkGenerationAllowance.
  totalCredits: number;
  // Whether the daily free slot could cover this send (core.ts spends it
  // only on sends within the trial's pinned cost).
  freeSlotEligible: boolean;
};

export function quoteSend(input: SendQuoteInput): SendQuote {
  const video = input.contentType === "video";
  const renderCount = video ? Math.max(1, Math.trunc(input.renderCount)) : 1;
  const storyboard = video && input.storyboardTotalSeconds !== null;

  // Start/end frames ride Kling's storyboard endpoint, which bills higher
  // than the base weight assumes — but only when the frame actually rides:
  // final model kling (the helper's own check), no 2+ multi-reference photos
  // riding, no storyboard (that combination is refused outright).
  const frameExtra =
    video && !storyboard && input.framePicked && input.referencePhotoCount < 2
      ? storyboardFrameExtraCredits(input.videoModelId, input.videoDurationSeconds)
      : 0;

  // A fan-out never carries the continuation surcharge: neither the scene
  // nor the multi-angle path sends continueFromId, so quoting it inflated
  // the total by a charge the server does not make.
  const continuationExtra =
    video && renderCount === 1 && input.continuationSourceSeconds !== null
      ? continuationExtraCredits(
          input.videoModelId,
          input.videoDurationSeconds,
          input.continuationSourceSeconds,
        )
      : 0;

  // resolutionCreditWeight returns the TOTAL weight at that resolution, or
  // null when the resolution costs nothing extra or is not offered — in
  // which case the duration weight stands.
  const perRenderCredits = !video
    ? 1
    : storyboard
      ? storyboardCreditCost(input.videoModelId, input.storyboardTotalSeconds!)
      : (resolutionCreditWeight(
          input.videoModelId,
          input.videoResolution,
          input.videoDurationSeconds,
        ) ?? getDurationCreditWeight(getVideoModel(input.videoModelId), input.videoDurationSeconds)) +
        frameExtra +
        continuationExtra;

  // Dialogue runs extra paid TTS + lipsync steps, and rides only the
  // single-send path — fan-outs carry no dialogue, and storyboards reject
  // the combination outright.
  const dialogueSurcharge =
    video && renderCount === 1 && !storyboard && input.dialoguePresent
      ? getDialogueCreditWeight(input.videoDurationSeconds)
      : 0;

  const totalCredits = fanoutCreditCost(perRenderCredits, renderCount) + dialogueSurcharge;

  return {
    perRenderCredits,
    renderCount,
    totalCredits,
    freeSlotEligible: totalCredits <= FREE_TIER_GENERATION_CREDITS,
  };
}
