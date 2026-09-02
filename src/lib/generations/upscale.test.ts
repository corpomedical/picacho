import { describe, expect, it } from "vitest";
import {
  takeUpscaleIneligibility,
  upscaleCreditCost,
  upscaleFactor,
  uploadUpscaleIneligibility,
  UPSCALE_MAX_BYTES,
} from "./upscale";

// The upscale's money and eligibility rules, pinned. The credit rate is
// 0.6/s at the $0.28/credit basis against fal's $0.14/s (1080p precise) —
// change the rate and these numbers together, with the margin re-done.

describe("upscaleCreditCost", () => {
  it("charges the board's exact figures at every catalog length", () => {
    expect(upscaleCreditCost(5)).toBe(3);
    expect(upscaleCreditCost(8)).toBe(5);
    expect(upscaleCreditCost(10)).toBe(6);
    expect(upscaleCreditCost(12)).toBe(8);
    expect(upscaleCreditCost(15)).toBe(9);
    expect(upscaleCreditCost(20)).toBe(12);
  });

  it("keeps a real margin at every length (revenue above provider cost)", () => {
    // $0.28/credit house basis vs fal's $0.14 per output second.
    for (const s of [5, 8, 10, 12, 15, 20]) {
      expect(upscaleCreditCost(s) * 0.28).toBeGreaterThan(s * 0.14);
    }
  });
});

describe("upscaleFactor", () => {
  it("lands 720p sources exactly on 1080p", () => {
    expect(upscaleFactor(720)).toBe(1.5);
  });
  it("clamps low sources to the API maximum of 3", () => {
    expect(upscaleFactor(240)).toBe(3);
  });
  it("computes the exact factor for phone-class sources", () => {
    expect(upscaleFactor(480)).toBe(2.25);
  });
});

describe("takeUpscaleIneligibility", () => {
  const base = {
    content_type: "video",
    status: "succeeded",
    video_duration_seconds: 10,
    video_model_id: "seedance-2",
    source_generation_id: null,
  };
  it("accepts an ordinary finished video", () => {
    expect(takeUpscaleIneligibility(base)).toBeNull();
  });
  it("rejects images, failures, and over-limit lengths", () => {
    expect(takeUpscaleIneligibility({ ...base, content_type: "image" })).toBe("not-video");
    expect(takeUpscaleIneligibility({ ...base, status: "failed" })).toBe("not-succeeded");
    expect(takeUpscaleIneligibility({ ...base, video_duration_seconds: 21 })).toBe("too-long");
  });
  it("never upscales an upscale (by model id or lineage)", () => {
    expect(takeUpscaleIneligibility({ ...base, video_model_id: "flux-upscale" })).toBe(
      "already-upscaled",
    );
    expect(takeUpscaleIneligibility({ ...base, source_generation_id: "abc" })).toBe(
      "already-upscaled",
    );
  });
  it("excludes the 768p engine whose factor math would leave the 1080p tier", () => {
    expect(takeUpscaleIneligibility({ ...base, video_model_id: "minimax-h3" })).toBe(
      "excluded-engine",
    );
  });
});

describe("uploadUpscaleIneligibility", () => {
  const ok = { seconds: 12, bytes: 34 * 1024 * 1024, height: 720, mimeType: "video/mp4" };
  it("accepts a clip inside every limit", () => {
    expect(uploadUpscaleIneligibility(ok)).toBeNull();
  });
  it("rejects non-mp4, over-length, over-size, and already-sharp clips", () => {
    expect(uploadUpscaleIneligibility({ ...ok, mimeType: "video/webm" })).toBe("not-mp4");
    expect(uploadUpscaleIneligibility({ ...ok, seconds: 21 })).toBe("too-long");
    expect(uploadUpscaleIneligibility({ ...ok, bytes: UPSCALE_MAX_BYTES + 1 })).toBe("too-big");
    expect(uploadUpscaleIneligibility({ ...ok, height: 1080 })).toBe("too-sharp");
  });
});
