"use server";

import { createClient } from "@/lib/supabase/server";
import type { AttemptLog } from "@/lib/generations/pipeline";
import { REPORT_REASONS, type ReportReason } from "@/lib/generations/report-constants";

// "Report a problem" on a specific result — separate from the quick
// like/dislike reaction in actions.ts (setGenerationFeedback). A dislike is
// just "didn't like it"; a report is "something is actually wrong, please
// look at this" — it gets its own row (generation_reports) so it shows up in
// /admin/reports and stays there as a queue to work through, rather than
// disappearing into the same feedback column a thumbs-down already uses.
//
// Reports are also meant to be readable directly (e.g. via the Supabase MCP)
// so an issue can be found and fixed in the same conversation it was
// reported in, not just logged for later.
//
// REPORT_REASONS/ReportReason live in report-constants.ts, not here — see
// that file's comment for why (this file is "use server", which can't export
// a plain const).

export async function reportGenerationProblem(
  generationId: string,
  reason: string,
  details: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  if (!generationId) return { error: "Missing generation." };
  if (!REPORT_REASONS.includes(reason as ReportReason)) {
    return { error: "Pick a reason for the report." };
  }
  const trimmedDetails = details.trim().slice(0, 1000);

  // Confirms the generation both exists and actually belongs to this user —
  // RLS on generations already guards reads the same way, but checking here
  // explicitly means a bad/foreign id fails with a clear message instead of
  // silently inserting a report against nothing this user can see.
  const { data: generation } = await supabase
    .from("generations")
    .select("id")
    .eq("id", generationId)
    .eq("user_id", userData.user.id)
    .single();
  if (!generation) return { error: "Couldn't find that generation." };

  const { error } = await supabase.from("generation_reports").insert({
    generation_id: generationId,
    user_id: userData.user.id,
    reason,
    details: trimmedDetails || null,
  });

  if (error) {
    console.error("reportGenerationProblem failed:", error.message);
    return { error: "Couldn't send that report — try again." };
  }

  return { error: null };
}

// Pulls a short, plain-English reason out of a failed attempt's log — same
// spirit as generate-form.tsx's client-side summarizeFailure (which builds
// the live "here's why it failed" message the user sees), but server-side
// and meant for an admin/report audience rather than the composer UI. A
// user-initiated Stop isn't a real problem, so that case returns null and
// the caller skips filing a report for it.
function summarizeFailureDetail(attempts: AttemptLog[]): string | null {
  const last = attempts[attempts.length - 1];
  if (!last) return "Generation failed with no recorded attempts.";
  if (last.issues.includes("cancelled")) return null;

  if (last.issues.includes("provider_error") || last.issues.includes("unexpected_error")) {
    const errorStep = [...last.steps]
      .reverse()
      .find((s) => !s.detail.startsWith("Generated") && !s.detail.startsWith("Mock "));
    if (errorStep) {
      const jsonMatch = errorStep.detail.match(/"message"\s*:\s*"([^"]+)"/);
      const short = (jsonMatch?.[1] ?? errorStep.detail.split("\n")[0]).trim();
      if (short) return short.slice(0, 500);
    }
  }

  const traitIssues = last.issues.filter((i) => i !== "provider_error" && i !== "unexpected_error");
  if (traitIssues.length > 0) return `The result was missing: ${traitIssues.join(", ")}.`;

  return `Generation failed after ${attempts.length} attempt${attempts.length === 1 ? "" : "s"}.`;
}

// Files a report automatically when a generation fails, without waiting on
// the user to notice and click "Report a problem" themselves — same table,
// same /admin/reports queue, just tagged source: "auto" so it's clear no
// person typed this up. A user-initiated Stop is deliberately not reported
// (see summarizeFailureDetail) since stopping something on purpose isn't a
// site problem. Best-effort and silent on failure: this runs right after a
// generation's real status is already saved, and a logging hiccup here
// should never make that already-finished request look like it errored.
export async function autoReportFailedGeneration(
  generationId: string,
  userId: string,
  attempts: AttemptLog[],
): Promise<void> {
  const detail = summarizeFailureDetail(attempts);
  if (!detail) return;

  try {
    const supabase = await createClient();
    // Never trust the caller-supplied userId — derive it from the session.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Only file a report for a generation this user actually owns.
    const { data: generation } = await supabase
      .from("generations")
      .select("id")
      .eq("id", generationId)
      .eq("user_id", user.id)
      .single();
    if (!generation) return;

    const { error } = await supabase.from("generation_reports").insert({
      generation_id: generationId,
      user_id: user.id,
      reason: "technical_error",
      details: detail.slice(0, 1000),
      source: "auto",
    });
    if (error) console.error("autoReportFailedGeneration failed:", error.message);
  } catch (err) {
    console.error("autoReportFailedGeneration failed:", err);
  }
}

// Generic client-side crash reporter — for real JS errors caught by the
// app-wide error listener (see app-error-reporter.tsx), which aren't tied to
// any one generation. Same table and admin queue as everything else, just
// with generation_id left null. Requires a logged-in user (matches the
// table's RLS insert policy, auth.uid() = user_id) — an error before login
// has nowhere authorized to be written to, so it's dropped rather than
// forced through with elevated access.
export async function reportClientError(message: string, context: string): Promise<void> {
  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const details = `${message}\n\n${context}`.trim().slice(0, 1000);
    const { error } = await supabase.from("generation_reports").insert({
      generation_id: null,
      user_id: userData.user.id,
      reason: "technical_error",
      details,
      source: "auto",
    });
    if (error) console.error("reportClientError failed:", error.message);
  } catch (err) {
    console.error("reportClientError failed:", err);
  }
}
