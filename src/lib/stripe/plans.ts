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
  starter: "price_1U2XAVApOHKJpXjxrELCc6RO",
  growth: "price_1U2XAWApOHKJpXjx03kFoMhA",
  studio: "price_1U2XAWApOHKJpXjxLHi3jyvH",
  elite: "price_1U2XAXApOHKJpXjxjFjcdKbV",
};

export function planIdForPriceId(priceId: string): PaidPlanId | undefined {
  return (Object.entries(PLAN_PRICE_IDS) as [PaidPlanId, string | null][]).find(
    ([, id]) => id === priceId,
  )?.[0];
}
