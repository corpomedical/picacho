// Telling OUR problem apart from THEIRS when a chat turn fails (2026-08-30).
//
// Alias-free so it can be unit-tested, same as prices.ts and sse.ts.
//
// This exists because of a specific recommendation: put a monthly spend cap on
// the Anthropic workspace this feature bills to, so it can never run away.
// That cap is a good idea, and it has a sharp edge — Anthropic enforces a
// spend limit you set by REJECTING requests, and the rejection arrives as an
// HTTP 400, which is otherwise the shape of "you sent a bad request". Without
// this classifier the app would treat a hit budget as a fluke, tell the person
// "try again", and charge them a unit of their own allowance for every attempt
// they made against a wall we put there.
//
// Sourced from Anthropic's errors and rate-limits documentation, read
// 2026-08-30:
//   - A spend limit YOU set returns 400 invalid_request_error, message
//     beginning "You have reached your specified API usage limits" (or
//     "...specified workspace API usage limits").
//   - The account TIER's own monthly cap returns 429 rate_limit_error with
//     details.error_code = "enforced_spend_limit_reached" and no retry-after.
//   - A missing, revoked or expired key returns 401 authentication_error.
//   - A key without permission for the workspace returns 403.
// If those shapes change, change them here — this is the only place that
// knows them.

export type TurnFailure =
  /** Ours to fix: no key, wrong key, or a budget we set has been reached. */
  | "provider_unavailable"
  /** Everything else: a blip, a timeout, an overload. Worth another go. */
  | "transient";

export function classifyTurnFailure(status: number | undefined, message: string): TurnFailure {
  if (status === 401 || status === 403) return "provider_unavailable";
  if (status === 400 && /usage limits?/i.test(message)) return "provider_unavailable";
  if (status === 429 && /enforced_spend_limit_reached/i.test(message)) return "provider_unavailable";
  // A 404 naming a model is a bad model id in our own code, not the person's
  // doing, and no amount of retrying fixes it.
  if (status === 404 && /model/i.test(message)) return "provider_unavailable";
  return "transient";
}

/**
 * What to charge for a failed turn, in units.
 *
 * Zero when the request never reached the model — a rejected request spends no
 * tokens, so charging for it would be taking allowance for nothing. One
 * otherwise, because a turn that failed part-way may well have spent tokens
 * and the safe direction on a metered endpoint is to have charged.
 */
export function unitsForFailedTurn(failure: TurnFailure): number {
  return failure === "provider_unavailable" ? 0 : 1;
}
