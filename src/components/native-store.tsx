"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { PLAN_LIMITS, type PlanId } from "@/lib/plans";
import { CREDIT_PACKS } from "@/lib/stripe/credit-packs";
import { loadPlayStore, purchasePlayProduct } from "@/lib/native/purchases";
import { cn } from "@/lib/cn";

// The in-app store — the "next block" the 2026-08-21 Play Billing
// foundation ended on, built 2026-09-02 (operator: "we need to add payment
// on the android app"). Renders NOTHING unless playBillingAvailable() says
// this binary carries the Purchases plugin and the RevenueCat key is
// configured — the deployed site also runs inside the approved reader-mode
// builds, which must keep showing zero purchase UI (see
// lib/native/purchases.ts for the whole rule).
//
// Prices come from Google Play via RevenueCat, localized by the store —
// never from the USD sticker table, which Play may have converted.
// Purchases grant server-side through the RevenueCat webhook (the same
// idempotent path Stripe uses); this component only opens the sheet and
// then refreshes until the grant lands.

const PLAN_ORDER: Exclude<PlanId, "none">[] = ["basic", "starter", "growth", "studio", "elite"];

export function NativeStore({
  userId,
  currentPlan,
}: {
  userId: string;
  currentPlan: PlanId;
}) {
  const { t } = useLocale();
  const s = t.settings;
  const router = useRouter();
  const [prices, setPrices] = useState<Map<string, string> | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<"success" | "error" | null>(null);

  // Load after mount only: the availability check reads window (plugin
  // presence), and the server must keep rendering nothing so old binaries
  // never flash purchase UI.
  useEffect(() => {
    let cancelled = false;
    void loadPlayStore(userId).then((map) => {
      if (!cancelled) setPrices(map);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!prices || prices.size === 0) return null;

  async function buy(productId: string) {
    if (pendingId) return;
    setPendingId(productId);
    setNotice(null);
    const result = await purchasePlayProduct(productId);
    setPendingId(null);
    if (result === "granted") {
      setNotice("success");
      // The webhook grants within seconds; refresh twice so the new plan/
      // credits appear without a manual reload.
      setTimeout(() => router.refresh(), 2500);
      setTimeout(() => router.refresh(), 7000);
    } else if (result === "error") {
      setNotice("error");
    }
  }

  const row = (opts: {
    id: string;
    name: string;
    detail: string;
    price: string;
    disabled?: boolean;
  }) => (
    <div
      key={opts.id}
      className="flex items-center justify-between gap-4 border-b border-atelier-rule/60 py-3 last:border-b-0"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-atelier-ink">{opts.name}</p>
        <p className="mt-0.5 font-numeral text-xs tabular-nums text-atelier-muted">{opts.detail}</p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-3">
        <span className="font-numeral text-sm font-semibold tabular-nums text-atelier-ink">
          {opts.price}
        </span>
        <button
          type="button"
          disabled={Boolean(pendingId) || opts.disabled}
          onClick={() => void buy(opts.id)}
          className={cn(
            "rounded-control bg-atelier-ink px-4 py-2 text-sm font-medium text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-50",
          )}
        >
          {pendingId === opts.id ? s.playStoreProcessing : s.playStoreBuy}
        </button>
      </div>
    </div>
  );

  return (
    <Card className="mt-6">
      <h2 className="text-base font-semibold text-atelier-ink">{s.playStoreTitle}</h2>
      <p className="mt-1 text-xs text-atelier-muted">{s.playStoreNote}</p>

      {notice === "success" && (
        <p className="mt-3 rounded-control bg-atelier-accent/10 px-3 py-2 text-xs text-atelier-accent">
          {s.playStoreSuccess}
        </p>
      )}
      {notice === "error" && (
        <p className="mt-3 rounded-control bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {s.playStoreError}
        </p>
      )}

      <h3 className="mt-5 text-[11px] font-medium uppercase tracking-widest text-atelier-muted">
        {s.playStorePlans}
      </h3>
      {currentPlan === "none" ? (
        <div className="mt-1">
          {PLAN_ORDER.map((planId) => {
            const price = prices.get(`sub_${planId}`);
            if (!price) return null;
            return row({
              id: `sub_${planId}`,
              name: t.pricingTiers[planId].name,
              detail: formatMsg(s.playStoreCreditsMonth, { n: PLAN_LIMITS[planId] }),
              price,
            });
          })}
        </div>
      ) : (
        // A live plan is managed wherever it was bought (Stripe's portal on
        // the web, or Play's own subscription center) — never sell a second
        // subscription on top of one.
        <p className="mt-1 text-xs leading-relaxed text-atelier-muted">
          {formatMsg(s.playStoreManagedElsewhere, {
            plan: t.pricingTiers[currentPlan as Exclude<PlanId, "none">]?.name ?? currentPlan,
          })}
        </p>
      )}

      <h3 className="mt-5 text-[11px] font-medium uppercase tracking-widest text-atelier-muted">
        {s.playStorePacks}
      </h3>
      <div className="mt-1">
        {CREDIT_PACKS.map((pack) => {
          const price = prices.get(`pack_${pack.id}`);
          if (!price) return null;
          return row({
            id: `pack_${pack.id}`,
            name: formatMsg(s.playStoreCreditsOnce, { n: pack.credits }),
            detail: s.playStorePackDetail,
            price,
          });
        })}
      </div>
    </Card>
  );
}
