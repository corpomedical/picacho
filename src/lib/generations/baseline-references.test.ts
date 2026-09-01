import { describe, expect, it } from "vitest";
import { baselineIdentityReferences } from "./send-plan";

// Baseline multi-reference (2026-08-30). Before this existed, every ordinary
// render sent the model ONE photo while fal.ts was already slicing four —
// a character with eight saved photos was described to a four-reference
// model by one of them.

const EIGHT = ["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg", "f.jpg", "g.jpg", "h.jpg"];

describe("baselineIdentityReferences", () => {
  it("sends four photos to the elements lanes", () => {
    expect(baselineIdentityReferences("kling", EIGHT)).toEqual(["a.jpg", "b.jpg", "c.jpg", "d.jpg"]);
    expect(baselineIdentityReferences("kling-o3-pro", EIGHT)).toHaveLength(4);
  });

  it("sends four photos to the citation lanes", () => {
    expect(baselineIdentityReferences("seedance", EIGHT)).toHaveLength(4);
    expect(baselineIdentityReferences("seedance-2", EIGHT)).toHaveLength(4);
  });

  it("sends FIVE to MiniMax H3 — the widest identity set, and the last free one", () => {
    // fal's schema takes nine, but bills every image past the fifth at
    // $0.08. The catalogue prices this lane per second only, so a sixth
    // photo would be a cost pricingAudit() cannot see. See the
    // identityBudget note in providers/fal.ts.
    expect(baselineIdentityReferences("minimax-h3", EIGHT)).toHaveLength(5);
    expect(baselineIdentityReferences("minimax-h3", EIGHT)).toEqual([
      "a.jpg",
      "b.jpg",
      "c.jpg",
      "d.jpg",
      "e.jpg",
    ]);
  });

  it("REGRESSION: never multi-references a first-frame model", () => {
    // kling-o3 and kling-2.5 take the photo AS frame one. A second photo has
    // nowhere to go, and quietly swapping which one becomes the opening
    // frame would change the composition the person asked for.
    expect(baselineIdentityReferences("kling-o3", EIGHT)).toEqual([]);
    expect(baselineIdentityReferences("kling-2.5", EIGHT)).toEqual([]);
  });

  it("REGRESSION: never sends MULTIPLE images to Veo", () => {
    // Since 2026-08-30 Veo does take one photo — fal.ts routes to
    // fal-ai/veo3.1/image-to-video when a character photo exists. But that
    // endpoint has a single image_url and no reference array, so the
    // multi-photo path must still decline: the one photo travels as the
    // anchor, exactly like the other first-frame lanes.
    expect(baselineIdentityReferences("veo", EIGHT)).toEqual([]);
  });

  it("leaves the image lanes alone — they take one source image", () => {
    expect(baselineIdentityReferences("gpt-image", EIGHT)).toEqual([]);
    expect(baselineIdentityReferences("flux", EIGHT)).toEqual([]);
  });

  it("puts the tapped photo first, so the primary signal is unchanged", () => {
    // The person picked photo 'e'. It must lead: everything after it can
    // only add context, never displace what they chose.
    const out = baselineIdentityReferences("kling", EIGHT, "e.jpg");
    expect(out[0]).toBe("e.jpg");
    expect(out).toHaveLength(4);
    expect(new Set(out).size).toBe(4); // no duplicate of the primary
  });

  it("ignores a preferred path that is not this character's photo", () => {
    // Mirrors the ownership check in actions.ts — a forged path must not
    // become the identity anchor.
    expect(baselineIdentityReferences("kling", EIGHT, "../someone-else.jpg")[0]).toBe("a.jpg");
  });

  it("declines when there is nothing multi about the send", () => {
    expect(baselineIdentityReferences("kling", ["only.jpg"])).toEqual([]);
    expect(baselineIdentityReferences("kling", [])).toEqual([]);
  });

  it("returns [] for an unknown model rather than guessing", () => {
    expect(baselineIdentityReferences("some-future-model", EIGHT)).toEqual([]);
  });
});
