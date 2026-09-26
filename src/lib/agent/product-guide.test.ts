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

  it("describes Helios as launched — every paid plan, the four modes, the caps — and keeps photo builds unoffered", () => {
    // SETS_OPEN_TO_PLANS flipped 2026-09-19 (the launch commit): the
    // assistant now walks a paying customer to the real page.
    expect(SETS_OPEN_TO_PLANS, "Sets closed again: put the private-testing SETS line back in product-guide.ts").toBe(true);
    expect(guide).toContain("SETS (Helios 3D)");
    expect(guide).toContain("/app/sets");
    expect(guide).toContain("on every paid plan");
    expect(guide).toContain("a photo-based build is not offered to customers");
    expect(guide).not.toContain("in private testing");
  });

  // Helios Cut 2, step 1 (2026-09-25): the assistant tells the truth about
  // what a set's own chat spends. Helios sits behind the sidebar's Tools
  // door since d31ed06; a change to the set itself is always a press on a
  // card that shows the month's changes; stills and takes are priced on
  // their buttons; and it shoots unasked only in "Shoot without asking".
  it("says where Helios is, and what the set's chat spends and when", () => {
    // The sidebar's own word, as the Upscale line says it: never the design's "Tools door" (review of Cut 2, W15).
    expect(guide).toContain('"Helios 3D" under "Tools" in the sidebar (/app/sets)');
    expect(guide).not.toContain("Tools door");
    expect(guide).toContain('It never changes the set itself unless the person presses "Change the set" on a card that shows the month\'s changes left');
    expect(guide).toContain("stills and takes are priced on their buttons");
    expect(guide).toContain('it shoots on its own only in "Shoot without asking"');
    // The Producer's hands in Helios (2026-09-25, operator: "The assistand
    // should be able to fix these things"): one thing at a time, free and
    // undoable; anything else is still the set page's to do.
    expect(guide).toContain("Aly, the personal assistant (the lamp), can read a set and fix one thing in it as a whole");
    expect(guide).toContain("free and undoable, saved to the set's Build copy; for anything else it tells the person what to type there.");
    expect(guide).not.toContain("The Producer does not change sets");
    // Never the promise the page cannot keep in "Shoot without asking".
    expect(guide).not.toMatch(/asks before anything that costs/i);
  });

  // Review of Cut 3: the Sets home's Set chip starts on the latest set, so
  // "describe it and Astra builds it" alone sent a returning person's new
  // place into yesterday's set. The guide says how a new place is built.
  it("says the Sets home starts on the latest set, and how a new place is built", () => {
    expect(guide).toContain('On the Sets home the "Set" chip starts on the person\'s latest set, so words typed there go to that set');
    expect(guide).toContain('to build a new place, choose Set → "A new place"');
    expect(guide).toContain('"Build this place · N of M left this month"');
    expect(guide).toContain("a failed build never counts toward the month, and deleting a set never gives its build back.");
  });

  it("never leaks a drafted (unproven) preset", () => {
    for (const p of CINEMA_PRESETS) {
      if (p.proven === false) {
        expect(guide).not.toContain(p.id.replace(/-/g, " "));
      }
    }
  });
});
