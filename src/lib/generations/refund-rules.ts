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
type RefundAttempt = { steps?: RefundStep[]; issues?: string[] };

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

// Acknowledged policy warnings — now an AUDIT RECORD ONLY (2026-09-06).
//
// Picacho predicts a likeness refusal BEFORE anything is spent (see
// SEEDANCE25_PHOTOREAL in send-plan.ts) and offers the one-tap switch to a
// model that accepts photoreal people. From 2026-08-30 until today, sending
// anyway after reading that meant keeping the charge: the refusal had stopped
// being something that happened TO the person and become something they opted
// into.
//
// The operator retired that (2026-09-06, "Drop the august rule, the newer one
// wins") because it lost an argument with a rule made the same week: charge
// the customer exactly when the PROVIDER charged us. A refusal is a 400 at
// submit on both lanes — no task is queued and nothing is billed — so the
// August rule charged for something that cost nothing, which is the practice
// the surrounding rule exists to forbid. Choosing to send is not the same as
// consuming anything.
//
// What retired it in practice was the canary on 2026-09-06: a warned send to
// BytePlus came back InputImageSensitiveContentDetected, and the suppression
// silently did not apply, because it was keyed to fal's Seedance 2.5 wording
// and ModelArk phrases its refusals differently. The charge had already become
// a coin flip on which provider answered.
//
// The marker is still written and still read here, because "we warned this
// person and they sent anyway" is a true and useful thing to have in the log
// when support reads a render back. It simply no longer decides money — and
// nothing else in the codebase consults it, so if that changes, this comment
// is the place that has to change with it.
export const ACKNOWLEDGED_WARNING_MARKER = "[acknowledged-policy-warning]";

export function acknowledgedPolicyWarning(attempts: RefundAttempt[]): boolean {
  return details(attempts).some((d) => d.includes(ACKNOWLEDGED_WARNING_MARKER));
}

// Logged by job-runner at the moment a queued video stage completes and the
// run continues into dialogue — the one point where money is provably spent
// while the generation can still fail.
const VIDEO_RENDERED = /^Rendered the video\b/;

/**
 * The single authority on whether a failure refunds PAST the
 * automatic_refunds switch (2026-08-31, replacing the two hand-assembled
 * copies in actions.ts and job-runner.ts, which had drifted).
 *
 * Force applies when a provider rejected the request (a 4xx in the log, or
 * REFUSED_BEFORE_RENDER_ISSUE on an attempt) AND nothing in the run was
 * provably billed. There is no third condition any more: the
 * acknowledged-warning exception was dropped on 2026-09-06 (see the marker
 * above), so a refusal now refunds whoever sent it and whatever they were
 * told first — because it cost nothing either way.
 *
 * The 2026-08-31 inspection finding that still shapes it: "Generated via" is
 * only ever logged on the INLINE path, and every video has gone through the
 * queue since 2026-08-25 — so the billed-render guard had been dead on the
 * entire video lane (0 of 31 succeeded videos carry the marker; verified
 * against production). The queued path's own billed moment is the video stage
 * completing under a dialogue run, which job-runner logs as "Rendered the
 * video…", matched here. That guard is what keeps this honest: a run that
 * actually rendered something never force-refunds, warning or no warning.
 */
// The output gate marks the attempt it refused with this issue — pipeline.ts
// on the inline path, job-runner's finish() on every queued one. An issue
// rather than a sentence to regex: the step detail is the line written for
// the person and may be reworded; this must not be. It is checked BEFORE the
// billed-work rule below on purpose: the render happened and we paid for it,
// and we refund anyway — see output_blocked in the table.
export const OUTPUT_BLOCKED_ISSUE = "output_blocked";

