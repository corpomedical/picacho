// What the identity score DOES, as opposed to what it says.
//
// Its own alias-free module so it can be unit-tested — same reasoning as
// refund-rules.ts and video-resolution.ts. The rules that decide whether to
// spend provider money on a second render must be testable without booting
// Supabase, fal, or Next.
//
// THE DEFECT THIS CLOSES (carried as an open item since 2026-08-30). Picacho
// scores every character render against the character's own identity photo
// and prints the number under the result. Until now that number branched
// nowhere: /compare/higgsfield and /compare/imagineart both sell "the
// identity verified, not assumed — every image scored against the identity
// photo, number printed under the result", and the score was decoration. A
// score a user can see but that changes nothing is a weaker asset than the
// same score used to route.
//
// THE SHAPE (operator decisions, 2026-09-01):
//   miss  -> ONE free re-render, and keep whichever attempt scored higher
//   miss twice -> force-refund the credit, and still deliver the better one
//   threshold 70, tunable from Admin without a deploy
//
// The retry is free to the USER. It is not free to us — a second render bills
// fal or OpenAI exactly like the first — so every rule below is written to
// make the gate fire on a real miss and nothing else.

/** Default threshold. Overridden at runtime by the `identity_gate_threshold` app setting. */
export const DEFAULT_IDENTITY_THRESHOLD = 70;

/**
 * A threshold of 0 disables the gate entirely, which is a deliberate kill
 * switch: if the gate ever starts firing on renders that are actually fine,
 * it can be turned off from Admin without a deploy.
 *
 * The ceiling is 95 rather than 100 on purpose. The scorer is a vision model
 * reading a rendered face against a photograph; it essentially never returns
 * 100, so a threshold of 100 would retry every render ever made and then
 * refund every one of them — an unbounded provider bill and a zero-revenue
 * product, reachable by one typo in an admin field.
 */
export const MIN_IDENTITY_THRESHOLD = 0;
export const MAX_IDENTITY_THRESHOLD = 95;

/**
 * Reads the admin-set threshold from a row that EXISTS.
 *
 * A malformed value falls back to the default rather than to zero, because
 * "the gate quietly stopped working" looks identical to "no render ever
 * misses" — a typo in the admin field must not silently disable the feature.
 *
 * DO NOT call this when the app_settings row is ABSENT. Use
 * resolveIdentityThresholdSetting below, which is the only caller-facing
 * entry point, and which treats absence as OFF. The distinction is the whole
 * point: an absent row means the migration has not been applied yet, and
 * defaulting THAT to 70 would turn the gate on — spending a second render on
 * every miss and force-refunding every double miss — in exactly the window
 * where no admin field exists to turn it off, because Admin > Settings
 * renders one card per existing row.
 */
export function resolveIdentityThreshold(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === "") return DEFAULT_IDENTITY_THRESHOLD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_IDENTITY_THRESHOLD;
  const rounded = Math.round(parsed);
  if (rounded < MIN_IDENTITY_THRESHOLD || rounded > MAX_IDENTITY_THRESHOLD) {
    return DEFAULT_IDENTITY_THRESHOLD;
  }
  return rounded;
}

export type GateInput = {
  /** The score just measured, or null when scoring could not run at all. */
  score: number | null;
  /** The resolved threshold (see resolveIdentityThreshold). */
  threshold: number;
  /** How many free re-renders this generation has already been given. */
  retriesUsed: number;
  /**
   * The score of the earlier attempt, when this IS the retry. null on the
   * first pass through.
   */
  previousScore?: number | null;
};

export type GateDecision =
  /**
   * Good enough, or not gateable. Deliver, charge normally, do nothing.
   *
   * `keepPrevious` is present only when this verdict is being given ON a
   * retry, and it exists because "pass" does not mean "ship the file you
   * just made". A retry that scores 75 against a first attempt's 80 has
   * cleared the bar while still being the worse of two images the user can
   * see the scores of.
   */
  | {
      action: "pass";
      reason: "above-threshold" | "not-scored" | "gate-disabled";
      keepPrevious?: boolean;
    }
  /** Under the bar and a retry is still owed. Render once more, free. */
  | { action: "retry"; score: number }
  /**
   * Under the bar twice. Deliver the better attempt, refund the credit.
   *
   * `keepPrevious` says the FIRST attempt scored higher than the retry, which
   * happens often enough to matter — a re-roll is not monotonically better.
   * `bestScore` is the score of the attempt actually being kept, NOT the one
   * just measured: reporting the retry's number while shipping the first
   * attempt's file would print a score that belongs to a render the person
   * never receives.
   */
  | { action: "settle"; score: number; bestScore: number; keepPrevious: boolean };

/**
 * The whole policy, in one pure function.
 *
 * Read the null case first, because it is the one that protects the money.
 * scoreIdentityMatch is explicitly best-effort — actions.ts calls it inside a
 * try/catch whose comment reads "a scoring hiccup never affects the
 * generation itself" — so it returns null on a timeout, a rate limit, a
 * malformed reply, or a missing identity photo. If null were treated as a
 * miss, then every OpenAI blip would re-render every image in flight at our
 * expense AND refund all of them. A render we could not measure is delivered
 * and charged exactly as it was before this module existed.
 */
