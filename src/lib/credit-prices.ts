// The one-balance price list (2026-10-01, operator: "Adopt the one-balance
// pricing plan at 30%"; the plan: claude.ai/artifact/61LtACNyxPVMaoypy183uH).
//
// ONE RULE. A credit may carry at most CREDIT_COST_USD of our cost. Every
// action's price is its FULL cost over that, rounded up, so no credit spent
// on anything can cost us more than two cents. Full cost is everything the
// action makes us pay, not just the engine: the prompt draft, the safety
// gates, the face reads, and the retries and re-renders we measured. The
// plans (credit-plans.ts) are sized so that a customer who spends every
// credit still leaves the margin floor; this file is what makes "every
// credit" a number we can trust.
//
// Phase 1: this file stands beside the live prices (quote.ts and the
// catalogues' creditWeight, on the old $0.28 credit) and changes nothing a
// customer sees; the switch reads from here. Every cost below is read from
// its source, named where it is used (money-numbers-from-source).
//
// Relative imports only: the test suite loads this module as it is.

import {
  DIALOGUE_TTS_ALLOWANCE_USD,
  getVideoModel,
  KLING_STORYBOARD_PER_SECOND_USD,
  SYNC_LIPSYNC_PER_SECOND_USD,
  WITH_VIDEO_INPUT_MULTIPLIER,
} from "./generations/providers/video-models";
import { videoResolutionOffers, type VideoResolution } from "./generations/providers/video-resolution";
import {
  defaultImageResolution,
  imageQualityOffers,
  imageResolutionOffers,
  type ImageQuality,
  type ImageResolution,
} from "./generations/providers/image-resolution";

/** The most of our cost one credit may carry. */
export const CREDIT_COST_USD = 0.02;

/**
 * What every render makes us pay besides its engine, per attempt.
 *
 * - draftUsd: Claude's prompt draft, the share the old credit basis carried
 *   for it (video-models.ts, "(0.28 provider + 0.02 drafting) x 1.132").
 * - gatesUsd: the prompt gate's readers for the send (gpt-5.4-mini and
 *   Sonnet 5, more at an edge). The code measures no figure for it
 *   (set-config.ts, "per send not in code"); budgeted here until measured.
 * - safetyUsd: the output gate's vision read of the finished picture, at
 *   most: the same gpt-5.4-mini read the free checker measured at about
 *   $0.011 (changelog, the checker's daily ceiling).
 * - faceReadUsd: one face reading on gpt-5.5 with three references,
 *   "≈ $0.041 a reading" (providers/openai-model.ts). A picture with a
 *   character is read twice by the gate; a video is read on three frames
 *   per character (face-lock.ts).
 * - attempts: provider attempts per generation, measured 2026-08-30
 *   (video-models.ts; re-measured 1.083 on 2026-09-08, kept at the higher).
 * - pictureGateFactor: what the identity gate adds to a charged character
 *   picture, measured on production 2026-09-30: 59 scored pictures took 63
 *   renders and 58 were charged (4 re-rendered, 1 refunded after two misses).
 */
export const OVERHEAD = {
  draftUsd: 0.02,
  gatesUsd: 0.01,
  safetyUsd: 0.011,
  faceReadUsd: 0.041,
  attempts: 1.132,
  pictureGateFactor: 63 / 58,
} as const;

/** Face readings: two for a picture's gate, three frames for each character in a video. */
const PICTURE_FACE_READS = 2;
const VIDEO_FACE_READS_PER_CHARACTER = 3;

/** An action's price: its full cost over CREDIT_COST_USD, rounded up; never less than one credit. */
export function creditsFor(costUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 1;
  // The epsilon keeps an exact multiple (0.2 over 0.02) from rounding up on floating point.
  return Math.max(1, Math.ceil(costUsd / CREDIT_COST_USD - 1e-9));
}

// ---------------------------------------------------------------------------
// Renders
// ---------------------------------------------------------------------------

