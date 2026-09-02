import { describe, expect, it } from "vitest";
import { renderProductGuide } from "./product-guide";
import { PRICING_TIERS } from "../pricing";
import { FREE_TIER_VIDEO_MODEL_ID } from "../plans";
import { TEMPLATES } from "../templates";
import { CINEMA_PRESETS } from "../generations/cinema-presets";

// The guide is appended to a CACHED system block (see context.ts): its
// bytes must be deterministic, and its numbers must be the same ones the
// product actually charges — derived, never retyped.

describe("renderProductGuide", () => {
  const guide = renderProductGuide();

  it("is byte-stable across calls (prompt-cache prerequisite)", () => {
    expect(renderProductGuide()).toBe(guide);
  });

  it("carries every plan with its real prices and credits", () => {
    for (const t of PRICING_TIERS) {
      expect(guide).toContain(`${t.name}: $${t.price}/mo`);
      expect(guide).toContain(`$${t.annualPrice}/mo billed annually`);
      expect(guide).toContain(`${t.credits} credits/month`);
    }
  });

  it("names the real free-tier model and the template count", () => {
    expect(guide).toContain(FREE_TIER_VIDEO_MODEL_ID);
    expect(guide).toContain(`${TEMPLATES.length} ready-made looks`);
  });

  it("derives the dialogue rate from the weight function (1 cr / 3s today)", () => {
    expect(guide).toContain("1 credit per 3 seconds");
  });

  it("never leaks a drafted (unproven) preset", () => {
    for (const p of CINEMA_PRESETS) {
      if (p.proven === false) {
        expect(guide).not.toContain(p.id.replace(/-/g, " "));
      }
    }
  });
});