// A provider refused the request before anything was rendered, and the
// sentence we log for it carries no status code. pipeline.ts sets it
// alongside "provider_error" when GPT Image's safety system refuses at any
// stage but "output" (ImageSafetyRejection.beforeRender). It is the same class
// as a fal 422 or a ModelArk 400 — refused at submit, nothing billed — and
// the reason it needs a marker is only that REJECTION_4XX reads the step
// detail, and that detail is a plain sentence for the person
// (refusal-messages.ts) that must never grow an "error (400)".
//
// NOT BILLED — read from OpenAI's own ledger, not inferred. OpenAI's docs say
// what an image costs (input text tokens + input image tokens + image output
// tokens) and nothing about what a refusal costs, so the operator read the
// usage dashboard for 10 Sep 2026, both projects: Images 0 requests, 0
// images; spend $4.73, exactly the sum of its line items (gpt-5.4 input
// $1.486 + output $0.49 + cached $0, gpt-5.4-mini input $1.843 + output
// $0.856 + cached $0.055, moderations $0) — no gpt-image-2 line at all. That
// day's only GPT Image call was the refusal on generation 884e4664 (05:47:38
// UTC). It was refused and refunded 9.4 s after the row was written, when the
// fastest real GPT Image 2 render on record took 28.8 s to reach storage — so
// it was turned away before drawing anything, and OpenAI billed nothing for
// it, not even the prompt's input tokens. Before this marker that refusal
// went through the capped path and used one of the account's daily refunds.
//
// "Output" is excluded because OpenAI documents that stage as a block on "a
// generated image": the picture was made, which is Flux's blacked-out 200 in
// another shape, and that stays behind the switch and the cap. No output-
// stage refusal has been seen yet, so whether OpenAI bills one is unmeasured;
// openai-images.ts now logs the stage of every refusal so the next one says.
//
// THE DAILY CAP, AND THE FREE-REFUSAL LOOP IT NO LONGER BOUNDS. A forced
// refund skips refundedFailureDailyCap and leaves refunded_at unstamped, so a
// person can be refused by OpenAI as often as they like and never pay. What
// the loop costs us is not zero: every send pays for our prompt gate's
// readings before any provider sees it (and the draft, unless skipped), and
// nothing refunds those. But that loop is already open, uncapped, one step
// earlier — a send our own prompt gate refuses is force-refunded
// ("content_policy") after costing exactly those readings. A refusal from
// OpenAI adds one provider call that the ledger above shows bills nothing. So
// this opens no new cost: it moves one refusal from the capped path to the
// one its siblings (fal 422, ModelArk 400, our own gate) already take. What
// bounds the loop is the send rate — the composer's 3-second cooldown, the
// API's 30 a minute — and not money. The cap never bounded sends anyway: past
// it, anyone with credits keeps sending and simply pays. Keeping these
// refusals under it would charge for a refusal that cost nothing, which is
// exactly what "charge the user iff the provider charged us" (2026-09-06)
// forbids.
//
// The cost the cap never touched: each refusal is a moderation event on
// Picacho's OpenAI organisation. If repeated provider refusals ever need a
// brake, it belongs on the send rate or in policy-log's session prior (which
// today counts only our own prompt gate's refusals) — a policy decision for
// the operator, not a charge. Not built.
export const REFUSED_BEFORE_RENDER_ISSUE = "refused_before_render";

export function forceRefundEligible(attempts: RefundAttempt[]): boolean {
  const all = details(attempts);
  if (attempts.some((a) => a.issues?.includes(OUTPUT_BLOCKED_ISSUE))) return true;
  if (all.some((d) => COMPLETED_RENDER.test(d) || VIDEO_RENDERED.test(d))) return false;
  if (attempts.some((a) => a.issues?.includes(REFUSED_BEFORE_RENDER_ISSUE))) return true;
  return all.some((d) => REJECTION_4XX.test(d));
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
export type FailureFault =
  | "provider_failed"
  | "our_error"
  | "user_cancelled"
  | "abandoned"
  // The render came back and OUR output gate would not show it. The
  // customer's prompt passed our prompt gate; the provider made something
  // we refuse to deliver. That is our failure to have predicted, not
  // theirs, and the provider DID bill us — so this is the one class where
  // billed work is refunded on purpose. We absorb it. (2026-09-09)
  | "output_blocked";

export const REFUNDS: Record<FailureFault, boolean> = {
  provider_failed: true,
  our_error: true,
  user_cancelled: false,
  abandoned: false,
  output_blocked: true,
};

/** Whether this failure class returns the credit. The single authority. */
export function refundsOnFault(fault: FailureFault): boolean {
  return REFUNDS[fault];
}

// ---------------------------------------------------------------------
// Is this refund over the daily ceiling?
// ---------------------------------------------------------------------
//
// Extracted 2026-09-08 for the reason at the top of this file: job-runner.ts
// pulls in Supabase and the whole provider chain, so nothing in it can be
// unit-tested. This is the money rule that bounds refunds, and it went in
// yesterday with no test behind it at all.
//
// Three cases, and the middle one is the one that was missing:
//
//   normal   — bounded, counted on refunded_at (the marker the refund writes)
//   forced   — NOT bounded, because force is reserved for classes that
//              provably cost nothing: a brand rule blocking a prompt before
//              any provider call, a pre-render 4xx refusal (OpenAI's safety
//              refusal included — see REFUSED_BEFORE_RENDER_ISSUE for why the
//              loop that leaves open costs nothing new)
//   settled  — forced past the automatic_refunds switch, but bounded anyway.
//              An identity settle DELIVERED the render and spent two vision
//              calls establishing it should not have, so it is the opposite
//              of free. Unbounded it was the one refund class in the product
//              with no ceiling: fail the identity bar deliberately, twice,
//              and the render is free, repeatable at the 3-second cooldown.
//              Counted on identity_gated_at rather than refunded_at so it
//              neither eats the failure budget nor hides behind it.
//
// Admins are exempt everywhere, same as every other consumer-facing limit.
import { refundedFailureDailyCap, type PlanId } from "../plans";

export type RefundBoundInput = {
  role?: string | null;
  plan: PlanId;
  /** Bypasses the automatic_refunds master switch. */
  force?: boolean;
  /** A forced refund that is NOT zero-cost — an identity-gate settle. */
  settlement?: boolean;
  /** Refunds this account had stamped in the last 24h (refunded_at). */
  forgivenToday: number;
  /** Settlements this account had in the last 24h (identity_gated_at). */
  settledToday: number;
};

/** True when the refund must be WITHHELD because the account is at its cap. */
export function refundWithheld(input: RefundBoundInput): boolean {
  if (input.role === "admin") return false;

  const bounded = !input.force || input.settlement === true;
  if (!bounded) return false;

  const cap = refundedFailureDailyCap(input.plan);
  const used = input.settlement ? input.settledToday : input.forgivenToday;
  return used >= cap;
}
