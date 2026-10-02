import { describe, expect, it } from "vitest";
import { otherPictureEngine, refusedByEngineOnly } from "./engine-refusal";
import { IMAGE_REQUEST_REFUSED, IMAGE_RESULT_REFUSED } from "./providers/refusal-messages";

// Fix 1B (2026-10-02): another engine is offered only when the ENGINE's
// filter refused and nothing of ours did.

const attempt = (detail: string, issues: string[] = []) => ({ attempt: 1, steps: [{ step: "render", detail }], passed: false, issues });

describe("an engine-only refusal", () => {
  it("GPT Image turning the request away, or a fal engine's blacked-out frame", () => {
    expect(refusedByEngineOnly([attempt(IMAGE_REQUEST_REFUSED, ["provider_error", "refused_before_render"])])).toBe(true);
    expect(refusedByEngineOnly([attempt(IMAGE_RESULT_REFUSED, ["provider_error"])])).toBe(true);
  });

  it("never our own refusals: the word gate, or our check of the finished picture", () => {
    expect(refusedByEngineOnly([attempt("This request asks for sexual or nude content, which Picacho does not generate.", ["content_policy"])])).toBe(false);
    expect(refusedByEngineOnly([attempt(IMAGE_RESULT_REFUSED, ["output_blocked"])])).toBe(false);
    // Our check refusing a later attempt overrules an engine refusal on an earlier one.
    expect(refusedByEngineOnly([attempt(IMAGE_REQUEST_REFUSED, ["refused_before_render"]), attempt("Blocked.", ["content_policy"])])).toBe(false);
  });

  it("never a plain failure", () => {
    expect(refusedByEngineOnly([attempt("Something went wrong generating that. Please try again in a moment.", ["provider_error"])])).toBe(false);
    expect(refusedByEngineOnly(null)).toBe(false);
    expect(refusedByEngineOnly("nonsense")).toBe(false);
  });

  it("offers Seedream, or GPT Image when Seedream was the one that refused", () => {
    expect(otherPictureEngine("gpt-image")).toBe("seedream-5-pro");
    expect(otherPictureEngine("gemini")).toBe("seedream-5-pro");
    expect(otherPictureEngine(null)).toBe("seedream-5-pro");
    expect(otherPictureEngine("seedream-5-pro")).toBe("gpt-image");
  });
});
