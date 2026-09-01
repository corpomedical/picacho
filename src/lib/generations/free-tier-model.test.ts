import { describe, expect, it } from "vitest";
import {
  COST_BASIS_USD_PER_CREDIT,
  FREE_TIER_GENERATION_CREDITS,
  getDefaultDurationSeconds,
  getVideoModel,
  pricingAudit,
  requiresReferenceImage,
} from "./providers/video-models";
import { FREE_TIER_VIDEO_MODEL_ID } from "../plans";
import { MODEL_CAPABILITIES, type VideoModelId } from "./send-plan";

// The free tier's economics (moved off Kling 1.6 on 2026-09-01).
//
// The defect this file exists to prevent coming back: Kling 1.6 cost
// $0.056/sec, so its 5s default was $0.2800 against a 1-credit allowance
// worth exactly $0.2800. pricingAudit() passed it only because of the half
// a cent of floating-point tolerance in its own comparison — the free tier
// was one fal price rise away from losing money on every render, and
// nothing in the test suite said so.
//
// These tests assert HEADROOM, not merely "the audit is happy". An audit
// that passes at exactly zero margin is the thing that went wrong.

const model = getVideoModel(FREE_TIER_VIDEO_MODEL_ID);
const defaultSeconds = getDefaultDurationSeconds(model);
const costOfOneFreeRender = model.costPerSecondUsd * defaultSeconds;

describe("free tier model", () => {
  it("is a real catalogue entry, not a silent fallback", () => {
    // getVideoModel returns the recommended model for an unknown id, so a
    // typo in FREE_TIER_VIDEO_MODEL_ID would quietly re-point the free tier
    // at Kling 1.6 — the exact model this change moved away from — and
    // every other assertion here would pass while testing the wrong thing.
    expect(model.id).toBe(FREE_TIER_VIDEO_MODEL_ID);
  });

  it("costs one credit, which the whole trial gate depends on", () => {
    // core.ts spends the daily slot only on requests at or under this
    // number. It is derived from the catalogue, so a model change moves it
    // automatically — but the free tier is DESIGNED around one render a day
    // being one credit, and a 2-credit pin would double the trial budget.
    expect(FREE_TIER_GENERATION_CREDITS).toBe(1);
  });

  it("keeps real headroom, not the half-cent audit tolerance", () => {
    // The bar: a free render must cost meaningfully less than the credit it
    // spends. 20% of the cost basis is the line — Kling 1.6 sat at 0% and
    // passed the audit anyway.
    const allowance = FREE_TIER_GENERATION_CREDITS * COST_BASIS_USD_PER_CREDIT;
    expect(costOfOneFreeRender).toBeLessThanOrEqual(allowance * 0.8);
  });

  it("REGRESSION: never re-pegs the free tier to a zero-margin model", () => {
    // Stated as its own case because it is the actual defect. Kling 1.6 is
    // still in the catalogue and still a fine paid model — it just must not
    // be the free one again without someone re-reading this file.
    const allowance = FREE_TIER_GENERATION_CREDITS * COST_BASIS_USD_PER_CREDIT;
    expect(costOfOneFreeRender).not.toBeCloseTo(allowance, 2);
    expect(getVideoModel("kling").costPerSecondUsd * 5).toBeCloseTo(allowance, 4);
  });

  it("runs for a first-time account that has not built a character yet", () => {
    // The free tier's whole job is the FIRST render. A model whose endpoint
    // hard-requires an image would be rejected before any credit is spent
    // (requiresReferenceImage in actions.ts) for exactly the people the
    // trial exists to convert.
    expect(requiresReferenceImage(model)).toBe(false);
    expect(MODEL_CAPABILITIES[model.id as VideoModelId].identity.required).toBe(false);
  });

  it("can still put the user's own character in the render", () => {
    // The reason a cheaper text-only endpoint was NOT chosen. Showing
    // someone their character is what converts them; a free render of a
    // stranger is the wrong saving for this product. identity.max >= 1
    // means fal.ts has a lane that accepts the character photo.
    expect(MODEL_CAPABILITIES[model.id as VideoModelId].identity.max).toBeGreaterThanOrEqual(1);
  });

  it("charges nothing extra for a longer clip, because it cannot make one", () => {
    // wan-turbo's flat per-video price is recorded as a per-second rate
    // times its ONE duration. A second duration row would make
    // pricingAudit() assert a cost fal does not charge — see the catalogue
    // comment. This is the invariant that equivalence rests on.
    if (model.id === "wan-turbo") {
      expect(model.durations).toHaveLength(1);
      expect(costOfOneFreeRender).toBeCloseTo(0.1, 4);
    }
  });

  it("leaves the whole catalogue loss-free", () => {
    expect(pricingAudit()).toEqual([]);
  });
});
