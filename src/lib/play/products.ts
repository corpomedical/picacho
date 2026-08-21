import { CREDIT_PACKS, type CreditPack } from "@/lib/stripe/credit-packs";
import type { PlanId } from "@/lib/plans";

// The Google Play product-ID contract — the single place where Play Console
// product ids and Picacho plans/packs agree. The ids below must be created
// EXACTLY in Play Console (see PLAY_BILLING_SETUP.md):
//
//   subscriptions:  sub_basic · sub_starter · sub_growth · sub_studio · sub_elite
//                   (one monthly base plan each; annual stays web-only for now)
//   consumables:    pack_small · pack_medium · pack_large
//                   (credits/prices mirror credit-packs.json — one source of
//                   truth for amounts, same rule as the Stripe setup script)
//
// RevenueCat forwards product ids either bare ("sub_basic") or with the base
// plan suffix Play attaches ("sub_basic:monthly") — normalize before lookup.

const PLAY_SUB_PRODUCT_TO_PLAN: Record<string, Exclude<PlanId, "none">> = {
  sub_basic: "basic",
  sub_starter: "starter",
  sub_growth: "growth",
  sub_studio: "studio",
  sub_elite: "elite",
};

const PLAY_PACK_PREFIX = "pack_";

export function normalizePlayProductId(raw: string): string {
  // "sub_basic:monthly" → "sub_basic"; ids never legitimately contain ':'.
  const colon = raw.indexOf(":");
  return colon === -1 ? raw : raw.slice(0, colon);
}

export function planForPlayProduct(raw: string): Exclude<PlanId, "none"> | null {
  return PLAY_SUB_PRODUCT_TO_PLAN[normalizePlayProductId(raw)] ?? null;
}

export function packForPlayProduct(raw: string): CreditPack | null {
  const id = normalizePlayProductId(raw);
  if (!id.startsWith(PLAY_PACK_PREFIX)) return null;
  return CREDIT_PACKS.find((p) => p.id === id.slice(PLAY_PACK_PREFIX.length)) ?? null;
}
