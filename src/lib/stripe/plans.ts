import type { PlanId } from "@/lib/plans";

type PaidPlanId = Exclude<PlanId, "none">;

// Maps our internal plan IDs to Stripe Price IDs. These are live-mode price
// IDs (created 2026-08-09 via setup-live-stripe.js, matching PRICING_TIERS
// in pricing.ts) — they only work together with a live secret key
// (STRIPE_SECRET_KEY=sk_live_...) in the environment. The previous test-mode
// ids (price_1U1T5N..., created against the sandbox account) no longer apply
// once STRIPE_SECRET_KEY is switched to live; keep that in mind if local dev
// ever needs to exercise checkout again with a test key. A null value means
// that plan isn't purchasable through Checkout yet.
export const PLAN_PRICE_IDS: Record<PaidPlanId, string | null> = {
  // Basic ($9/mo) added 2026-08-19 with the credits restructure; live price
  // created by the operator the same day (Product "Picacho Basic",
  // prod_V6BuImlORl1Tgr, $9.00/month USD + €9.00/month EUR on one product).
  basic: "price_1U5zWuApOHKJpXjxEUFWMm6j",
  starter: "price_1U2XAVApOHKJpXjxrELCc6RO",
  growth: "price_1U2XAWApOHKJpXjx03kFoMhA",
  studio: "price_1U2XAWApOHKJpXjxLHi3jyvH",
  elite: "price_1U2XAXApOHKJpXjxjFjcdKbV",
};

// EUR twin of PLAN_PRICE_IDS, added 2026-08-09 — same amounts (same-number
// swap: €19/€79/€299/€499, not a literal $ -> € conversion, see
// LAUNCH_CHECKLIST.md "Currency" item for the reasoning), attached to the
// *same* Stripe Products as their USD counterparts, just a second Price on
// each. Charging EU customers directly in EUR avoids both Stripe's Adaptive
// Pricing markup (2-4%, fluctuates) and the currency-conversion fee that'd
// otherwise apply when a USD charge gets converted to EUR at payout (the
// Stripe account settles in Spain, in EUR).
//
// Created 2026-08-09 via setup-eur-pricing.js (run locally, since this
// sandbox can't reach api.stripe.com), each attached to the same Product as
// its USD counterpart above.
export const PLAN_PRICE_IDS_EUR: Record<PaidPlanId, string | null> = {
  // €9/month, same-number swap — same product as the USD price above.
  basic: "price_1U5zXqApOHKJpXjxatz3LYUL",
  starter: "price_1U2ZItApOHKJpXjxMWvOYMa1",
  growth: "price_1U2ZIuApOHKJpXjxnwr2dakn",
  studio: "price_1U2ZIuApOHKJpXjxhvJSDafF",
  elite: "price_1U2ZIvApOHKJpXjxfEaFxife",
};

export function planIdForPriceId(priceId: string): PaidPlanId | undefined {
  const allMaps = [PLAN_PRICE_IDS, PLAN_PRICE_IDS_EUR];
  for (const map of allMaps) {
    const found = (Object.entries(map) as [PaidPlanId, string | null][]).find(
      ([, id]) => id === priceId,
    );
    if (found) return found[0];
  }
  return undefined;
}

// For revenue reporting (Admin > Billing, Admin dashboard) — mixing USD and
// EUR subscriber counts into one raw sum would be wrong even though the
// digits happen to match per plan (same-number swap), since €19 and $19
// aren't the same amount of money. Callers bucket by this instead of adding
// blindly. Falls back to "usd" for anything unrecognized (e.g. profiles from
// before EUR pricing existed, or a plan assigned manually with no real
// Stripe price attached) to match the pre-EUR-pricing behavior exactly.
export function currencyForPriceId(priceId: string | null | undefined): "usd" | "eur" {
  if (priceId && Object.values(PLAN_PRICE_IDS_EUR).includes(priceId)) return "eur";
  return "usd";
}
