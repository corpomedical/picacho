import { describe, expect, it } from "vitest";
import {
  failureKind,
  failureKindFromLog,
  failureReasonFromLog,
  isProviderBalanceFailure,
  summarizeFailureDetail,
} from "./report-constants";

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

// The failure-rate split (2026-09-25, operator: "Fix the render failure
// rate"). Every string below is a real failure from Admin > Reports, the
// ones that made up System's 20%: each must land in the bucket it belongs in.
describe("what kind of failure a render was", () => {
  const at = (issues: string[], steps: { step: string; detail: string }[]) =>
    [{ attempt: 1, passed: false, compiledPrompt: "", issues, steps }] as Parameters<typeof failureKind>[0];
  const gen = (detail: string) => at([], [{ step: "generate", detail }]);

  it("a provider's likeness or safety refusal is REFUSED", () => {
    for (const detail of [
      'fal.ai (Seedance 2.5) error (422): {"detail":[{"loc":["body","image_urls"],"msg":"The images or videos provided may contain likenesses of real people or other private information that cannot be processed.","type":"content_policy_violation"}]}',
      'BytePlus ModelArk (Seedance 2.5) error (422): BytePlus ModelArk task failed: {"id":"cgt-1","status":"failed","error":{"code":"OutputVideoSensitiveContentDetected","message":"The output video may contain sensitive information."}}',
      'fal.ai (Kling O3 Pro) error (422): {"detail":[{"loc":["body"],"msg":"The content could not be processed because it contained material flagged by a content checker.","type":"content_policy_violation"}]}',
      'fal.ai (Gemini Omni Flash 1.1 (start/end frame)) error (422): {"detail":[{"loc":["body","prompt"],"msg":"Request blocked due to safety violations (harmful content). Please modify your input and retry.","type":"content_policy_violation"}]}',
      // The OpenAI sentence the image lane wrote until 2026-09-10.
      "That description was flagged by OpenAI's safety filter and couldn't be generated.",
    ]) {
      expect(failureKind(gen(detail)), detail.slice(0, 60)).toBe("refused");
    }
  });

  it("the account's own brand rules and our own gates are REFUSED", () => {
    expect(
      failureKind(at(["No third-party trademarks"], [
        { step: "validate", detail: 'Blocked by brand rules: No third-party trademarks (triggered by: "the ferrari f40").' },
      ])),
    ).toBe("refused");
    expect(failureKind(at(["content_policy"], []))).toBe("refused");
    expect(failureKind(at(["output_blocked"], []))).toBe("refused");
    expect(failureKind(at(["refused_before_render"], []))).toBe("refused");
  });

  it("a request WE got wrong, a provider down or a spent budget is BROKE", () => {
    for (const detail of [
      'fal.ai (MiniMax H3 Max Reference to Video 480p) error (422): {"detail":[{"loc":["body","reference_video_urls",0],"msg":"Video duration exceeds the maximum allowed. Maximum is 15.0 seconds.","type":"video_duration"}]}',
      'fal.ai (Kling O3 Pro) error (422): {"detail":[{"loc":["body","frontal_image_url"],"msg":"The aspect ratio of the image should be between 0.4 and 2.5.","type":"image_aspect_ratio_error"}]}',
      'fal.ai (Seedance 2.5) error (403): {"detail":"User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing."}',
      "This request already used its 4 generation attempts without producing a usable image.",
      "fal.ai (Kling O3) error (500): Internal Server Error",
    ]) {
      expect(failureKind(gen(detail)), detail.slice(0, 60)).toBe("broke");
    }
  });

  it("reads the words only where a verdict is written, never the prompt", () => {
    // A lifeguard in a safety vest is a scene. The draft carries the prompt;
    // what failed here was a timeout.
    const attempts = at([], [
      { step: "draft", detail: "A lifeguard in a bright safety vest scans the waves." },
      { step: "review", detail: "Keep the safety vest and the moderation of the light." },
      { step: "generate", detail: "fal.ai (Kling O3) error (504): Gateway Timeout" },
    ]);
    expect(failureKind(attempts)).toBe("broke");
  });

  it("an earlier attempt's refusal is the render's story", () => {
    const attempts = [
      { attempt: 1, passed: false, compiledPrompt: "", issues: [], steps: [{ step: "generate" as const, detail: 'fal.ai (Seedance 2.0) error (422): {"detail":[{"msg":"may contain likenesses of real people","type":"content_policy_violation"}]}' }] },
      { attempt: 2, passed: false, compiledPrompt: "", issues: [], steps: [{ step: "generate" as const, detail: "This request already used its 4 generation attempts without producing a usable image." }] },
    ];
    expect(failureKind(attempts)).toBe("refused");
  });

  it("a Stop is STOPPED, and an unreadable log is BROKE (nothing says it was refused)", () => {
    expect(failureKind(at(["cancelled"], [{ step: "generate", detail: "Stopped." }]))).toBe("stopped");
    expect(failureKind([])).toBe("broke");
    expect(failureKindFromLog(null)).toBe("broke");
    expect(failureKindFromLog([{}])).toBe("broke");
  });
});

// Moderation's reason for a render that failed in the JOB RUNNER (a fal
// webhook or the reaper): the provider's reply is logged as a step, but the
// attempt is never marked "provider_error", so the summary read "Generation
// failed after 1 attempt." for most of the list (found 2026-09-25).
describe("the admin's reason for a failure the job runner recorded", () => {
  const log = [
    {
      attempt: 1,
      passed: false,
      compiledPrompt: "",
      issues: [],
      steps: [
        { step: "draft", detail: "A woman walks through neon rain." },
        {
          step: "generate",
          detail:
            'fal.ai (Seedance 2.0) error (422): {"detail":[{"loc":["body","image_urls"],"msg":"The images or videos provided may contain likenesses of real people or other private information that cannot be processed.","type":"content_policy_violation"}]}',
        },
      ],
    },
  ];

  it("names the provider, the status and what the provider said", () => {
    expect(failureReasonFromLog(log)).toBe(
      "fal.ai (Seedance 2.0) error (422): The images or videos provided may contain likenesses of real people or other private information that cannot be processed.",
    );
  });

  it("stays out of summarizeFailureDetail, which the Sets screen shows customers", () => {
    expect(summarizeFailureDetail(log as Parameters<typeof summarizeFailureDetail>[0])).toBe(
      "Generation failed after 1 attempt.",
    );
  });

  it("keeps the generic line when there is truly nothing from a provider", () => {
    expect(failureReasonFromLog([{ issues: [], steps: [{ step: "generate", detail: "Rendering…" }] }])).toBe(
      "Generation failed after 1 attempt.",
    );
  });
});

