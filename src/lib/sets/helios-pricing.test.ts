import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { heliosPlanFeatures, heliosPlanFeaturesWhen } from "./helios-pricing";
import { SETS_OPEN_TO_PLANS, SET_BUILDS_MONTHLY_LIMITS } from "./set-config";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMsgs from "../i18n/messages/it";

// Helios on the pricing page (launch prep, 2026-09-19): written before the
// flip, shown only after it — the doc's order (ASTRA_SETS.md §4) without
// ever advertising a feature nobody can buy.

describe("the pricing page's Helios bullets", () => {
  const words = en.pricingTiers.helios;

  it("say nothing anywhere while Helios is closed — today's state", () => {
    expect(SETS_OPEN_TO_PLANS).toBe(false);
    for (const plan of ["basic", "starter", "growth", "studio", "elite", "none"]) {
      expect(heliosPlanFeatures(plan, words)).toEqual([]);
    }
  });

  it("once open, say each plan's own build cap from the enforced table, and takes on Studio", () => {
    expect(heliosPlanFeaturesWhen(true, "basic", words)).toEqual(["Helios — build 1 cinematic 3D set a month, stills included"]);
    expect(heliosPlanFeaturesWhen(true, "growth", words)).toEqual([`Helios — build ${SET_BUILDS_MONTHLY_LIMITS.growth} cinematic 3D sets a month, stills included`]);
    expect(heliosPlanFeaturesWhen(true, "studio", words)).toEqual([
      `Helios — build ${SET_BUILDS_MONTHLY_LIMITS.studio} cinematic 3D sets a month, stills included`,
      "Helios takes & films — moving shots rendered from your sets",
    ]);
    // Elite inherits the takes line through "Everything in Studio"; its own bullet is the bigger cap.
    expect(heliosPlanFeaturesWhen(true, "elite", words)).toHaveLength(1);
    expect(heliosPlanFeaturesWhen(true, "none", words)).toEqual([]);
  });

  it("exist in every locale, each carrying the {n} slot and the Helios name", () => {
    for (const m of [en, es, pt, itMsgs]) {
      const w = m.pricingTiers.helios;
      expect(w.heliosSets).toContain("{n}");
      for (const line of [w.heliosSetsOne, w.heliosSets, w.heliosTakes]) expect(line).toContain("Helios");
      expect(heliosPlanFeaturesWhen(true, "starter", w)[0]).not.toContain("{n}");
    }
  });

  it("ride both faces of the pricing card", () => {
    const card = readFileSync(join(__dirname, "../../components/marketing/pricing-card.tsx"), "utf8");
    expect(card).toContain("...heliosPlanFeatures(tier.id, t.pricingTiers.helios)");
    expect(card).toContain("const [creditsFeature, ...restFeatures] = features;");
    expect(card).toContain("{features.map((feature) => (");
  });
});
