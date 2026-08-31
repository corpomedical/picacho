import { describe, expect, it } from "vitest";
import { PRICING_TIERS } from "./pricing";
import { PLAN_LIMITS } from "./plans";

// pricing.ts's own header states the rule this enforces: "`credits` here MUST
// stay equal to PLAN_LIMITS — this table is what the marketing pages print,
// PLAN_LIMITS is what the server enforces, and the two disagreeing is false
// advertising." That rule had no test until 2026-08-30, which is how a credit
// change could have shipped to the pricing page without reaching the meter,
// or the reverse.

describe("advertised credits match what the server grants", () => {
  it("every tier's printed credits equal its PLAN_LIMITS allowance", () => {
    for (const tier of PRICING_TIERS) {
      expect(
        PLAN_LIMITS[tier.id as keyof typeof PLAN_LIMITS],
        `${tier.name}: the pricing page prints ${tier.credits} but the server grants ${
          PLAN_LIMITS[tier.id as keyof typeof PLAN_LIMITS]
        }`,
      ).toBe(tier.credits);
    }
  });

  it("the feature bullets quote the same number the tier does", () => {
    // The first bullet leads with the credit count on every tier. A tier
    // whose bullet disagrees with its own `credits` field is the same false
    // advertising by another route.
    for (const tier of PRICING_TIERS) {
      expect(tier.features[0], `${tier.name}'s first bullet`).toContain(String(tier.credits));
    }
  });
});

describe("annual pricing stays honest", () => {
  it("every annual price is below its monthly price", () => {
    for (const tier of PRICING_TIERS) expect(tier.annualPrice).toBeLessThan(tier.price);
  });

  it("REGRESSION: no tier's discount exceeds what its margin can pay for", () => {
    // A discount comes out of gross margin. Elite at 1000 credits cost
    // $339.60/mo against $404.66 of net revenue, so 15% off gave away 94% of
    // the margin and left 1.2%. The guard: no tier may discount past 25%
    // without someone re-doing that arithmetic deliberately.
    for (const tier of PRICING_TIERS) {
      const discount = (tier.price - tier.annualPrice) / tier.price;
      expect(discount, `${tier.name} annual discount`).toBeLessThanOrEqual(0.25);
    }
  });
});

// The i18n copy is the SECOND place credit numbers live, and it is the one
// the pricing page actually renders — pricing-card.tsx reads its feature
// bullets from t.pricingTiers, not from PRICING_TIERS.features. The 5fcff70
// Elite repricing proved the gap: pricing.ts and plans.ts moved to 750 while
// the live page kept selling "600 credits" and the compare pages "1,000
// credits" in four languages, for two days, on a live site. This binds every
// locale's copy to the server's number so a repricing that misses the words
// fails here instead of shipping as false advertising.
describe("the i18n copy agrees with the meter", () => {
  // Static imports would break the no-config vitest run if these ever gain
  // "@/" imports; today they are import-free, and requiring them lazily keeps
  // this test from being the thing that couples them.
  const locales = ["en", "es", "pt", "it"] as const;

  it("every locale's Elite bullet and compare-page entry say the granted number", async () => {
    for (const loc of locales) {
      const messages = (await import(`./i18n/messages/${loc}`)).default as {
        pricingTiers: Record<string, { features: string[] }>;
        marketing: { compare: { picEntry: string } };
      };
      const bullets = messages.pricingTiers.elite.features.join(" ");
      expect(bullets, `${loc} Elite bullet`).toContain(String(PLAN_LIMITS.elite));
      expect(bullets, `${loc} Elite bullet still carries an old number`).not.toMatch(
        /\b600\b|1[.,]000/,
      );
      expect(messages.marketing.compare.picEntry, `${loc} compare entry`).toContain(
        String(PLAN_LIMITS.elite),
      );
    }
  });
});
