import type { PlanId } from "@/lib/plans";

type PaidPlanId = Exclude<PlanId, "none">;

// Maps our internal plan IDs to Stripe Price IDs. Filled in once the
// matching product/price exists in the Stripe Dashboard (Product catalog >
// click a product > copy the Price ID, starts with "price_"). A null value
// means that plan isn't purchasable through Checkout yet.
export const PLAN_PRICE_IDS: Record<PaidPlanId, string | null> = {
  starter: "price_1U1T5NPGLcYOhCnTB7qZ8FEA",
  growth: "price_1U1T6jPGLcYOhCnTGl6618Pq",
  studio: "price_1U1T7OPGLcYOhCnTjicCckqW",
  elite: "price_1U1T7hPGLcYOhCnTG490WY6h",
};

export function planIdForPriceId(priceId: string): PaidPlanId | undefined {
  return (Object.entries(PLAN_PRICE_IDS) as [PaidPlanId, string | null][]).find(
    ([, id]) => id === priceId,
  )?.[0];
}
