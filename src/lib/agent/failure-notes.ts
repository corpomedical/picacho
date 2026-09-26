import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttemptLog } from "../generations/pipeline";
import { attemptsFromLog } from "../generations/report-constants";
import { pickFailureLine } from "../generations/failure-line";
import { toUserFacingError } from "../generations/user-facing-error";
import en from "../i18n/messages/en";

// Why a person's render failed, and whether its credits came back, for the
// in-app assistant and the Producer (2026-09-26, operator: "Build all three",
// after a talk on supporting an AI-built app). Both were told to explain a
// failure — the chat agent's rules even said "You have the pipeline log; use
// it." — while neither query selected the log, so "why did my video fail?"
// got a guess or a shrug.
//
// WHAT IT SAYS is what the person already saw: the composer's own line
// (failure-line.ts), in English because the assistants answer in the
// person's language anyway. Never the raw provider text: that stays with the
// admin (report-constants.ts providerWordsFromAttempts) and the Reports queue.
//
// THE CREDIT ANSWER comes from the row, not from refunded_at: a refund zeroes
// all four of the render's spend fields (job-runner.ts refundGenerationCosts),
// but a FORCED refund — a refusal, a provider rejection, a write-off —
// releases the credits without stamping refunded_at (it would eat the daily
// cap), so refunded_at alone would call most refunds "kept".
//
// Relative imports only, so vitest (no "@/" alias) can load it.

export type FailedRenderRow = {
  id: string;
  pipeline_log: unknown;
  credits_used: number | null;
  purchased_credits_used: number | null;
  bonus_credits_used: number | null;
  free_generation_used: boolean | null;
};

const NO_REASON = "No reason was recorded.";

/** The sentence the person saw, or the closest safe one when the composer had none. */
export function failureReasonForPerson(attempts: AttemptLog[]): string {
  if (attempts.length === 0) return NO_REASON;
  const line = pickFailureLine(attempts, en.generate);
  if (line) return line;
  // The composer has no line for some endings — the stuck-render reaper's
  // "This render didn't finish in time and was stopped." is one. Take the
  // last verdict step's own words; toUserFacingError turns any raw provider
  // dump into the generic line, so none reaches the person.
  for (let a = attempts.length - 1; a >= 0; a--) {
    const step = [...attempts[a].steps]
      .reverse()
      .find(
        (s) =>
          (s.step === "generate" || s.step === "validate") &&
          !s.detail.startsWith("Generated") &&
          !s.detail.startsWith("Mock "),
      );
    if (step?.detail) return toUserFacingError(step.detail.split("\n")[0].trim()).slice(0, 280);
  }
  return NO_REASON;
}

/** True when any credit source this render spent is still spent. */
export function creditsKept(
  row: Pick<FailedRenderRow, "credits_used" | "purchased_credits_used" | "bonus_credits_used" | "free_generation_used">,
): boolean {
  return (
    (row.credits_used ?? 0) > 0 ||
    (row.purchased_credits_used ?? 0) > 0 ||
    (row.bonus_credits_used ?? 0) > 0 ||
    row.free_generation_used === true
  );
}

/** One line for the render list: why it failed and where its credits stand. */
export function failedRenderNote(row: FailedRenderRow): string {
  const why = failureReasonForPerson(attemptsFromLog(row.pipeline_log)).replace(/\s+/g, " ");
  const credits = creditsKept(row)
    ? "its credits were NOT returned"
    : "its credits were returned (or never taken)";
  return `failed because: ${why} — ${credits}`;
}

/**
 * Notes for the person's failed renders, by id. Scoped by the person's id on
 * top of RLS; a read that fails leaves the notes out (logged) rather than
 * failing the assistant's turn.
 */
export async function loadFailureNotes(
  supabase: SupabaseClient,
  userId: string,
  failedIds: string[],
): Promise<Map<string, string>> {
  const notes = new Map<string, string>();
  const ids = [...new Set(failedIds)].slice(0, 30);
  if (ids.length === 0) return notes;
  const { data, error } = await supabase
    .from("generations")
    .select("id, pipeline_log, credits_used, purchased_credits_used, bonus_credits_used, free_generation_used")
    .eq("user_id", userId)
    .in("id", ids);
  if (error) {
    console.error("failure-notes: unavailable —", error.message);
    return notes;
  }
  for (const row of (data ?? []) as FailedRenderRow[]) notes.set(row.id, failedRenderNote(row));
  return notes;
}
