import { describe, expect, it } from "vitest";
import { renderProductGuide } from "./product-guide";
import { PRICING_TIERS } from "../pricing";
import { FREE_TIER_VIDEO_MODEL_ID } from "../plans";
import { TEMPLATES } from "../templates";
import { CINEMA_PRESETS } from "../generations/cinema-presets";
import { SETS_OPEN_TO_PLANS } from "../sets/set-config";

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

  it("says Sets is not available while it is admin-only, and never how to reach it", () => {
    // SETS_OPEN_TO_PLANS (lib/sets/set-config.ts) is false in Phase 1: the
    // assistant must not walk a customer toward a page that 404s for them.
    expect(SETS_OPEN_TO_PLANS, "Sets opened to plans: rewrite the SETS line in product-guide.ts to describe the real UI").toBe(false);
    expect(guide).toContain("SETS: in private testing");
    expect(guide).not.toContain("/app/sets");
  });

  it("never leaks a drafted (unproven) preset", () => {
    for (const p of CINEMA_PRESETS) {
      if (p.proven === false) {
        expect(guide).not.toContain(p.id.replace(/-/g, " "));
      }
    }
  });
});
