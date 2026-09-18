import type { SupabaseClient } from "@supabase/supabase-js";
import { generateImage } from "@/lib/generations/providers/image";
import { scoreIdentityMatch } from "@/lib/generations/providers/openai";
import { cutToBand } from "@/lib/sets/frame-cut";
import { betterAttemptScore, identityGateDecision } from "@/lib/generations/identity-gate";
import {
  OPENING_FRAMES_FOLDER,
  openingFrameLogLine,
  openingFramePrompt,
  openingFrameShape,
  timeForAnotherPaint,
} from "@/lib/generations/opening-frame";

/**
 * Removes every opening frame a generation painted (opening-frame.ts,
 * openingFramePath). Called once the clip has landed or failed — fal fetched
 * the frame when the render started, and nothing else ever reads it.
 * Best-effort: a missed removal leaves a file the account sweep still reaches.
 */
export async function removeOpeningFrames(
  admin: SupabaseClient,
  userId: string,
  generationId: string,
): Promise<void> {
  try {
    const folder = `${userId}/${OPENING_FRAMES_FOLDER}`;
    const { data, error } = await admin.storage.from("generated-images").list(folder, { search: generationId });
    if (error || !data?.length) return;
    const paths = data
      .filter((f) => f.name.startsWith(`${generationId}-`))
      .map((f) => `${folder}/${f.name}`);
    if (paths.length === 0) return;
    const { error: removeError } = await admin.storage.from("generated-images").remove(paths);
    if (removeError) console.warn(`Couldn't remove the opening frames of ${generationId}:`, removeError.message);
  } catch (err) {
    console.warn(`Couldn't remove the opening frames of ${generationId}:`, err);
  }
}

// The opening frame's plumbing: paint, read, re-paint once, choose, clean up.
// The policy — when it applies, what it asks for, when there is time — lives
// in opening-frame.ts, pure and tested; everything here is mechanical, the
// same split as identity-gate.ts / identity-gate-run.ts.
//
// NEVER FAILS A RENDER. Every path that is not "a frame that cleared the
// bar" returns url: null, and the caller opens the clip on the character's
// photo exactly as it did before this file existed.

export type OpeningFrameDeps = {
  /** The drafted, reviewed video prompt — the shot the frame opens. */
  videoPrompt: string;
  aspectRatio: "16:9" | "9:16";
  /** The photo the clip would otherwise open on; the paint is anchored to it. */
  anchorUrl: string;
  /** The identity photo the scorer reads against (reference_image_urls[0]). */
  identityUrl: string | null;
  traitSummary: string;
  /** The identity gate's bar. 0 = the gate is off: the frame is used unread-for-pass. */
  threshold: number;
  /** When the whole send must have handed its video to the provider by. */
  deadlineAt: number;
  /** Stores a PNG (base64) in generated-images and returns its stored URL. */
  persist: (base64: string) => Promise<string>;
  /** A stored URL as one fal and OpenAI can download. */
  absolutize: (storedUrl: string) => string;
  /** Deletes a frame nobody will use. Best-effort, never throws. */
  discard: (storedUrl: string) => Promise<void>;
  now?: () => number;
};

export type OpeningFrameResult = {
  /** The frame to open on, absolute — or null to open on the photo. */
  url: string | null;
  /** Its stored URL, for the record. */
  storedUrl: string | null;
  /** Every face score read, in paint order (null = the scorer could not read it). */
  scores: (number | null)[];
  logLine: string;
  /** What the paints cost, from OpenAI's own usage (openai-images.ts). */
  usd: number;
};

type Paint = { stored: string; score: number | null; unusable: boolean };

