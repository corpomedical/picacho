import { isFirstFrameLane } from "./face-lock";

// THE OPENING FRAME (2026-09-18).
//
// On four lanes — Kling O3, Kling 2.5, Veo and Wan Turbo, mechanism
// "first-frame" in send-plan.ts — the video opens on a picture we hand it.
// Until today that picture was the character's own reference photo, reframed
// to the clip's shape: the clip opened on a posed portrait in the photo's own
// room and had to grow the scene out of it. fal.ts has fought the symptom for
// weeks with negative prompts ("static posed portrait, frozen first frame,
// motionless opening shot"); the cause is the frame itself.
//
// So the opening frame is now MADE, and checked, before any video money is
// spent:
//
//   1. Our image engine paints the shot's first moment from the drafted
//      video prompt, anchored to the same photo the video would have opened
//      on — the character in the scene, not a selfie in its own room.
//   2. The identity scorer reads it against the identity photo, under the
//      same gate the image lane runs (identity-gate.ts): one free re-paint
//      under the bar, keep the better of two.
//   3. Only a frame that clears the bar opens the clip. One that misses
//      twice is thrown away and the clip opens on the photo exactly as it
//      did yesterday — a known face in the wrong room beats a wrong face in
//      the right one.
//
// It never fails a render: every error, a scorer outage aside, falls back to
// yesterday's behaviour. Behind its own feature flag, OFF until the operator
// turns it on, because it costs a picture per clip.
//
// This file is the policy — pure, alias-free, tested. opening-frame-run.ts is
// the plumbing that acts on it.

/** The feature_flags row. Inserted OFF (supabase/applied/2026-09-22/face-lock.sql, run 2026-09-22). */
export const OPENING_FRAME_FLAG = "opening_frame";

export type OpeningFrameInput = {
  flagOn: boolean;
  contentType: "video" | "image";
  modelId: string;
  /** The single-character anchor the clip would otherwise open on. */
  hasCharacterAnchor: boolean;
  /**
   * The person attached a photo to this send. That photo is their intent for
   * this one render and stays the source — the same rule the baseline
   * multi-reference path follows in actions.ts.
   */
  hasAttachment: boolean;
  /** Start/end frames the person picked themselves (the storyboard lane). */
  hasStoryboard: boolean;
  /** Two or more reference photos riding — the elements path, not this one. */
  hasMultiReference: boolean;
  /** Clip continuation — the clip's world comes from the earlier clip. */
  hasContinuation: boolean;
};

/** Whether this send's clip should open on a made, checked frame. */
export function openingFrameApplies(input: OpeningFrameInput): boolean {
  return (
    input.flagOn &&
    input.contentType === "video" &&
    isFirstFrameLane(input.modelId) &&
    input.hasCharacterAnchor &&
    !input.hasAttachment &&
    !input.hasStoryboard &&
    !input.hasMultiReference &&
    !input.hasContinuation
  );
}

/**
 * The picture to ask for, and the band to cut it to.
 *
 * GPT Image paints 1536x1024 or 1024x1536, and the clip is 16:9 or 9:16. On
 * Kling O3 and 2.5 — no aspect_ratio parameter — the picture's shape IS the
 * clip's shape (the 2026-08-07 pillarbox incident), so the frame is cut to
 * the exact band on our side rather than handed to fal's reframe, which
 * repaints the edges and has refused photoreal faces (2026-08-19).
 */
export function openingFrameShape(aspectRatio: "16:9" | "9:16"): {
  size: "1536x1024" | "1024x1536";
  band: number;
} {
  return aspectRatio === "9:16" ? { size: "1024x1536", band: 9 / 16 } : { size: "1536x1024", band: 16 / 9 };
}

/**
 * The words the image engine gets: the drafted video prompt, framed as the
 * single instant before the shot moves. The identity sentence follows the
 * one fal.ts puts on O3 Pro's citation — match the person, never the photo's
 * pose, framing or room — because on this lane that photo is exactly what
 * the frame is replacing.
 */
export function openingFramePrompt(videoPrompt: string): string {
  return (
    "One photograph: the opening frame of the shot described below — the instant before it starts " +
    "to move, in its own place and light, framed the way the shot begins. The person in it is the " +
    "person in the reference photo: match their face, hair and features exactly, but do not copy that " +
    "photo's pose, framing or background unless the shot asks for them. A single frame — no " +
    "collage, no split screen, no text or captions.\n\n" +
    videoPrompt.trim()
  );
}

/**
 * Whether there is time for a paint (and a read) before the request's own
 * deadline. A paint that runs past the platform's 300 s ceiling kills the
 * whole send, video included, so the frame is only attempted when it can
 * finish with room left for the video submit.
 */
export const OPENING_FRAME_PAINT_MS = 75_000;

export function timeForAnotherPaint(now: number, deadlineAt: number): boolean {
  return deadlineAt - now >= OPENING_FRAME_PAINT_MS;
}

/**
 * Where a send's opening frames are stored: under the owner's folder (so the
 * account sweep reaches them), named for the generation (so its finish can
 * find and remove them), numbered per paint. A frame is a picture of a
 * person that nobody sees once the clip exists, so it is not kept: finish()
 * removes every one of a generation's frames the moment the clip lands or
 * fails (job-runner.ts, removeOpeningFrames).
 *
 * Numbered across the whole send, not per call: a redraft paints again, and
 * persistImageBytes answers "already exists" with the OLD file's URL — a
 * reused name would quietly open the clip on the previous prompt's frame.
 */
export const OPENING_FRAMES_FOLDER = "opening-frames";

export function openingFramePath(userId: string, generationId: string, paint: number): string {
  return `${userId}/${OPENING_FRAMES_FOLDER}/${generationId}-${paint}.png`;
}

/** The log line that says what opened the clip, in plain words. */
export function openingFrameLogLine(outcome: {
  used: boolean;
  scores: (number | null)[];
  threshold: number;
  reason?: "missed" | "no-time" | "error";
}): string {
  const read = outcome.scores.filter((s): s is number => typeof s === "number");
  const scoreText = read.length > 0 ? ` (face ${read.join(", then ")})` : "";
  if (outcome.used) {
    return read.length > 0
      ? `Opening frame made from the character's photo and face-checked${scoreText}.`
      : "Opening frame made from the character's photo; the face check could not run, so the clip itself is checked instead.";
  }
  if (outcome.reason === "missed") {
    return `The opening frame missed the character's face${scoreText}, under ${outcome.threshold} — the clip opens on the character's photo instead.`;
  }
  if (outcome.reason === "no-time") {
    return "No time left to make an opening frame — the clip opens on the character's photo.";
  }
  return "The opening frame could not be made — the clip opens on the character's photo.";
}
