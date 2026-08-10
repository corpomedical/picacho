// One-time credit top-ups, sold alongside the monthly plans.
//
// Pricing intent: a top-up should cost MORE per credit than the same credit
// bought inside a subscription. Otherwise the cheapest way to use Picacho
// heavily is to sit on the smallest plan and top up forever, which converts
// predictable recurring revenue into lumpy one-off revenue and removes any
// reason to upgrade. Rates below are all at or above the best per-credit
// rate any plan offers (Elite, ~EUR1.66/credit), with a modest volume
// discount across the three sizes.
//
// These are starting numbers, not researched positioning — adjust freely.
// Whatever you set here must match what setup-credit-packs.js creates in
// Stripe; the script reads this same file so they can't drift.

export type CreditPack = {
  id: string;
  credits: number;
  /** Whole currency units (EUR/USD), not cents. */
  price: number;
};

export const CREDIT_PACKS: CreditPack[] = [
  { id: "small", credits: 20, price: 45 },
  { id: "medium", credits: 60, price: 119 },
  { id: "large", credits: 150, price: 279 },
];

export function getCreditPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}

// Filled in by running setup-credit-packs.js locally (the build sandbox
// can't reach api.stripe.com — same constraint as setup-live-stripe.js and
// setup-eur-pricing.js before it). null means that pack isn't purchasable
// yet and the UI hides it rather than offering a button that can't work.
// Created 2026-08-10 by running setup-credit-packs.js against the LIVE
// Stripe key. Live-mode prices only work with a live secret key in the
// environment — the same caveat as PLAN_PRICE_IDS in stripe/plans.ts.
export const CREDIT_PACK_PRICE_IDS: Record<string, string | null> = {
  small: "price_1U2n4mApOHKJpXjxVl34F2lW",
  medium: "price_1U2n4nApOHKJpXjxelOWLYRu",
  large: "price_1U2n4pApOHKJpXjxOkOiJPpp",
};

export const CREDIT_PACK_PRICE_IDS_EUR: Record<string, string | null> = {
  small: "price_1U2n4mApOHKJpXjxmcvDTSa1",
  medium: "price_1U2n4nApOHKJpXjxM1TWa2Q7",
  large: "price_1U2n4pApOHKJpXjxZAhSv2WI",
};

// Reverse lookup for the webhook: a completed payment only tells us which
// Price was bought, and that has to map back to a credit count.
export function creditsForPriceId(priceId: string): number | null {
  for (const [packId, id] of Object.entries(CREDIT_PACK_PRICE_IDS)) {
    if (id === priceId) return getCreditPack(packId)?.credits ?? null;
  }
  for (const [packId, id] of Object.entries(CREDIT_PACK_PRICE_IDS_EUR)) {
    if (id === priceId) return getCreditPack(packId)?.credits ?? null;
  }
  return null;
}
