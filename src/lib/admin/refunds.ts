// Which of a person's renders gave their credits back, for Admin → Users →
// the person (2026-09-26, found writing docs/SUPPORT_PLAYBOOK.md §3.1).
//
// The Refunds list used to be "rows with refunded_at". But refunded_at is
// only the daily limit's counter (job-runner.ts refundGenerationCosts): a
// FORCED refund — a refusal, a provider rejection, a brand-rules block, a
// result the output check wouldn't show, a failed upscale or layers job, a
// stop before anything rendered — gives the credits back without stamping
// it, because stamping would eat the limit those refunds are exempt from.
// A face-check refund (the identity gate's settle) is counted on
// identity_gated_at instead. So the list missed most refunds, and the ones
// it did show read "+0 cr back": a refund zeroes the very spend fields the
// list added up, and keeps no copy of what it gave back.
//
// A render counts as refunded here when nothing it spent is still spent
// (creditsKept, the same reading the assistants give a customer) and it
// failed or missed the face check. A failed render that never took anything
// — it lost the race for the last credit before any provider call — reads
// the same; it cost the person nothing either.
//
// Relative import: vitest runs with no "@/" alias.
import { creditsKept, type FailedRenderRow } from "../agent/failure-notes";

export type RefundRow = Pick<
  FailedRenderRow,
  "credits_used" | "purchased_credits_used" | "bonus_credits_used" | "free_generation_used"
> & {
  status: string;
  refunded_at: string | null;
  identity_gated_at: string | null;
};

/** Every credit the render took is back, and it failed or missed the face check. */
export function wasRefunded(row: RefundRow): boolean {
  return !creditsKept(row) && (row.status === "failed" || row.identity_gated_at != null);
}

/**
 * wasRefunded as the filters Admin's query sends, so the Refunds list and
 * the "refunded" mark on Recent generations can't disagree. credits_used is
 * NOT NULL (the monthly sum would count a NULL as 1 credit spent).
 *
 * Q is left unconstrained on purpose: checking a Supabase query builder
 * against even a two-method shape makes tsc give up (TS2589, "excessively
 * deep"). The cast is to the two methods used here; refunds.test.ts runs
 * this against a fake builder and holds it to wasRefunded row by row.
 */
export function onlyRefunded<Q>(query: Q): Q {
  type Filters = { eq(column: string, value: number | boolean): Filters; or(filters: string): Filters };
  return (query as unknown as Filters)
    .eq("credits_used", 0)
    .eq("purchased_credits_used", 0)
    .eq("bonus_credits_used", 0)
    .eq("free_generation_used", false)
    .or("status.eq.failed,identity_gated_at.not.is.null") as unknown as Q;
}

/**
 * Which daily limit a refund counted toward (refund-rules.ts refundWithheld):
 *   "failures"   stamped refunded_at: a refund behind the automatic_refunds
 *                switch, counted toward the plan's daily limit
 *   "face-check" an identity-gate settle, counted on identity_gated_at toward
 *                a limit of its own, the same size
 *   "none"       a forced refund, which no limit counts (or a render that
 *                never took anything)
 */
export type RefundLimit = "failures" | "face-check" | "none";

export function refundLimit(row: Pick<RefundRow, "refunded_at" | "identity_gated_at">): RefundLimit {
  if (row.refunded_at) return "failures";
  if (row.identity_gated_at) return "face-check";
  return "none";
}
