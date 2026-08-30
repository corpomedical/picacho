import { describe, expect, it } from "vitest";
import { canExtractFrameFrom, IDENTITY_FRAME_TYPE } from "./frame-url";

// The rules behind video identity scoring. Both were written from real
// observed behaviour on 2026-08-30, not from caution.

describe("IDENTITY_FRAME_TYPE", () => {
  it("is the MIDDLE frame — never the first", () => {
    // If this ever flips to "first", the score silently becomes meaningless
    // on every first-frame lane (kling-o3, kling-2.5): those pass the
    // character's identity photo in AS frame one, so the scorer would be
    // comparing that photo against itself and printing ~100 every time.
    // A metric that always says 100 is worse than no metric, because it
    // reads as proof. This test is the tripwire.
    expect(IDENTITY_FRAME_TYPE).toBe("middle");
  });
});

describe("canExtractFrameFrom", () => {
  it("REGRESSION: rejects mock:// result_urls", () => {
    // Real rows in the generations table, written by the mock pipeline when
    // real_ai_providers is off. Sending this to fal returns 422
    // file_download_error — confirmed 2026-08-30 — so without the guard
    // every mock generation buys a pointless round trip.
    expect(canExtractFrameFrom("mock://generated-result")).toBe(false);
  });

  it("rejects relative media paths, which fal cannot download", () => {
    // isRenderableUrl() accepts these, which is why it is not reused here.
    expect(canExtractFrameFrom("/api/media/abc123")).toBe(false);
  });

  it("accepts the fal media URLs that finished videos actually carry", () => {
    expect(
      canExtractFrameFrom("https://v3b.fal.media/files/b/0aa5cf4d/uZTuOiyEVYt0BpN1crWRA_output.mp4"),
    ).toBe(true);
  });

  it("treats null, undefined and empty as unscoreable rather than throwing", () => {
    // finish() runs this after the row is already terminal and paid for;
    // nothing in that path may throw.
    expect(canExtractFrameFrom(null)).toBe(false);
    expect(canExtractFrameFrom(undefined)).toBe(false);
    expect(canExtractFrameFrom("")).toBe(false);
  });
});