export type VideoPriceInput = {
  modelId: string;
  seconds: number;
  /** A priced resolution the model offers, or null for its base. */
  resolution: VideoResolution | null;
  /** Total seconds of a multi-shot storyboard, else null. */
  storyboardTotalSeconds: number | null;
  /** A start or end frame rides (Kling moves to its frames endpoint). */
  framePicked: boolean;
  referencePhotoCount: number;
  /** The source clip's length when continuing one, else null. */
  continuationSourceSeconds: number | null;
  /** How many characters' faces are read (0 without one; each costs three reads). */
  characters: number;
};

/** What the engine charges us for one clip, as the render lane sends it. */
export function videoProviderUsd(input: VideoPriceInput): number {
  const model = getVideoModel(input.modelId);
  if (input.storyboardTotalSeconds !== null) {
    // Storyboard: the whole run at the model's own rate (video-models.ts storyboardCreditCost).
    return input.storyboardTotalSeconds * (model.costPerSecondUsd ?? 0.14);
  }
  const offer = input.resolution
    ? videoResolutionOffers(input.modelId).find((o) => o.value === input.resolution && o.costPerSecondUsd)
    : undefined;
  let perSecond = offer?.costPerSecondUsd ?? model.costPerSecondUsd;
  // Kling with a start or end frame renders on the frames endpoint (KLING_STORYBOARD_PER_SECOND_USD),
  // unless two or more reference photos move it to multi-reference (quote.ts frameExtra's rule).
  if (input.modelId === "kling" && input.framePicked && input.referencePhotoCount < 2) {
    perSecond = Math.max(perSecond, KLING_STORYBOARD_PER_SECOND_USD);
  }
  let usd = perSecond * input.seconds;
  // Continuing a clip re-prices the render over both durations at the with-video rate
  // (video-models.ts continuationExtraCredits: Seedance only).
  if (
    input.continuationSourceSeconds !== null &&
    input.continuationSourceSeconds > 0 &&
    (input.modelId === "seedance" || input.modelId === "seedance-2")
  ) {
    usd = Math.max(usd, WITH_VIDEO_INPUT_MULTIPLIER * model.costPerSecondUsd * (input.seconds + input.continuationSourceSeconds));
  }
  return usd;
}

/** One clip's full cost: the engine plus every overhead, over the measured attempts. */
export function videoCostUsd(input: VideoPriceInput): number {
  const faceReads = VIDEO_FACE_READS_PER_CHARACTER * Math.max(0, Math.trunc(input.characters));
  const perAttempt =
    videoProviderUsd(input) + OVERHEAD.draftUsd + OVERHEAD.gatesUsd + OVERHEAD.safetyUsd + faceReads * OVERHEAD.faceReadUsd;
  return perAttempt * OVERHEAD.attempts;
}

/** A spoken line on a clip: ElevenLabs speech plus Sync's lipsync over the whole clip (video-models.ts). */
export function dialogueCostUsd(seconds: number): number {
  return SYNC_LIPSYNC_PER_SECOND_USD * seconds + DIALOGUE_TTS_ALLOWANCE_USD;
}

export type PicturePriceInput = {
  modelId: string;
  resolution: ImageResolution | null;
  quality: ImageQuality | null;
  /** A character's face rides, so the identity gate reads it (and may render it again). */
  character: boolean;
};

/** What the picture lane charges us for one picture: the dearer of its size band and its quality tier. */
export function pictureProviderUsd(input: PicturePriceInput): number {
  const sizes = imageResolutionOffers(input.modelId);
  const size =
    sizes.find((o) => o.value === input.resolution) ??
    sizes.find((o) => o.value === defaultImageResolution(input.modelId)) ??
    sizes[0];
  const qualities = imageQualityOffers(input.modelId);
  const quality = qualities.find((o) => o.value === input.quality) ?? qualities.find((o) => o.value === "high");
  return Math.max(size?.costPerImageUsd ?? 0, quality?.costPerImageUsd ?? 0);
}

/** One picture's full cost: the lane plus every overhead, and for a character, the gate's measured re-renders. */
export function pictureCostUsd(input: PicturePriceInput): number {
  const faceReads = input.character ? PICTURE_FACE_READS : 0;
  const perAttempt =
    pictureProviderUsd(input) + OVERHEAD.draftUsd + OVERHEAD.gatesUsd + OVERHEAD.safetyUsd + faceReads * OVERHEAD.faceReadUsd;
  return perAttempt * OVERHEAD.attempts * (input.character ? OVERHEAD.pictureGateFactor : 1);
}

