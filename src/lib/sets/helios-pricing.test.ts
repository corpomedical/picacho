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

  it("are live on every paid card — the launch state — and absent for no plan at all", () => {
    expect(SETS_OPEN_TO_PLANS).toBe(true);
    for (const plan of ["basic", "starter", "growth", "studio", "elite"]) {
      expect(heliosPlanFeatures(plan, words), plan).toHaveLength(1);
    }
    expect(heliosPlanFeatures("none", words)).toEqual([]);
  });

  it("once open, say each plan's own build cap from the enforced table — stills, takes and films on every card", () => {
    expect(heliosPlanFeaturesWhen(true, "basic", words)).toEqual(["Helios — build 1 cinematic 3D set a month, with stills, takes and films"]);
    expect(heliosPlanFeaturesWhen(true, "growth", words)).toEqual([`Helios — build ${SET_BUILDS_MONTHLY_LIMITS.growth} cinematic 3D sets a month, with stills, takes and films`]);
    // Takes and films are every paid plan's (2026-09-19 "Open to all plans"): one bullet per card, no Studio extra.
    for (const plan of ["starter", "studio", "elite"]) expect(heliosPlanFeaturesWhen(true, plan, words)).toHaveLength(1);
    expect(heliosPlanFeaturesWhen(true, "none", words)).toEqual([]);
  });

  it("exist in every locale, each carrying the {n} slot and the Helios name", () => {
    for (const m of [en, es, pt, itMsgs]) {
      const w = m.pricingTiers.helios;
      expect(w.heliosSets).toContain("{n}");
      for (const line of [w.heliosSetsOne, w.heliosSets]) expect(line).toContain("Helios");
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
