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

// --- Which failure classes give the credit back ----------------------------
//
// Moved here from job-runner.ts on 2026-09-06 for the reason this whole
// module exists: job-runner pulls in Supabase and the entire provider chain,
// so vitest cannot load it, and this table decides where a customer's money
// goes. It was the one refund decision in the codebase with no test on it.
//
//   provider_failed  the provider errored or lost the job. Failed work
//                    generally isn't billed, so refunding costs nothing and
//                    is plainly right.
//   our_error        a bug on our side. We caused it, we absorb it.
//   user_cancelled   they pressed Stop.
//   abandoned        nobody came back for it. The render ran and was billed.
//
// STOP NO LONGER REFUNDS (operator, 2026-09-06): "A user pushes Stop
// generation, No refund is applied. A stopped generation is not a failed one.
// It's a decision made by the user."
//
// The old entry read true, on the reasoning that we cancel at fal
// immediately so little or nothing is billed. Two things undid it. The
// reasoning was fal-shaped: BytePlus confirmed on 2026-09-04 that a RUNNING
// ModelArk task cannot be deleted at all, so on that lane Stop ends the wait
// and not the charge — we were paying for the render and handing the credit
// back as well. And it mis-stated what a stop is: every other entry here
// describes something going wrong, while this one describes someone changing
// their mind, which is not the same event and should not be priced like one.
//
// What the published copy actually says, checked rather than assumed — and
// the first pass at this comment got it wrong by reading only the exception
// lists. Three surfaces matter:
//
//  - The Terms (i18n/legal/terms.ts) and pricing FAQ #2 list exactly two free
//    classes — a brand-rules block and a pre-render provider refusal — plus a
//    support review "where the fault was ours". A stop is none of the three,
//    so both are consistent with this table as written.
//  - Pricing FAQ #1 DEFINES a generation as one that "reaches you", which a
//    stopped render never does. That definition was silently contradicted by
//    this change and has been amended in all four locales to name the
//    exception. It is the definition, not an exception list, which is why
//    reading only the latter missed it.
//  - The assistant's product guide and the shipped changelog BOTH promise the
//    credit comes back when an UPSCALE is stopped. That promise is still
//    kept: job-runner's REFUND_ON_FAILURE force-refunds stopped upscale and
//    layers jobs, because fal bills those on delivered output only, so a stop
//    there genuinely costs us nothing. If that exception is ever removed, the
//    guide has to change in the same commit.
//
// REFINED SAME DAY by the operator, and this is the rule that actually
// governs: "If the stop does not charge me anything from the provider then I
// should not charge the user. You should check at one point of the stop
// request does the provider start charging us to apply the same rule for the
// user." So the question is not "was it stopped" but "had the meter started".
//
// It has a documented answer, and the two vendors agree on it: billing begins
// when a RUNNER PICKS THE JOB UP, not when the request is accepted.
//
//   BytePlus support, in writing 2026-09-04: "Deleting tasks in the queue will
//   not incur any charges." A running task cannot be deleted at all. This half
//   is an EXPLICIT vendor statement about a cancel.
//
//   fal is an INFERENCE, and the distinction is worth keeping honest: fal
//   never says what a cancelled request costs — the word does not appear
//   beside billing anywhere in its pricing page or FAQ. What it does say, on
//   the "What You Are Not Charged For" section, is "Time spent waiting in the
//   queue before a runner starts processing your request is also free" and
//   "Only the actual inference work counts toward your bill"; and on the queue
//   page, that a cancel while IN_QUEUE means "The request is removed
//   immediately and is never processed". Never processed means no inference,
//   and only inference bills. Sound, but chained from three sentences rather
//   than read off one.
//
//   The same pages corroborate the other side hard: "Without cancellation
//   handling, a cancelled request continues consuming GPU time until it
//   finishes naturally." So a stop after the runner starts is billed.
//
//   The inference errs toward the CUSTOMER — if fal does bill a cancelled
//   queued request, we refund anyway and absorb it, never the reverse. And it
//   is monitored rather than merely assumed: fal files a cancel as
//   client_cancelled / 499, which reconcileFalLedger already counts as a
//   failure, so any billable unit on one surfaces in Admin > AI providers
//   under "failures we were BILLED for". If that box ever turns red with a
//   499 in it, this inference is wrong and this gate must close.
//
// Neither vendor documents what a cancel costs after that moment, and fal
// files one as client_cancelled / 499 — below the 500+ threshold of its own
// never-charged guarantee. Measured against fal's ledger 2026-09-06: the only
// two renders anyone has ever stopped on this product both billed 5 units at
// HTTP 200, i.e. they were already running. So "after the runner starts" is
// charged, and the evidence says that is what a stop has meant so far.
//
// This table is therefore the ANSWER FOR THE STARTED CASE only. The cancel
// path (job-runner) reads the provider's own status first and force-refunds
// when it says no runner had begun — see cancelVideoJob for why neither
// provider's cancel RESPONSE can stand in for that read. The lanes billed on
// delivery (upscale, layers) refund whenever they are stopped, and say so
// publicly.
export type FailureFault = "provider_failed" | "our_error" | "user_cancelled" | "abandoned";

export const REFUNDS: Record<FailureFault, boolean> = {
  provider_failed: true,
  our_error: true,
  user_cancelled: false,
  abandoned: false,
};

/** Whether this failure class returns the credit. The single authority. */
export function refundsOnFault(fault: FailureFault): boolean {
  return REFUNDS[fault];
}
