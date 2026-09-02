import { describe, expect, it } from "vitest";
import {
  availableUpscaleTiers,
  takeSourceHeight,
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
  it("charges the exact 1080p figures at every catalog length", () => {
    expect(upscaleCreditCost(5, "1080p")).toBe(3);
    expect(upscaleCreditCost(8, "1080p")).toBe(5);
    expect(upscaleCreditCost(10, "1080p")).toBe(6);
    expect(upscaleCreditCost(12, "1080p")).toBe(8);
    expect(upscaleCreditCost(15, "1080p")).toBe(9);
    expect(upscaleCreditCost(20, "1080p")).toBe(12);
  });

  it("charges the exact 4K figures at every catalog length", () => {
    expect(upscaleCreditCost(5, "4k")).toBe(12);
    expect(upscaleCreditCost(8, "4k")).toBe(20);
    expect(upscaleCreditCost(10, "4k")).toBe(24);
    expect(upscaleCreditCost(15, "4k")).toBe(36);
    expect(upscaleCreditCost(20, "4k")).toBe(48);
  });

  it("keeps a real margin at both tiers, every length", () => {
    // $0.28/credit house basis vs fal's precise-mode per-output-second
    // prices: $0.14 (1080p) and $0.55 (4K), read 2026-09-02.
    for (const s of [5, 8, 10, 12, 15, 20]) {
      expect(upscaleCreditCost(s, "1080p") * 0.28).toBeGreaterThan(s * 0.14);
      expect(upscaleCreditCost(s, "4k") * 0.28).toBeGreaterThan(s * 0.55);
    }
  });
});

describe("tier availability and factors", () => {
  it("gives 720p renders both tiers, with exact landing factors", () => {
    expect(availableUpscaleTiers(720)).toEqual(["1080p", "4k"]);
    expect(upscaleFactor(720, "1080p")).toBe(1.5);
    expect(upscaleFactor(720, "4k")).toBe(3);
  });
  it("gives phone-class 480p sources the 1080p tier only", () => {
    expect(availableUpscaleTiers(480)).toEqual(["1080p"]);
    expect(upscaleFactor(480, "1080p")).toBe(2.25);
  });
  it("gives 768p (MiniMax) and 1080p sources the 4K tier only", () => {
    expect(availableUpscaleTiers(768)).toEqual(["4k"]);
    expect(availableUpscaleTiers(1080)).toEqual(["4k"]);
    expect(upscaleFactor(1080, "4k")).toBe(2);
  });
  it("holds the exact boundaries and the 2K input cap", () => {
    expect(availableUpscaleTiers(360)).toContain("1080p"); // 1080/360 = 3
    expect(availableUpscaleTiers(1440)).toEqual(["4k"]); // 2160/1440 = 1.5
    expect(availableUpscaleTiers(1441)).toEqual([]);
  });
  it("maps engines to their real output heights", () => {
    expect(takeSourceHeight("seedance-2")).toBe(720);
    expect(takeSourceHeight("minimax-h3")).toBe(768);
    expect(takeSourceHeight(null)).toBe(720);
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
  it("accepts the 768p engine now that the 4K tier covers it", () => {
    expect(takeUpscaleIneligibility({ ...base, video_model_id: "minimax-h3" })).toBeNull();
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
    // 1080p sources are eligible now (4K tier); past the 2K input cap not.
    expect(uploadUpscaleIneligibility({ ...ok, height: 1080 })).toBeNull();
    expect(uploadUpscaleIneligibility({ ...ok, height: 1441 })).toBe("too-sharp");
  });
});
