// Assistant top-ups (2026-09-28, operator: "When a user reaches 100% of
// monthly consumption, give them the chance to recharge by payment"). His
// picks: priced at about twice what the units cost us, and kept until used.
//
// One allowance feeds both assistants, Aly (api/producer) and the composer's
// (api/agent/chat); a unit is $0.02 of what a turn costs us (AGENT_UNIT_USD
// in lib/agent/prices.ts, PRODUCER_UNIT_USD in lib/producer/prices.ts). So:
//
//   units    our cost   price   ×
//     500      $10       $19    1.9
//   1,250      $25       $45    1.8
//   2,500      $50       $85    1.7
//
// Charged in euros at the same figures for EU visitors, like the plans and
// the credit packs (checkout-core.ts startAssistantTopUpCheckout). Bought
// units are spent only after the month's own allowance is used up, and they
// don't run out at the end of the month (supabase/pending/producer-aly.sql).
// Client-safe: plain data.

export type AssistantTopUp = {
  id: string;
  units: number;
  /** Whole dollars (or euros), not cents. */
  price: number;
};

export const ASSISTANT_TOPUPS: readonly AssistantTopUp[] = [
  { id: "assistant-500", units: 500, price: 19 },
  { id: "assistant-1250", units: 1250, price: 45 },
  { id: "assistant-2500", units: 2500, price: 85 },
];

export function getAssistantTopUp(id: string | null | undefined): AssistantTopUp | undefined {
  return ASSISTANT_TOPUPS.find((t) => t.id === id);
}

/** Where a top-up is bought: the embedded checkout, coming back to `returnTo` (an /app/ path). */
export function topUpCheckoutHref(id: string, returnTo: string): string {
  return `/app/checkout?topup=${encodeURIComponent(id)}&return_to=${encodeURIComponent(returnTo)}`;
}