export function identityGateDecision({
  score,
  threshold,
  retriesUsed,
  previousScore,
}: GateInput): GateDecision {
  const prior =
    typeof previousScore === "number" && Number.isFinite(previousScore) ? previousScore : null;
  const isRetry = retriesUsed >= 1;
  const scored = score !== null && Number.isFinite(score);

  if (threshold <= MIN_IDENTITY_THRESHOLD) return { action: "pass", reason: "gate-disabled" };

  if (!scored) {
    // The scorer failed on THIS attempt. On a first pass that is simply
    // "we could not measure it" — deliver and charge, exactly as before this
    // module existed, because treating a scorer outage as a miss would
    // re-render and refund every generation in flight.
    //
    // On a RETRY it is different, and getting this wrong was a real bug in
    // the first draft of this file: the earlier attempt HAS a score, we
    // already know it missed the bar, and returning a bare "pass" here made
    // the caller ship the unmeasured re-roll and discard a measured one. The
    // owed outcome is still owed — settle on what we actually know.
    if (isRetry && prior !== null) {
      return { action: "settle", score: prior, bestScore: prior, keepPrevious: true };
    }
    return { action: "pass", reason: "not-scored", ...(isRetry ? { keepPrevious: false } : {}) };
  }

  const value = score as number;

  if (value >= threshold) {
    // Cleared the bar. On a retry, still keep whichever attempt scored
    // higher — clearing the bar is not the same as being the better image.
    return {
      action: "pass",
      reason: "above-threshold",
      ...(isRetry ? { keepPrevious: prior !== null && prior > value } : {}),
    };
  }

  // Under the bar. One free retry, and only one — retriesUsed is read from
  // the row rather than from a counter in memory, so a webhook and a poll
  // both landing on the same generation cannot each grant "the" retry.
  if (!isRetry) return { action: "retry", score: value };

  const keepPrevious = prior !== null && prior > value;
  return { action: "settle", score: value, bestScore: keepPrevious ? prior : value, keepPrevious };
}

/**
 * Which of two attempts to keep. Exported separately because the caller has
 * to move a file in storage on the strength of this answer, and a wrong
 * comparison silently ships the worse render.
 *
 * A scored attempt always beats an unscored one: null means "we don't know",
 * and a known 41 is better evidence than an unknown. Ties keep the retry,
 * because it is the newer file and keeping it avoids a storage move.
 */
export function betterAttemptScore(first: number | null, second: number | null): "first" | "second" {
  if (first === null) return "second";
  if (second === null) return "first";
  return first > second ? "first" : "second";
}

/**
 * The line written into the pipeline log so the person can see what happened
 * without reading a score they have no baseline for. Deliberately plain: it
 * says what was done and what it cost them, in that order.
 *
 * `refunded` is passed in rather than assumed, for the reason the 2026-08-31
 * ledger audit found the hard way — the blank-frame log used to promise "and
 * refunded" unconditionally while the refund sat behind a switch that was
 * off, so a person's own pipeline log contradicted the ledger.
 */
export function gateLogLine(decision: GateDecision, refunded: boolean): string | null {
  if (decision.action === "pass") return null;
  if (decision.action === "retry") {
    return `The face scored ${decision.score} against this character's photo, below the mark we hold renders to — rendering it once more, free.`;
  }
  const kept = decision.keepPrevious ? "the first attempt" : "the second attempt";
  return refunded
    ? `Two tries and the face still didn't hold (best score ${decision.bestScore}). Keeping ${kept}, and the credit has been put back.`
    : `Two tries and the face still didn't hold (best score ${decision.bestScore}). Keeping ${kept}. Contact us and we'll put the credit back.`;
}

/**
 * The threshold, from the app_settings row — or OFF when there is no row.
 *
 * This is what call sites use. `setting` is the row as fetched, so `null`
 * (PostgREST returns no row and an error the destructure discards) means the
 * feature has not been provisioned and the gate must not run.
 *
 * The failure this prevents, found in the 2026-09-01 audit: the first version
 * called resolveIdentityThreshold(setting?.value ?? null) directly, so a
 * missing row resolved to the DEFAULT of 70 rather than to 0. Between a code
 * deploy and its migration the gate would have been live at 70 — a second
 * paid render on every miss, a forced refund past the automatic_refunds kill
 * switch on every double miss, no Admin field to stop it, and, because the
 * new columns would not exist either, a terminal write that fails with
 * PGRST204 and leaves the row stranded after both renders were billed.
 */
export function resolveIdentityThresholdSetting(
  setting: { value: string | null } | null | undefined,
): number {
  if (!setting) return MIN_IDENTITY_THRESHOLD;
  return resolveIdentityThreshold(setting.value);
}
