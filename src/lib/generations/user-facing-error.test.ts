import { describe, expect, it } from "vitest";
import {
  classifyFailureDetails,
  isBudgetExhaustedDetail,
  isRawProviderError,
  toUserFacingError,
} from "./user-facing-error";

// Incident replay — 2026-08-29, the failure screen a real user actually read.
// Her generation: two OpenAI 400s about the attached photo, then the
// budget-exhausted stub. The summary showed her the stub (developer-speak)
// while the fixable cause sat unread in attempts 1–2.

const HER_OPENAI_400 =
  'OpenAI image API error (400): {\n  "error": {\n    "message": "Invalid image file or mode for image 1, please check your image file. If you believe this is a mistake, contact us.",\n    "type": "invalid_request_error"\n  }\n}';
const BUDGET_STUB =
  "This request already used its 3 generation attempts without producing a usable image.";

describe("classifyFailureDetails", () => {
  it("REGRESSION: her exact shape — cause in early attempts beats the stub in the last", () => {
    expect(
      classifyFailureDetails([
        "Skipped — using your prompt as typed (draft/review turned off).",
        HER_OPENAI_400,
        HER_OPENAI_400,
        BUDGET_STUB,
      ]),
    ).toBe("attachment");
  });

  it("stub with no known cause classifies as attempts", () => {
    expect(classifyFailureDetails(["Drafted the prompt.", BUDGET_STUB])).toBe("attempts");
  });

  it("a 503 dump is neither — the generic paths handle it", () => {
    expect(classifyFailureDetails(['fal.ai error (503): {"detail": "upstream"}'])).toBeNull();
  });

  it("prose merely containing 'invalid image' never triggers the photo message", () => {
    // The attachment patterns are gated on isRawProviderError, so a drafted
    // prompt or our own copy can't misfire the classification.
    expect(classifyFailureDetails(["The scene shows an invalid image on a billboard."])).toBeNull();
  });

  it("tolerates undefined details", () => {
    expect(classifyFailureDetails([undefined, BUDGET_STUB])).toBe("attempts");
  });
});

describe("toUserFacingError", () => {
  it("maps an attachment-rejection dump to the photo guidance", () => {
    expect(toUserFacingError(HER_OPENAI_400)).toContain("couldn't read the photo");
  });
  it("maps other raw dumps to the generic line", () => {
    expect(toUserFacingError('fal.ai error (500): {"detail": "boom"}')).toContain(
      "Something went wrong",
    );
  });
  it("passes our own messages through untouched", () => {
    const ours = "Describe them first — the character needs hair and eye color.";
    expect(toUserFacingError(ours)).toBe(ours);
  });
});

describe("step-detail helpers", () => {
  it("recognizes the budget stub", () => {
    expect(isBudgetExhaustedDetail(BUDGET_STUB)).toBe(true);
    expect(isBudgetExhaustedDetail("Generated via GPT Image 2.")).toBe(false);
  });
  it("still flags raw dumps (unchanged contract)", () => {
    expect(isRawProviderError(HER_OPENAI_400)).toBe(true);
    expect(isRawProviderError(BUDGET_STUB)).toBe(false);
  });
});

it("does not claim the attachment promise on a 5xx that mentions an image", () => {
  // The "attachment" copy says "failed tries don't use up your credits" —
  // true for a 4xx rejection (force-refunded), not for a 5xx (stays behind
  // the refunds flag). A 5xx must fall through to the generic line.
  expect(
    classifyFailureDetails(['fal.ai (Kling) error (500): {"detail":"invalid image file"}']),
  ).toBeNull();
});
