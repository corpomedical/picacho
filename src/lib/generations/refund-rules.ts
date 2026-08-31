// When is a failed generation provably free of provider cost?
//
// Its own alias-free module so it can be unit-tested (same reasoning as
// report-constants.ts) — job-runner.ts pulls in Supabase and the whole
// provider chain.
//
// This decides whether a refund bypasses the automatic_refunds master
// switch. A provider REJECTION (4xx: policy fence, invalid input, rate
// limit) is refused before anything is rendered, so it costs nothing and
// charging for it is indefensible whatever the switch says.
//
// 2026-08-29 incident (first outside bug report, third act): a user's
// attachment was rejected 400 twice, the third attempt was the
// "already used its attempts" stub — and because this check only ever read
// the LAST attempt, it saw no 4xx, returned false, and she was charged a
// credit for a render no provider ever performed.

type RefundStep = { step?: string; detail?: unknown };
type RefundAttempt = { steps?: RefundStep[] };

const REJECTION_4XX = /\berror \(4\d\d\)/;
// The pipeline logs this exact prefix only after a provider actually
// returned an image — i.e. work that was billed.
const COMPLETED_RENDER = /^Generated via /;

function details(attempts: RefundAttempt[]): string[] {
  return attempts.flatMap((a) =>
    (a.steps ?? []).map((s) => (typeof s.detail === "string" ? s.detail : "")),
  );
}

export function isProviderRejection(attempts: RefundAttempt[]): boolean {
  const all = details(attempts);
  // Any billed render anywhere in the run disqualifies the bypass — that
  // attempt cost real money even though the generation ended up failing.
  if (all.some((d) => COMPLETED_RENDER.test(d))) return false;
  return all.some((d) => REJECTION_4XX.test(d));
}

// Acknowledged policy warnings (2026-08-30).
//
// Picacho predicts the Seedance 2.5 likeness refusal BEFORE anything is spent
// — see SEEDANCE25_PHOTOREAL in send-plan.ts — and offers the one-tap switch
// to a model that accepts photoreal people. When someone reads that and
// chooses to send anyway, the refusal stops being something that happened TO
// them and becomes something they opted into, so it no longer force-refunds
// past the automatic_refunds switch.
//
// This is a deliberately narrow exception to the "a provider refusal costs
// nothing, so charging for it is indefensible" rule above. It applies ONLY
// when three things are true at once: the warning was shown, the person acted
// on it by sending anyway, and the send is the exact one they were warned
// about. The marker is written by actions.ts at submit time and is bound to
// that single generation.
//
// Kept as a pipeline-log marker rather than a column on purpose: the whole
// refund decision already reads the attempt log, the log is what the person
// can see under their own render, and a schema change for one boolean would
// have to be deployed before the code that writes it.
export const ACKNOWLEDGED_WARNING_MARKER = "[acknowledged-policy-warning]";

export function acknowledgedPolicyWarning(attempts: RefundAttempt[]): boolean {
  return details(attempts).some((d) => d.includes(ACKNOWLEDGED_WARNING_MARKER));
}

// The refusal the warning actually predicted: Seedance 2.5's likeness /
// content-policy rejection, on Seedance 2.5. Both halves matter — after a
// circuit-breaker substitution the error names a different model, and an
// unrelated 400 on the same model is not what anyone was warned about.
const PREDICTED_LIKENESS = /Seedance 2\.5[\s\S]*?(likeness|content_policy)/i;

// Logged by job-runner at the moment a queued video stage completes and the
// run continues into dialogue — the one point where money is provably spent
// while the generation can still fail.
const VIDEO_RENDERED = /^Rendered the video\b/;

/**
 * The single authority on whether a failure refunds PAST the
 * automatic_refunds switch (2026-08-31, replacing the two hand-assembled
 * copies in actions.ts and job-runner.ts, which had drifted).
 *
 * Force applies when a provider rejected the request (4xx) AND nothing in
 * the run was provably billed AND the rejection is not the one the person
 * was explicitly warned about and sent into anyway.
 *
 * Two 2026-08-31 inspection findings shaped it:
 *
 * - "Generated via" is only ever logged on the INLINE path, and every video
 *   has gone through the queue since 2026-08-25 — so the billed-render guard
 *   had been dead on the entire video lane (0 of 31 succeeded videos carry
 *   the marker; verified against production). The queued path's own billed
 *   moment is the video stage completing under a dialogue run, which
 *   job-runner now logs as "Rendered the video…", matched here.
 *
 * - The acknowledged-warning marker used to suppress force for EVERY 4xx in
 *   the run. Someone who accepted the likeness warning and then hit an
 *   unrelated aspect-ratio 422 was charged for a failure nobody warned them
 *   about. Suppression now applies only when every rejection in the run is
 *   the predicted Seedance 2.5 likeness refusal itself.
 */
export function forceRefundEligible(attempts: RefundAttempt[]): boolean {
  const all = details(attempts);
  if (all.some((d) => COMPLETED_RENDER.test(d) || VIDEO_RENDERED.test(d))) return false;
  const rejections = all.filter((d) => REJECTION_4XX.test(d));
  if (rejections.length === 0) return false;
  if (
    acknowledgedPolicyWarning(attempts) &&
    rejections.every((d) => PREDICTED_LIKENESS.test(d))
  ) {
    return false;
  }
  return true;
}
