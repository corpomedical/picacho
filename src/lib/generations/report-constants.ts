import type { AttemptLog } from "@/lib/generations/pipeline";

// Split out from reports.ts on purpose: that file is "use server", and
// Next.js only allows a "use server" file to export async functions —
// exporting this const array from there broke the whole module the moment a
// client component (result-actions.tsx) imported it ("A 'use server' file
// can only export async functions, found object."). Everything that needs
// the reason list — the server actions in reports.ts and the client-side
// report popover — imports it from here instead.
export const REPORT_REASONS = [
  "wrong_result",
  "inappropriate",
  "technical_error",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

// Detects the class of failure where OUR provider account is out of money —
// not "this render failed" but "every render will fail until someone tops up
// a balance". Born from the 2026-08-25 fal.ai lock: the account hit zero at
// 04:34 UTC and every video generation 403'd with "User is locked. Reason:
// Exhausted balance." — but the admin push for it was the same "Generation
// failed" as any one-off hiccup, so nobody's phone said the PRODUCT was down.
// Matched against the summarized failure detail (provider error messages),
// which is why the phrases are provider-side wordings — fal's lock text,
// OpenAI's quota text, generic 402 language. Deliberately NOT matched:
// Picacho's own "needs N credits" copy (a user being out of OUR credits is
// normal business, and that string never reaches a failure report anyway).
const PROVIDER_BALANCE_FAILURE =
  /user is locked|exhausted balance|top up your balance|insufficient (?:balance|funds|credits?)|exceeded your current quota|payment required/i;

export function isProviderBalanceFailure(detail: string): boolean {
  return PROVIDER_BALANCE_FAILURE.test(detail);
}

// Pulls a short, plain-English reason out of a failed attempt's log — same
// spirit as generate-form.tsx's client-side summarizeFailure (which builds
// the live "here's why it failed" message the user sees), but server-side
// and meant for an admin/report audience rather than the composer UI. A
// user-initiated Stop isn't a real problem, so that case returns null and
// the caller skips filing a report for it. Lives here, not in reports.ts,
// for the reason this file does: that one is "use server" and can export
// only async functions, and the admin's failed-render list reads it too.
export function summarizeFailureDetail(attempts: AttemptLog[]): string | null {
  const last = attempts[attempts.length - 1];
  if (!last) return "Generation failed with no recorded attempts.";
  if (last.issues.includes("cancelled")) return null;

  // Either content gate refused: the validate step already holds the
  // sentence written for the person (pipeline.ts / job-runner.ts), so the
  // report says that rather than "The result was missing: output_blocked."
  if (last.issues.includes("content_policy") || last.issues.includes("output_blocked")) {
    const step = [...last.steps].reverse().find((s) => s.step === "validate");
    if (step?.detail) return step.detail.slice(0, 500);
  }

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

  // A brand-rule block records its evidence and fix in the validate step
  // ("Blocked by brand rules: <label> (triggered by: "…" — try: …)"), but
  // its issues are the rule LABELS — so this summary used to fall through
  // to "The result was missing: <labels>." and hide the evidence (the
  // launch-day failed renders, 2026-09-19). Say the step's own sentence.
  const brandStep = [...last.steps].reverse().find((s) => s.step === "validate" && s.detail.startsWith("Blocked by brand rules"));
  if (brandStep) return brandStep.detail.slice(0, 500);

  const traitIssues = last.issues.filter((i) => i !== "provider_error" && i !== "unexpected_error");
  if (traitIssues.length > 0) return `The result was missing: ${traitIssues.join(", ")}.`;

  return `Generation failed after ${attempts.length} attempt${attempts.length === 1 ? "" : "s"}.`;
}

// The same reason read from a render's STORED log (generations.pipeline_log,
// the admin's failed-render list), which is only as well formed as whatever
// wrote it: an older row can lack `issues`, a crash can leave no log at all.
// Null still means stopped on purpose; a log with nothing to read says so
// instead of throwing on the page.
export function failureReasonFromLog(log: unknown): string | null {
  if (!Array.isArray(log)) return "No reason was recorded.";
  const attempts: AttemptLog[] = log
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
    .map((a, i) => ({
      attempt: typeof a.attempt === "number" ? a.attempt : i + 1,
      passed: a.passed === true,
      compiledPrompt: typeof a.compiledPrompt === "string" ? a.compiledPrompt : "",
      issues: Array.isArray(a.issues) ? a.issues.filter((x): x is string => typeof x === "string") : [],
      steps: Array.isArray(a.steps)
        ? a.steps.filter(
            (x): x is AttemptLog["steps"][number] =>
              typeof x === "object" && x !== null && typeof x.step === "string" && typeof x.detail === "string",
          )
        : [],
    }));
  if (attempts.length === 0) return "No reason was recorded.";
  return summarizeFailureDetail(attempts);
}
