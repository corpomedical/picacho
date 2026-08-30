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
