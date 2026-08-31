import { describe, expect, it } from "vitest";
import {
  ACKNOWLEDGED_WARNING_MARKER,
  acknowledgedPolicyWarning,
  isProviderRejection,
  forceRefundEligible,
} from "./refund-rules";

// Incident replay — the 2026-08-29 report. Each case is a real pipeline log
// shape; the first is the one that charged a user for work no provider did.

describe("isProviderRejection", () => {
  it("REGRESSION: 4xx in earlier attempts, stub in the last one, still a rejection", () => {
    // Her exact shape: two OpenAI 400s, then the attempts-exhausted stub.
    // The old rule read only the last attempt, saw no 4xx, and withheld the refund.
    expect(
      isProviderRejection([
        { steps: [{ step: "generate", detail: "OpenAI image API error (400): Invalid image file" }] },
        { steps: [{ step: "generate", detail: "OpenAI image API error (400): Invalid image file" }] },
        { steps: [{ step: "generate", detail: "This request already used its 4 generation attempts without producing a usable image." }] },
      ]),
    ).toBe(true);
  });

  it("a 4xx in the last attempt is still a rejection (the original behaviour)", () => {
    expect(
      isProviderRejection([{ steps: [{ step: "generate", detail: "fal.ai error (422): policy" }] }]),
    ).toBe(true);
  });

  it("a completed render anywhere disqualifies the bypass — that attempt was billed", () => {
    expect(
      isProviderRejection([
        { steps: [{ step: "generate", detail: "Generated via GPT Image 2." }] },
        { steps: [{ step: "generate", detail: "OpenAI image API error (400): nope" }] },
      ]),
    ).toBe(false);
  });

  it("5xx and network faults are NOT rejections — they may have cost provider work", () => {
    expect(
      isProviderRejection([{ steps: [{ step: "generate", detail: "fal.ai error (503): upstream" }] }]),
    ).toBe(false);
    expect(isProviderRejection([{ steps: [{ step: "generate", detail: "network timeout" }] }])).toBe(false);
  });

  it("empty or malformed logs never force a refund", () => {
    expect(isProviderRejection([])).toBe(false);
    expect(isProviderRejection([{}])).toBe(false);
    expect(isProviderRejection([{ steps: [{ step: "generate", detail: undefined }] }])).toBe(false);
  });
});

// Acknowledged policy warnings (2026-08-30). Picacho predicts the Seedance 2.5
// likeness refusal before anything is spent and offers the switch that works.
// Sending anyway turns the refusal from something that happened TO someone
// into something they chose, and the credit stands.
describe("acknowledgedPolicyWarning", () => {
  const ack = {
    steps: [{ step: "draft", detail: `${ACKNOWLEDGED_WARNING_MARKER} Sent after the warning.` }],
  };
  const refusal = {
    steps: [{ step: "generate", detail: "fal.ai (Seedance 2.5) error (422): content_policy_violation" }],
  };

  it("detects the marker anywhere in the attempt log", () => {
    expect(acknowledgedPolicyWarning([ack, refusal])).toBe(true);
    expect(acknowledgedPolicyWarning([ack])).toBe(true);
  });

  it("is false for an ordinary refusal nobody was warned about", () => {
    // The default and by far the common case: an unwarned refusal costs the
    // provider nothing, so charging for it stays indefensible.
    expect(acknowledgedPolicyWarning([refusal])).toBe(false);
    expect(acknowledgedPolicyWarning([])).toBe(false);
  });

  it("REGRESSION: acknowledging does not itself make something a rejection", () => {
    // The two rules are independent and BOTH must hold for a credit to be
    // kept. Acknowledging a warning and then hitting an unrelated failure
    // must not quietly become a chargeable event.
    expect(isProviderRejection([ack])).toBe(false);
  });

  it("the combination the refund sites actually evaluate", () => {
    // force = isProviderRejection && !acknowledged
    const forced = (a: Parameters<typeof isProviderRejection>[0]) =>
      isProviderRejection(a) && !acknowledgedPolicyWarning(a);
    expect(forced([refusal])).toBe(true); // unwarned refusal -> refund
    expect(forced([ack, refusal])).toBe(false); // warned, sent anyway -> charged
  });
});

// forceRefundEligible — the single authority, added 2026-08-31 after the
// inspection found the two hand-assembled copies had both drifted.
describe("forceRefundEligible", () => {
  const run = (...details: string[]) => [{ steps: details.map((detail) => ({ step: "generate", detail })) }];
  const LIKENESS_422 =
    'fal.ai (Seedance 2.5) error (422): {"detail":[{"loc":["body","image_urls"],"msg":"The images or videos provided may contain likenesses of real people","type":"content_policy_violation"}]}';

  it("forces on a plain provider rejection", () => {
    expect(forceRefundEligible(run("fal.ai (Kling) error (422): invalid parameters"))).toBe(true);
  });

  it("does not force when an inline render was billed", () => {
    expect(
      forceRefundEligible(run("Generated via GPT Image 2.", "OpenAI error (400): bad request")),
    ).toBe(false);
  });

  it("does not force when a QUEUED video was billed — the lane the old guard was dead on", () => {
    // 31 of 31 succeeded production videos carry "Queued with", zero carry
    // "Generated via". The billed moment on that lane is the video stage
    // completing under a dialogue run.
    expect(
      forceRefundEligible(
        run(
          "Queued with Seedance 2.0 (10s).",
          "Rendered the video — generating the dialogue next.",
          "fal.ai (ElevenLabs) error (422): text too long",
        ),
      ),
    ).toBe(false);
  });

  it("a queue acceptance alone does not block force — failed queued renders bill zero", () => {
    // Verified against fal's own ledger on 2026-08-30: 31 failures, 0
    // billable units. Acceptance is not billing.
    expect(
      forceRefundEligible(run("Queued with Kling O3 Pro (5s).", "fal.ai (Kling) error (422): rejected")),
    ).toBe(true);
  });

  it("suppresses force only for the refusal the person was warned about", () => {
    expect(forceRefundEligible(run("[acknowledged-policy-warning]", LIKENESS_422))).toBe(false);
  });

  it("still forces an UNRELATED 4xx even after an acknowledged warning", () => {
    // Accepting the likeness warning is not consent to be charged for an
    // aspect-ratio rejection nobody predicted.
    expect(
      forceRefundEligible(
        run(
          "[acknowledged-policy-warning]",
          'fal.ai (Kling O3 Pro) error (422): {"type":"image_aspect_ratio_error"}',
        ),
      ),
    ).toBe(true);
  });

  it("still forces when substitution moved the run off the warned model", () => {
    // The breaker can substitute Seedance 2.5 away; a 4xx from the
    // substitute names a different model and was never predicted.
    expect(
      forceRefundEligible(run("[acknowledged-policy-warning]", "fal.ai (Kling) error (422): rejected")),
    ).toBe(true);
  });

  it("never forces a run with no rejection at all", () => {
    expect(forceRefundEligible(run("fal.ai (Veo) error (500): internal"))).toBe(false);
    expect(forceRefundEligible([])).toBe(false);
  });
});
