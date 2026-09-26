// The one line a failed render says to the person who sent it (2026-09-26).
//
// Moved here unchanged from generate-form.tsx, where it could only run in the
// browser: the in-app assistant and the Producer now tell someone why their
// render failed (operator, 2026-09-26: "Build all three", after a talk on
// supporting an AI-built app), and they must say what the composer already
// showed that person, not a second story built from the raw log. The
// composer's summarizeFailure still wraps this for display.
//
// Pure and alias-free: runtime imports are relative, so vitest (which has no
// "@/" alias) can load it, and a client component that imports it stays light.

import type { AttemptLog } from "./pipeline";
import type { Messages } from "../i18n/messages";
import { formatMsg } from "../i18n/format";
import { classifyFailureDetails, isBudgetExhaustedDetail, toUserFacingError } from "./user-facing-error";

// Turns the pipeline's raw attempt log into one human-readable line the user
// can actually act on, instead of a generic "didn't pass" — either the exact
// provider rejection message (e.g. a content-safety violation, or a bad
// request from a provider), or which specific rulebook items (outfit,
// distinguishing features, ...) never made it into the compiled prompt.
// Takes the whole `generate` message table rather than individual label
// params — it needs several localized strings (stopped, missing-traits) and
// every caller already has `g` in hand from useLocale.
// A failure caused by the user's OWN brand rules — the validate step logs
// the rule, the exact trigger words, and the checker's suggested fix (see
// pipeline.ts). Returns that full explanation, or null for any other
// failure class. Also the gate for the "Generate anyway" override button.
export function rulesBlockOf(attempts: AttemptLog[]): string | null {
  const last = attempts[attempts.length - 1];
  if (!last) return null;
  const step = [...(last.steps ?? [])]
    .reverse()
    .find((s) => typeof s.detail === "string" && s.detail.startsWith("Blocked by brand rules:"));
  return step ? step.detail : null;
}

export function pickFailureLine(attempts: AttemptLog[], g: Messages["generate"]): string | null {
  // The user's own rules blocking is its own story — the rule, the words
  // that triggered it, and the suggested rewording, verbatim from the log.
  const blocked = rulesBlockOf(attempts);
  if (blocked) return blocked;

  // The platform content policy blocking the COMPILED prompt at the
  // pipeline's last gate, or the OUTPUT gate declining to show the picture
  // that came back (2026-09-10). Either step detail is already the sentence
  // written for the person (pipeline.ts / job-runner.ts), so it is shown
  // verbatim. Checked here, ahead of the provider-error regex below, which
  // keys on "error (4xx)" and would never see it — a refusal that fell
  // through to the generic line would tell someone nothing about the one
  // thing they can change.
  const policyAttempt = attempts.find(
    (a) => a.issues?.includes("content_policy") || a.issues?.includes("output_blocked"),
  );
  if (policyAttempt) {
    const step = [...(policyAttempt.steps ?? [])].reverse().find((st) => st.step === "validate");
    if (step?.detail) return step.detail;
  }

  // Queued (async) renders log provider errors as a step detail with an
  // EMPTY issues array — the old issues-only checks below never saw them,
  // so the UI fell back to a generic line while the provider's own words
  // sat unread in the log (2026-08-24, operator: "Just says couldn't
  // validate"). Pull the human sentence out of the error payload.
  // Classify across EVERY attempt, not just the last one. The real cause of
  // a failure often lives in attempt 1 while the last attempt holds only the
  // budget-exhausted stub (2026-08-29: a user's photo was rejected twice,
  // and the summary showed her the developer sentence about "generation
  // attempts" instead of the one thing she could fix — the photo).
  // Checked after the rules-block story (more specific) and skipped for
  // user-initiated stops below (a cancelled run isn't a failure).
  const failureKind = classifyFailureDetails(
    attempts.flatMap((a) => (a.steps ?? []).map((s) => s.detail)),
  );

  const lastAttempt = attempts[attempts.length - 1];
  if (lastAttempt && (lastAttempt.issues?.length ?? 0) === 0) {
    if (failureKind === "attachment") return g.failAttachmentUnreadable;
    const errStep = [...(lastAttempt.steps ?? [])]
      .reverse()
      .find((s) => typeof s.detail === "string" && /\berror \(\d{3}\)/.test(s.detail));
    if (errStep) {
      const m =
        errStep.detail.match(/"msg"\s*:\s*"([^"]+)"/) ??
        errStep.detail.match(/"message"\s*:\s*"([^"]+)"/);
      // Extracted provider sentences pass through toUserFacingError too —
      // the no-match branch used to return a raw dump slice verbatim.
      if (m) return toUserFacingError(m[1]).slice(0, 220);
      return toUserFacingError(errStep.detail).slice(0, 220);
    }
  }

  const last = attempts[attempts.length - 1];
  if (!last) return null;

  // A user-initiated stop, not a real failure — say so plainly instead of
  // running it through the provider-error/missing-traits messaging below,
  // which would either show nothing useful (no error step exists) or, worse,
  // surface a stale reason left over from an earlier attempt.
  if (last.issues.includes("cancelled")) return g.stoppedByUser;

  // The one cause the user can fix themselves wins over everything generic.
  if (failureKind === "attachment") return g.failAttachmentUnreadable;

  if (last.issues.includes("provider_error")) {
    const errorStep = [...last.steps]
      .reverse()
      .find(
        (s) =>
          (s.step === "generate" || s.step === "review" || s.step === "draft") &&
          !s.detail.startsWith("Generated") &&
          !s.detail.startsWith("Mock ") &&
          // The budget stub isn't a cause, it's a stop sign — skipping it
          // here lets the friendly all-attempts line below take over.
          !isBudgetExhaustedDetail(s.detail),
      );
    if (errorStep) {
      // Provider errors usually come back as raw JSON — pull out just the
      // "message" field if there is one, instead of showing the whole blob.
      // toUserFacingError is a second, catch-all pass for whatever's left
      // over (no "message" field, an unfamiliar shape, etc.) so nothing
      // resembling raw JSON ever reaches the UI.
      const jsonMatch = errorStep.detail.match(/"message"\s*:\s*"([^"]+)"/);
      const short = (jsonMatch?.[1] ?? errorStep.detail.split("\n")[0]).trim();
      return toUserFacingError(short).slice(0, 280);
    }
    // No informative error step in the last attempt (it held only the
    // budget stub, or nothing) — say what happened in human words.
    if (failureKind === "attempts") return g.failAllAttempts;
  }

  const traitIssues = last.issues.filter((i) => i !== "provider_error");
  if (traitIssues.length > 0) {
    return formatMsg(g.resultMissing, { issues: traitIssues.join(", ") });
  }

  return null;
}