class OutOfTime extends Error {}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OutOfTime("opening frame ran out of time")), Math.max(0, ms));
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export async function makeOpeningFrame(deps: OpeningFrameDeps): Promise<OpeningFrameResult> {
  const now = deps.now ?? Date.now;
  const { size, band } = openingFrameShape(deps.aspectRatio);
  const prompt = openingFramePrompt(deps.videoPrompt);
  const scores: (number | null)[] = [];
  let usd = 0;

  const fallback = (reason: "missed" | "no-time" | "error"): OpeningFrameResult => ({
    url: null,
    storedUrl: null,
    scores,
    usd,
    logLine: openingFrameLogLine({ used: false, scores, threshold: deps.threshold, reason }),
  });

  const openOn = (paint: Paint): OpeningFrameResult => ({
    url: deps.absolutize(paint.stored),
    storedUrl: paint.stored,
    scores,
    usd,
    logLine: openingFrameLogLine({ used: true, scores, threshold: deps.threshold }),
  });

  const paint = async (): Promise<Paint> => {
    const stored = await generateImage(
      "gpt-image",
      prompt,
      deps.anchorUrl,
      async (base64) => deps.persist(await cutToBand(base64, band)),
      undefined,
      undefined,
      null,
      null,
      null,
      null,
      (usage) => {
        usd += usage.usd;
      },
      size,
    );
    let verdict: Awaited<ReturnType<typeof scoreIdentityMatch>> = null;
    if (deps.identityUrl) {
      try {
        verdict = await scoreIdentityMatch(deps.absolutize(stored), deps.identityUrl, deps.traitSummary);
      } catch {
        verdict = null;
      }
    }
    // No face in the frame (scorer p2): the video model would have to invent
    // the face when the character turns round, which is the very thing this
    // frame exists to prevent — so it is no more usable than a blank one.
    const faceless = verdict?.faceVisible === false;
    const result = {
      stored,
      score: verdict && !faceless ? verdict.score : null,
      unusable: verdict?.unusable === true || faceless,
    };
    scores.push(result.score);
    return result;
  };

  // A paint is only started when it can finish with room left for the video
  // submit — running past the platform ceiling would lose the whole send.
  if (!timeForAnotherPaint(now(), deps.deadlineAt)) return fallback("no-time");

  let first: Paint;
  try {
    first = await withDeadline(paint(), deps.deadlineAt - now());
  } catch (err) {
    return fallback(err instanceof OutOfTime ? "no-time" : "error");
  }

  // A blank or corrupt frame never opens a clip, whatever the gate says —
  // it is the one reading that means "this is not a picture of anyone".
  const firstDecision = first.unusable
    ? ({ action: "retry", score: 0 } as const)
    : identityGateDecision({ score: first.score, threshold: deps.threshold, retriesUsed: 0 });
  if (firstDecision.action === "pass") return openOn(first);

  // Under the bar: one more paint, if there is time for it.
  if (!timeForAnotherPaint(now(), deps.deadlineAt)) {
    await deps.discard(first.stored);
    return fallback("missed");
  }
  let second: Paint;
  try {
    second = await withDeadline(paint(), deps.deadlineAt - now());
  } catch {
    await deps.discard(first.stored);
    return fallback("missed");
  }

  if (second.unusable) {
    await Promise.all([deps.discard(first.stored), deps.discard(second.stored)]);
    return fallback("missed");
  }
  const secondDecision = identityGateDecision({
    score: second.score,
    threshold: deps.threshold,
    retriesUsed: 1,
    previousScore: first.unusable ? null : first.score,
  });
  // A pass that measured nothing ("not-scored") after a first frame that was
  // blank or faceless leaves no frame known to show the person — that one
  // falls through to the photo. Above the bar, or with the gate off, it opens.
  if (secondDecision.action === "pass" && secondDecision.reason !== "not-scored") {
    const keepFirst = !first.unusable && betterAttemptScore(first.score, second.score) === "first";
    const [kept, dropped] = keepFirst ? [first, second] : [second, first];
    await deps.discard(dropped.stored);
    return openOn(kept);
  }
  // Missed twice, or the re-paint could not be read after a measured miss:
  // neither frame is known to be the person. Open on the photo.
  await Promise.all([deps.discard(first.stored), deps.discard(second.stored)]);
  return fallback("missed");
}
