// The one-balance plans (2026-10-01, operator: "Adopt the one-balance
// pricing plan at 30%"): how many credits each plan and pack holds, and the
// arithmetic that proves no plan can lose money when every credit is spent.
//
// Credits are credit-prices.ts's: one credit carries at most CREDIT_COST_USD
// of our cost, whatever it is spent on. So a plan's worst month costs us at
// most credits x CREDIT_COST_USD, and each plan below is sized so that even
// then it keeps its floor, on the WORST money we can receive for it:
//
//   - the yearly price (the lowest a month of the plan sells for);
//   - 27% VAT inside the price, the highest in the EU (Hungary);
//   - a premium EEA card at 2.8% + EUR 0.25, Stripe Billing 0.7% and Stripe
//     Tax 0.5% (stripe.com/es/pricing, read 2026-09-30), the fixed fee once a
//     charge (a yearly plan pays it once a year).
//
// The floors: 30% on the top plans, a little more on the smaller ones so a
// bigger plan is always the better price per credit. The operator adopted
// the table as proposed.
//
// Phase 1: nothing reads this yet. The live plans are plans.ts PLAN_LIMITS
// on the old credit; the switch replaces them with PLAN_CREDITS below.
//
// Relative imports only: the test suite loads this module as it is.

import { CREDIT_COST_USD } from "./credit-prices";

export type PaidPlan = "basic" | "starter" | "growth" | "studio" | "elite";
export const PAID_PLANS: readonly PaidPlan[] = ["basic", "starter", "growth", "studio", "elite"];

/** Credits a month, on the new credit. */
export const PLAN_CREDITS: Record<PaidPlan | "none", number> = {
  none: 0,
  basic: 175,
  starter: 380,
  growth: 1700,
  studio: 6500,
  elite: 11000,
};

/**
 * What each plan sells for, per month, billed monthly and billed yearly.
 * Monthly prices are unchanged; yearly stays 15% off, which moves Elite's
 * from $399 (20% off) to $424 at the switch (no one is on Elite today).
 */
export const PLAN_PRICES: Record<PaidPlan, { monthly: number; yearly: number }> = {
  basic: { monthly: 9, yearly: 8 },
  starter: { monthly: 19, yearly: 16 },
  growth: { monthly: 79, yearly: 67 },
  studio: { monthly: 299, yearly: 254 },
  elite: { monthly: 499, yearly: 424 },
};

/** The least each plan keeps of what we receive, with every credit spent on the dearest thing per credit. */
export const PLAN_FLOORS: Record<PaidPlan, number> = {
  basic: 0.4,
  starter: 0.35,
  growth: 0.32,
  studio: 0.3,
  elite: 0.3,
};

/** One-time top-ups: always dearer per credit than any plan, so a plan stays the better buy. */
export const CREDIT_PACKS: readonly { usd: number; credits: number }[] = [
  { usd: 15, credits: 250 },
  { usd: 42, credits: 750 },
  { usd: 99, credits: 1900 },
];
/** The least a pack keeps of what we receive, every credit spent. */
export const PACK_FLOOR = 0.45;

/** The worst case the arithmetic assumes (see the header). */
export const WORST_CASE = {
  vatRate: 0.27,
  /** Premium EEA card 2.8% + Stripe Billing 0.7% + Stripe Tax 0.5%. */
  percentFees: 0.028 + 0.007 + 0.005,
  /** A pack is a one-time charge: no Stripe Billing fee. */
  packPercentFees: 0.028 + 0.005,
  /** EUR 0.25 read as $0.27, the same figure plans.ts has always used. */
  fixedFeeUsd: 0.27,
} as const;

/** The least one month of a plan brings in after VAT and fees: billed monthly, or its share of a yearly charge. */
export function worstNetPerMonthUsd(plan: PaidPlan, billing: "monthly" | "yearly"): number {
  const price = PLAN_PRICES[plan][billing];
  const fixed = billing === "yearly" ? WORST_CASE.fixedFeeUsd / 12 : WORST_CASE.fixedFeeUsd;
  return price / (1 + WORST_CASE.vatRate) - WORST_CASE.percentFees * price - fixed;
}

/** The least a pack brings in after VAT and fees. */
export function worstNetPackUsd(usd: number): number {
  return usd / (1 + WORST_CASE.vatRate) - WORST_CASE.packPercentFees * usd - WORST_CASE.fixedFeeUsd;
}

/** A month with every credit spent: what the plan keeps of the worst money it can bring in, as a share. */
export function worstMargin(plan: PaidPlan, billing: "monthly" | "yearly"): number {
  const net = worstNetPerMonthUsd(plan, billing);
  return (net - PLAN_CREDITS[plan] * CREDIT_COST_USD) / net;
}

/** The same for a pack. */
export function worstPackMargin(pack: { usd: number; credits: number }): number {
  const net = worstNetPackUsd(pack.usd);
  return (net - pack.credits * CREDIT_COST_USD) / net;
}

/** The most credits a plan could hold and still keep its floor on the yearly price. */
export function largestSafePlan(plan: PaidPlan): number {
  return Math.floor((worstNetPerMonthUsd(plan, "yearly") * (1 - PLAN_FLOORS[plan])) / CREDIT_COST_USD);
}
