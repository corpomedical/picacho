// One-time credit top-ups, sold alongside the monthly plans.
//
// Pricing intent (revised 2026-08-19 with the credits restructure): a top-up
// must cost more per credit than the same credit bought inside ANY
// subscription someone could upgrade into — benchmarked against
// Starter-and-up, not only against Elite as the original rule was. If a pack
// ever beats Starter's rate, the cheapest way to use Picacho heavily is to
// sit on a small plan and top up forever, which converts predictable
// recurring revenue into lumpy one-off revenue and makes UPGRADING
// pointless — the one thing packs must never do. Rates below are
// $0.75/$0.70/$0.66 per credit against plan rates of basic $0.75 →
// starter ~$0.63 → elite ~$0.50: above every plan rate except Basic's,
// which is deliberate — Basic is priced as the worst rate in the whole
// system on purpose (see PLAN_LIMITS in plans.ts), so a pack tying it
// still leaves every upgrade a strictly better deal.
//
// The pack data itself lives in credit-packs.json (plain JSON, not TS) so
// setup-credit-packs.js can require() the very same file this module
// imports — one source of truth, so what the script creates in Stripe can't
// drift from what the app sells. This file layers the types on top.

export type CreditPack = {
  id: string;
  credits: number;
  /** Whole currency units (EUR/USD), not cents. */
  price: number;
};

import creditPacksJson from "./credit-packs.json";

export const CREDIT_PACKS: CreditPack[] = creditPacksJson;

export function getCreditPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}

// Filled in by running setup-credit-packs.js locally (the build sandbox
// can't reach api.stripe.com — same constraint as setup-live-stripe.js and
// setup-eur-pricing.js before it). null means that pack isn't purchasable
// yet and the UI hides it rather than offering a button that can't work.
//
// Reset to null on 2026-08-19: the pack amounts changed ($45→$15,
// $119→$42, $279→$99) and a Stripe Price's amount is immutable, so the old
// ids now point at prices that would charge the OLD amounts while the UI
// shows the new ones. OPERATOR: re-run `node setup-credit-packs.js` locally
// against the LIVE key — it reuses the existing pack Products, creates new
// Prices at the new amounts (old ones stay attached but unused), and prints
// the two blocks to paste here. Until then packs fail closed: hidden in
// Settings, and checkout redirects "Credit packs aren't set up yet." The
// retired ids live on in LEGACY_CREDIT_PACK_PRICE_CREDITS below so a
// payment already in flight still grants. Live-mode prices only work with a
// live secret key in the environment — the same caveat as PLAN_PRICE_IDS in
// stripe/plans.ts.
export const CREDIT_PACK_PRICE_IDS: Record<string, string | null> = {
  small: null,
  medium: null,
  large: null,
};

export const CREDIT_PACK_PRICE_IDS_EUR: Record<string, string | null> = {
  small: null,
  medium: null,
  large: null,
};

// Price ids retired by the 2026-08-19 repricing, kept ONLY so the webhook
// can still grant credits for a checkout that straddles the deploy: a
// session opened at the old price completes (or its SEPA-style async
// payment settles, which can be DAYS later) after these ids left the live
// maps above, and without this the webhook would log "paid session has no
// matching credit pack" — money taken for nothing. Maps price id → credits
// directly, frozen at what those packs sold, so later edits to
// credit-packs.json can't rewrite what an old purchase was owed. Safe to
// delete once no async payment can still be settling (~30 days after the
// repricing deploy).
const LEGACY_CREDIT_PACK_PRICE_CREDITS: Record<string, number> = {
  // 2026-08-10 USD prices ($45/$119/$279).
  price_1U2n4mApOHKJpXjxVl34F2lW: 20,
  price_1U2n4nApOHKJpXjxelOWLYRu: 60,
  price_1U2n4pApOHKJpXjxOkOiJPpp: 150,
  // 2026-08-10 EUR prices (€45/€119/€279).
  price_1U2n4mApOHKJpXjxmcvDTSa1: 20,
  price_1U2n4nApOHKJpXjxM1TWa2Q7: 60,
  price_1U2n4pApOHKJpXjxZAhSv2WI: 150,
};

// Reverse lookup for the webhook: a completed payment only tells us which
// Price was bought, and that has to map back to a credit count. Current
// prices first; retired ones (see above) answer for in-flight and
// late-settling payments from before a repricing.
export function creditsForPriceId(priceId: string): number | null {
  for (const [packId, id] of Object.entries(CREDIT_PACK_PRICE_IDS)) {
    if (id === priceId) return getCreditPack(packId)?.credits ?? null;
  }
  for (const [packId, id] of Object.entries(CREDIT_PACK_PRICE_IDS_EUR)) {
    if (id === priceId) return getCreditPack(packId)?.credits ?? null;
  }
  return LEGACY_CREDIT_PACK_PRICE_CREDITS[priceId] ?? null;
}

// Which pack to suggest when someone is short of credits for the generation
// they just set up.
//
// Picks the smallest pack that actually covers the shortfall, so the
// suggestion is the cheapest thing that unblocks them rather than the most
// profitable thing we could sell. If the shortfall is larger than the biggest
// pack (a 51-credit 30s Seedance clip on an empty balance clears every pack),
// fall back to the largest and let them buy again — better than recommending
// something that still leaves them stuck.
//
// Deliberately no plan gating anywhere near this: anyone can top up. Hiding
// expensive models from cheaper tiers was the alternative, and refusing to
// sell to someone reaching for their wallet is a strange way to run a
// business.
export function recommendCreditPack(shortfall: number): CreditPack {
  if (shortfall <= 0) return CREDIT_PACKS[0];
  return CREDIT_PACKS.find((p) => p.credits >= shortfall) ?? CREDIT_PACKS[CREDIT_PACKS.length - 1];
}
