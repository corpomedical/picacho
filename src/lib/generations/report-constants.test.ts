import { describe, expect, it } from "vitest";
import { failureReasonFromLog, isProviderBalanceFailure, summarizeFailureDetail } from "./report-constants";

// Incident-replay tests, same spirit as send-plan.test.ts: the positive
// cases are the real provider strings that motivated the detector, the
// negative cases are the ordinary failures and in-product copy that must
// NEVER page the operator as a balance lock.

describe("a brand-rule block says its evidence", () => {
  it("returns the validate step's own sentence, never the bare rule labels", () => {
    const attempts = [
      {
        attempt: 1,
        passed: false,
        compiledPrompt: "p",
        issues: ["No copyrighted characters", "No third-party trademarks"],
        steps: [
          { step: "draft", detail: "d" },
          { step: "validate", detail: 'Blocked by brand rules: No third-party trademarks (triggered by: "sponsor logos line the barriers" — try: say the barriers are unmarked).' },
        ],
      },
    ];
    const out = summarizeFailureDetail(attempts as never);
    expect(out).toContain("Blocked by brand rules");
    expect(out).toContain("sponsor logos line the barriers");
    expect(out).not.toContain("The result was missing");
  });
});

describe("isProviderBalanceFailure", () => {
  it("matches the 2026-08-25 fal.ai lock verbatim", () => {
    expect(
      isProviderBalanceFailure(
        "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing.",
      ),
    ).toBe(true);
  });

  it("matches each fal lock phrase on its own (messages get truncated to 500 chars)", () => {
    expect(isProviderBalanceFailure("User is locked.")).toBe(true);
    expect(isProviderBalanceFailure("Reason: Exhausted balance")).toBe(true);
    expect(isProviderBalanceFailure("Top up your balance at fal.ai")).toBe(true);
  });

  it("matches OpenAI's quota wording", () => {
    expect(
      isProviderBalanceFailure(
        "You exceeded your current quota, please check your plan and billing details.",
      ),
    ).toBe(true);
  });

  it("matches generic insufficient-balance and 402 language", () => {
    expect(isProviderBalanceFailure("Insufficient balance")).toBe(true);
    expect(isProviderBalanceFailure("insufficient credits in account")).toBe(true);
    expect(isProviderBalanceFailure("402 Payment Required")).toBe(true);
  });

  it("ignores ordinary render failures", () => {
    expect(isProviderBalanceFailure("Internal server error")).toBe(false);
    expect(isProviderBalanceFailure("The request timed out after 300s.")).toBe(false);
    expect(isProviderBalanceFailure("Your request was rejected by the safety system.")).toBe(false);
    expect(isProviderBalanceFailure("The result was missing: outfit.")).toBe(false);
    expect(isProviderBalanceFailure("Generation failed after 3 attempts.")).toBe(false);
  });

  it("ignores Picacho's own out-of-credits copy (a user out of OUR credits is not an outage)", () => {
    expect(
      isProviderBalanceFailure("Seedance 2.0 at 5s needs 15 credits — you have 3."),
    ).toBe(false);
  });
});

// The reason a failed render gives, read by the auto-filed report and, since
// 2026-09-18, by the admin's failed-render list from the STORED log — which
// can be anything an older writer left, so the reader must never throw.
describe("the reason a failed render gives", () => {
  const attempt = (issues: string[], steps: { step: string; detail: string }[]) => ({
    attempt: 1,
    passed: false,
    compiledPrompt: "",
    issues,
    steps,
  });

  it("is nothing for a render someone stopped on purpose", () => {
    const log = [attempt(["cancelled"], [{ step: "generate", detail: "Stopped." }])];
    expect(failureReasonFromLog(log)).toBeNull();
    expect(summarizeFailureDetail(log as Parameters<typeof summarizeFailureDetail>[0])).toBeNull();
  });

  it("is the provider's own message when the provider failed", () => {
    const log = [
      attempt(["provider_error"], [
        { step: "draft", detail: "Generated the prompt." },
        { step: "generate", detail: '{"detail":[{"message":"Image size is too large"}]} and more' },
      ]),
    ];
    expect(failureReasonFromLog(log)).toBe("Image size is too large");
  });

  it("is the sentence the person was shown when a content gate refused", () => {
    const log = [
      attempt(["content_policy"], [
        { step: "generate", detail: "Generated." },
        { step: "validate", detail: "This request can't be made: it asks for a real person's likeness." },
      ]),
    ];
    expect(failureReasonFromLog(log)).toBe("This request can't be made: it asks for a real person's likeness.");
  });

  it("names what a result missed", () => {
    expect(failureReasonFromLog([attempt(["face_mismatch"], [])])).toBe("The result was missing: face_mismatch.");
  });

  it("reads the LAST attempt", () => {
    const log = [attempt(["cancelled"], []), attempt(["provider_error"], [{ step: "generate", detail: "Timed out" }])];
    expect(failureReasonFromLog(log)).toBe("Timed out");
  });

  it("says so, and never throws, on a log it cannot read", () => {
    expect(failureReasonFromLog(null)).toBe("No reason was recorded.");
    expect(failureReasonFromLog(undefined)).toBe("No reason was recorded.");
    expect(failureReasonFromLog({ steps: [] })).toBe("No reason was recorded.");
    expect(failureReasonFromLog([])).toBe("No reason was recorded.");
    expect(failureReasonFromLog(["not an attempt", 4])).toBe("No reason was recorded.");
    // An attempt with no issues and no steps, as an older writer could leave.
    expect(failureReasonFromLog([{}])).toBe("Generation failed after 1 attempt.");
    // Wrong types inside are dropped, not trusted.
    expect(failureReasonFromLog([{ issues: "provider_error", steps: [{ step: "generate" }, 7] }])).toBe(
      "Generation failed after 1 attempt.",
    );
  });
});