export type SendPriceInput = {
  contentType: "image" | "video";
  imageModelId?: string;
  imageResolution?: ImageResolution | null;
  imageQuality?: ImageQuality | null;
  videoModelId: string;
  videoDurationSeconds: number;
  videoResolution: VideoResolution | null;
  storyboardTotalSeconds: number | null;
  referencePhotoCount: number;
  framePicked: boolean;
  continuationSourceSeconds: number | null;
  dialoguePresent: boolean;
  /** 1 for a plain send; the angle or shot count for a fan-out. */
  renderCount: number;
  /** Characters whose faces are read on each render (0 or more). */
  characters: number;
};

export type SendPrice = { perRenderCredits: number; renderCount: number; totalCredits: number };

/**
 * A send's price in the new credits: the same facts quote.ts reads, priced
 * from cost. A fan-out is one price per render; dialogue rides only a single
 * video send, as today.
 */
export function priceSend(input: SendPriceInput): SendPrice {
  const video = input.contentType === "video";
  const renderCount = video ? Math.max(1, Math.trunc(input.renderCount)) : 1;
  const storyboard = video && input.storyboardTotalSeconds !== null;
  const perRenderCredits = video
    ? creditsFor(
        videoCostUsd({
          modelId: input.videoModelId,
          seconds: input.videoDurationSeconds,
          resolution: storyboard ? null : input.videoResolution,
          storyboardTotalSeconds: storyboard ? input.storyboardTotalSeconds : null,
          framePicked: !storyboard && input.framePicked,
          referencePhotoCount: input.referencePhotoCount,
          continuationSourceSeconds: renderCount === 1 ? input.continuationSourceSeconds : null,
          characters: input.characters,
        }),
      )
    : creditsFor(
        pictureCostUsd({
          modelId: input.imageModelId ?? "gpt-image",
          resolution: input.imageResolution ?? null,
          quality: input.imageQuality ?? null,
          character: input.characters > 0,
        }),
      );
  const dialogue =
    video && renderCount === 1 && !storyboard && input.dialoguePresent ? creditsFor(dialogueCostUsd(input.videoDurationSeconds)) : 0;
  return { perRenderCredits, renderCount, totalCredits: perRenderCredits * renderCount + dialogue };
}

// ---------------------------------------------------------------------------
// Everything else that costs us money, now paid from the same balance
// ---------------------------------------------------------------------------

/**
 * Each action's full cost in dollars, from its source. Priced with
 * creditsFor like everything else (actionCredits below).
 *
 * - alyMessage: one assistant unit, "1 unit = $0.02" (agent/prices.ts); a
 *   Faster turn settles at about one, "Think harder" at about two. Units
 *   and new credits are the same size, so a turn costs what it settles at.
 * - characterPhoto: one AI character photo or expression close-up on GPT
 *   Image 2.5, $0.0736 a close-up at worst (docs/EXPRESSION_SET.md; photos
 *   $0.0531-0.0611, providers/image-resolution.ts).
 * - heliosBuild: a set built from words with its one automatic retry, worst
 *   case "$0.53 + $0.625 = $1.155" (sets/set-config.ts).
 * - heliosEdit: one Astra edit, "$0.1209 + $0.50 = $0.6209" (sets/set-config.ts).
 * - promptAssist: an Enhance, a scene plan or an image read, booked at $0.01
 *   (admin/economics.ts PROMPT_ASSIST_COST_USD) plus the prompt gate's readers.
 */
export const ACTION_COST_USD = {
  alyMessage: 0.02,
  characterPhoto: 0.0736,
  heliosBuild: 1.155,
  heliosEdit: 0.6209,
  promptAssist: 0.01 + OVERHEAD.gatesUsd,
} as const;

export type PricedAction = keyof typeof ACTION_COST_USD;

export function actionCredits(action: PricedAction): number {
  return creditsFor(ACTION_COST_USD[action]);
}
