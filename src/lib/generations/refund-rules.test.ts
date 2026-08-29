import { describe, expect, it } from "vitest";
import { isProviderRejection } from "./refund-rules";

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
