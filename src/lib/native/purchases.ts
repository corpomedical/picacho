import { isNativeAppClient } from "./platform";

// Google Play Billing, resumed (operator, 2026-09-02: "we need to add
// payment on the android app"). The 2026-08-21 foundation — the RevenueCat
// webhook, the product contract in lib/play/products.ts, the pending SQL,
// the runbook — never left; this file is the client half that the same-day
// pivot to external links removed before it shipped.
//
// THE ONE RULE THAT KEEPS THIS SAFE: the deployed site runs inside every
// installed binary, including the reader-mode builds Play already approved
// (versionCode ≤ 9), which do NOT carry the Purchases plugin. Every
// purchase surface therefore self-gates on playBillingAvailable() — shell
// AND plugin AND key — so an old install keeps showing exactly zero
// purchase UI, which is what its review approved, while versionCode 10+
// lights the store up. Never gate purchase UI on isNativeApp alone.

const PRODUCT_IDS = {
  subs: ["sub_basic", "sub_starter", "sub_growth", "sub_studio", "sub_elite"],
  packs: ["pack_small", "pack_medium", "pack_large"],
} as const;

// "sub_basic:monthly" → "sub_basic" — RevenueCat surfaces Play subscriptions
// with the base-plan suffix; the server contract normalizes the same way
// (see lib/play/products.ts).
function normalizeId(raw: string): string {
  const colon = raw.indexOf(":");
  return colon === -1 ? raw : raw.slice(0, colon);
}

export function playBillingAvailable(): boolean {
  if (!isNativeAppClient()) return false;
  const cap = (
    window as unknown as { Capacitor?: { isPluginAvailable?: (name: string) => boolean } }
  ).Capacitor;
  if (!cap?.isPluginAvailable?.("Purchases")) return false;
  // Fail closed until the RevenueCat key is configured in Vercel (runbook
  // step 4) — a store that can't validate receipts must not sell.
  return Boolean(process.env.NEXT_PUBLIC_REVENUECAT_GOOGLE_KEY);
}

type StoreProduct = {
  identifier: string;
  priceString: string;
};

let configuredForUser: string | null = null;
// The raw product objects, kept for purchase calls — RevenueCat's purchase
// API takes the product object it returned, not a bare id.
const productCache = new Map<string, unknown>();

async function plugin() {
  return await import("@revenuecat/purchases-capacitor");
}

// Configure (once per user) and fetch all eight products. Returns
// normalized product id → the STORE's localized price string — Play's own
// price is the only honest one to show, so nothing here falls back to the
// USD sticker table. null = billing not available / fetch failed; callers
// hide the store.
export async function loadPlayStore(userId: string): Promise<Map<string, string> | null> {
  if (!playBillingAvailable()) return null;
  try {
    const { Purchases, PURCHASES_ARE_COMPLETED_BY_TYPE, PRODUCT_CATEGORY } = await plugin();
    if (configuredForUser !== userId) {
      await Purchases.configure({
        apiKey: process.env.NEXT_PUBLIC_REVENUECAT_GOOGLE_KEY as string,
        appUserID: userId,
        // Explicit default: RevenueCat completes (acknowledges/consumes)
        // purchases itself — the webhook only ever grants.
        purchasesAreCompletedBy: PURCHASES_ARE_COMPLETED_BY_TYPE.REVENUECAT,
      });
      configuredForUser = userId;
    }
    const prices = new Map<string, string>();
    // Subscriptions and one-time products are separate catalogs in the
    // billing client; Play may return sub ids bare or base-plan-suffixed
    // depending on catalog version, so both spellings are requested and
    // results normalize to the contract id.
    const [subs, packs] = await Promise.all([
      Purchases.getProducts({
        productIdentifiers: [...PRODUCT_IDS.subs, ...PRODUCT_IDS.subs.map((s) => `${s}:monthly`)],
        type: PRODUCT_CATEGORY.SUBSCRIPTION,
      }),
      Purchases.getProducts({
        productIdentifiers: [...PRODUCT_IDS.packs],
        type: PRODUCT_CATEGORY.NON_SUBSCRIPTION,
      }),
    ]);
    for (const p of [...subs.products, ...packs.products] as StoreProduct[]) {
      const id = normalizeId(p.identifier);
      if (!prices.has(id)) {
        prices.set(id, p.priceString);
        productCache.set(id, p);
      }
    }
    return prices;
  } catch (err) {
    console.error("Play store load failed:", err);
    return null;
  }
}

// Kick off a Play purchase sheet for one product. "granted" means Google
// took the payment and RevenueCat accepted the receipt — the plan/credits
// land moments later via the webhook (the same idempotent path Stripe
// uses), which is why callers show a "landing shortly" note and refresh
// rather than granting anything locally.
export async function purchasePlayProduct(
  productId: string,
): Promise<"granted" | "cancelled" | "error"> {
  const product = productCache.get(normalizeId(productId));
  if (!product) return "error";
  try {
    const { Purchases } = await plugin();
    await Purchases.purchaseStoreProduct({
      product: product as Parameters<typeof Purchases.purchaseStoreProduct>[0]["product"],
    });
    return "granted";
  } catch (err) {
    const e = err as { userCancelled?: boolean; code?: string | number; message?: string };
    if (e.userCancelled || String(e.code) === "1") return "cancelled";
    console.error("Play purchase failed:", err);
    return "error";
  }
}
