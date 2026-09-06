import { describe, expect, it } from "vitest";
import {
  COST_BASIS_USD_PER_CREDIT,
  getVideoModel,
  pricingAudit,
  requiresReferenceImage,
  isDormantVideoModel,
  isByteplusOnlyModel,
} from "./providers/video-models";

// Seedance without a character (2026-09-06, operator: "Add the text to video
// capability in seedance. Thats a plus for us").
//
// Both Seedance rows used to name a reference-to-video endpoint, and
// requiresReferenceImage() is a regex over exactly that string — so the two
// server gates in actions.ts refused every characterless Seedance send before
// a credit was reserved. Pointing the catalogue at the text-to-video lane
// flips that one predicate and removes both gates at once; fal.ts swaps back
// UP to reference-to-video whenever there is an identity photo or a clip to
// continue from, which is the same in-place lane swap wan-turbo and
// gemini-omni already do in the opposite direction.
//
// What this file exists to catch: someone "tidying" the catalogue endpoint
// back to the reference lane, which would silently re-close the feature.

describe("Seedance is text-to-video capable", () => {
  it("names the text-to-video lane on both rows", () => {
    expect(getVideoModel("seedance-2").falEndpoint).toBe("bytedance/seedance-2.0/text-to-video");
    expect(getVideoModel("seedance").falEndpoint).toBe("bytedance/seedance-2.5/text-to-video");
  });

  it("therefore no longer demands a reference photo", () => {
    expect(requiresReferenceImage(getVideoModel("seedance-2"))).toBe(false);
    expect(requiresReferenceImage(getVideoModel("seedance"))).toBe(false);
  });

  // The models that genuinely cannot start without a frame must stay gated —
  // this is the same predicate, so a careless widening would show up here.
  it("leaves the genuinely frame-starting models gated", () => {
    for (const id of ["kling-o3-pro", "minimax-h3", "kling-2.5", "kling-o3"]) {
      expect(requiresReferenceImage(getVideoModel(id))).toBe(true);
    }
  });
});

// The swap is only safe to make silently because it cannot change what a
// render costs. fal's text-to-video prices, read 2026-09-06 at 720p with
// audio: 2.5 $0.4730/s — exactly the rate recorded for its reference lane —
// and 2.0 $0.3034/s against $0.3024 recorded on 2026-08-21, which is 0.33%
// of provider drift on one number rather than a gap between two lanes.
describe("the lane swap does not move the money", () => {
  const FAL_T2V_PER_SECOND: Record<string, number> = {
    seedance: 0.473,
    "seedance-2": 0.3034,
  };

  it("keeps every Seedance weight above cost at the text-to-video price", () => {
    for (const [id, perSecond] of Object.entries(FAL_T2V_PER_SECOND)) {
      const model = getVideoModel(id);
      for (const d of model.durations) {
        const cost = perSecond * d.seconds;
        const allowance = d.creditWeight * COST_BASIS_USD_PER_CREDIT;
        expect(allowance).toBeGreaterThan(cost);
      }
    }
  });

  it("keeps the catalogue's recorded rate within provider drift of the t2v lane", () => {
    // Deliberately tight: a real lane difference would blow past 2%, and that
    // is the case that must not pass silently — it would mean the weights
    // describe a lane the product no longer sends to.
    for (const [id, perSecond] of Object.entries(FAL_T2V_PER_SECOND)) {
      const recorded = getVideoModel(id).costPerSecondUsd;
      expect(Math.abs(perSecond - recorded) / recorded).toBeLessThan(0.02);
    }
  });

  it("leaves the pricing audit no new complaint about Seedance", () => {
    const flagged = pricingAudit().filter((r) => r.modelId === "seedance" || r.modelId === "seedance-2");
    expect(flagged).toEqual([]);
  });
});

// The dormant pair (2026-09-06, operator: "Wire them dormant with a switch I
// can flip to activate. (For testing purposes)"). Nobody has judged their
// output, so the catalogue carries them and two gates keep them out of reach:
// the composer's list in workspace-data.ts and the server refusal in
// actions.ts, both requiring the experimental_models flag.
describe("the dormant Seedance variants", () => {
  it("are in the catalogue but marked dormant", () => {
    expect(isDormantVideoModel("seedance-2-fast")).toBe(true);
    expect(isDormantVideoModel("seedance-2-mini")).toBe(true);
    expect(getVideoModel("seedance-2-fast").name).toBe("Seedance 2.0 Fast");
    expect(getVideoModel("seedance-2-mini").name).toBe("Seedance 2.0 Mini");
  });

  it("never marks a live model dormant", () => {
    for (const id of ["seedance", "seedance-2", "kling", "veo", "wan-turbo", "gemini-omni"]) {
      expect(isDormantVideoModel(id)).toBe(false);
    }
  });

  // Mini has no fal endpoint of any kind, so on the fal lane its request would
  // be built against a path that does not exist and fail AFTER the charge.
  it("marks only mini as BytePlus-only", () => {
    expect(isByteplusOnlyModel("seedance-2-mini")).toBe(true);
    expect(isByteplusOnlyModel("seedance-2-fast")).toBe(false);
    expect(isByteplusOnlyModel("seedance-2")).toBe(false);
  });

  // fal's own billing record: $0.0112 per 1000 tokens, tokens =
  // (h * w * duration * 24) / 1024. At 720p that is 21,600 tokens/sec.
  // The same page also shows $0.014 — the STANDARD tier's rate, copy-pasted —
  // and pricing from it would overcharge by 25%. This pins the right one.
  it("prices fast from fal's fast-tier token rate, not the standard tier's", () => {
    const tokensPerSecond720p = (1280 * 720 * 24) / 1024;
    expect(tokensPerSecond720p).toBe(21600);
    const fastPerSecond = (tokensPerSecond720p / 1000) * 0.0112;
    expect(getVideoModel("seedance-2-fast").costPerSecondUsd).toBeCloseTo(fastPerSecond, 5);
    // The wrong rate, named so a future edit cannot drift onto it unnoticed.
    const standardPerSecond = (tokensPerSecond720p / 1000) * 0.014;
    expect(getVideoModel("seedance-2-fast").costPerSecondUsd).not.toBeCloseTo(standardPerSecond, 4);
  });

  it("keeps both dormant rows above cost at their recorded rates", () => {
    for (const id of ["seedance-2-fast", "seedance-2-mini"]) {
      const model = getVideoModel(id);
      for (const d of model.durations) {
        expect(d.creditWeight * COST_BASIS_USD_PER_CREDIT).toBeGreaterThan(
          model.costPerSecondUsd * d.seconds,
        );
      }
    }
  });

  it("leaves the pricing audit no complaint about either", () => {
    const flagged = pricingAudit().filter(
      (r) => r.modelId === "seedance-2-fast" || r.modelId === "seedance-2-mini",
    );
    expect(flagged).toEqual([]);
  });
});
