import { describe, expect, it } from "vitest";
import {
  storyboardFrameExtraCredits,
  KLING_STORYBOARD_PER_SECOND_USD,
  COST_BASIS_USD_PER_CREDIT,
  pricingAudit,
  getDialogueCreditWeight,
  SYNC_LIPSYNC_PER_SECOND_USD,
  DIALOGUE_TTS_ALLOWANCE_USD,
} from "./providers/video-models";

// The start/end-frame lane renders on fal's v2.1 pro endpoint ($0.49/5s,
// $0.098/s), not the $0.056/s the Kling 1.6 weights assume. Every render on
// it before 2026-08-31 was charged 1 credit against $0.49 of provider spend.
describe("storyboardFrameExtraCredits", () => {
  it("prices the 5s and 10s lanes above their real cost", () => {
    // 5s: base 1 + extra must cover $0.49. 10s: base 2 + extra covers $0.98.
    expect(storyboardFrameExtraCredits("kling", 5)).toBe(1);
    expect(storyboardFrameExtraCredits("kling", 10)).toBe(2);
    for (const seconds of [5, 10]) {
      const base = seconds === 5 ? 1 : 2;
      const charged = (base + storyboardFrameExtraCredits("kling", seconds)) * COST_BASIS_USD_PER_CREDIT;
      expect(charged).toBeGreaterThanOrEqual(KLING_STORYBOARD_PER_SECOND_USD * seconds);
    }
  });

  it("applies to kling only — no other model takes this endpoint", () => {
    for (const id of ["kling-o3-pro", "kling-2.5", "seedance", "seedance-2", "veo", "kling-o3"]) {
      expect(storyboardFrameExtraCredits(id, 5)).toBe(0);
    }
  });

  it("keeps the whole catalogue loss-free, storyboard lane included", () => {
    // pricingAudit returns only rows where the allowance value is below the
    // provider cost. The storyboard row is audited now, so a fal price rise
    // shows up here (and on the admin panel) instead of in the margin.
    expect(pricingAudit()).toEqual([]);
  });
});

// Dialogue's surcharge, re-priced 2026-08-31 from fal's published invoice
// prices after the old rate's own comment admitted it was an estimate.
describe("getDialogueCreditWeight covers the lipsync invoice", () => {
  it("covers every duration at fal's published $5/minute", () => {
    for (const seconds of [3, 5, 10, 15, 20, 30]) {
      const charged = getDialogueCreditWeight(seconds) * COST_BASIS_USD_PER_CREDIT;
      const cost = SYNC_LIPSYNC_PER_SECOND_USD * seconds + DIALOGUE_TTS_ALLOWANCE_USD;
      expect(charged, `${seconds}s`).toBeGreaterThanOrEqual(cost);
    }
  });

  it("charges the approved ladder", () => {
    expect(getDialogueCreditWeight(5)).toBe(2);
    expect(getDialogueCreditWeight(10)).toBe(4);
    expect(getDialogueCreditWeight(15)).toBe(5);
  });
});
