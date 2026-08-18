import { createClient } from "@/lib/supabase/server";
import { PLAN_LIMITS, PLAN_LABELS, type PlanId } from "@/lib/plans";
import { PRICING_TIERS } from "@/lib/pricing";
import { currencyForPriceId, planIdForPriceId } from "@/lib/stripe/plans";
import { Card } from "@/components/ui/card";

const PRICE_BY_PLAN: Record<string, number> = Object.fromEntries(
  PRICING_TIERS.map((t) => [t.id, t.price]),
);

// Monthly-equivalent value of an annual subscription. Annual bills
// tier.annualPrice * 12 once a year (see createCheckoutSession), so its MRR
// contribution is annualPrice — counting it at the full monthly rate (as
// this page did before plan_interval existed) overstated every annual
// subscriber by the exact discount they were given for prepaying.
const ANNUAL_PRICE_BY_PLAN: Record<string, number> = Object.fromEntries(
  PRICING_TIERS.map((t) => [t.id, t.annualPrice]),
);

export default async function AdminBillingPage() {
  const supabase = await createClient();
  const { data: profiles } = await supabase
    .from("profiles")
    .select("plan, plan_status, stripe_price_id, plan_currency, plan_interval");

  const distribution = Object.fromEntries(
    (Object.keys(PLAN_LIMITS) as PlanId[]).map((plan) => [plan, 0]),
  ) as Record<PlanId, number>;

  (profiles ?? []).forEach((p) => {
    const plan = (p.plan ?? "none") as PlanId;
    distribution[plan] = (distribution[plan] ?? 0) + 1;
  });

  // Only "active" reflects money actually being collected right now —
  // comped plans (assigned manually, no real subscription) and past_due
  // ones (payment failed, hasn't retried successfully yet) don't count.
  //
  // Split by currency rather than one combined sum — since EUR pricing
  // went live (2026-08-09) some subscribers pay in USD and some in EUR, and
  // €19 + $19 isn't "$38" or "€38", it's two different amounts of money.
  // The digits happen to match per plan (same-number swap), but adding them
  // together would still be wrong.
  const mrrByCurrency = (profiles ?? []).reduce(
    (acc, p) => {
      if (p.plan_status !== "active") return acc;
      const plan = (p.plan ?? "none") as PlanId;
      // plan_currency / plan_interval are snapshotted by the webhook straight
      // off the subscription's price object (added 2026-08-19, see
      // supabase/pending-2026-08-19/billing.sql). They exist because annual
      // subscriptions bill on an INLINE price with no entry in
      // PLAN_PRICE_IDS, so currencyForPriceId() bucketed every EUR annual
      // subscriber as USD and the sum valued annual subscribers at the full
      // monthly rate. Profiles from before the columns (NULL until their
      // subscription's next webhook event backfills them) fall back to the
      // old guesses — with one improvement: an unrecognized price id on an
      // active subscription can only be an inline annual price, so it's at
      // least valued at annual/12 (its currency stays the USD fallback; the
      // id alone genuinely can't say).
      const currency: "usd" | "eur" =
        p.plan_currency === "eur" || p.plan_currency === "usd"
          ? (p.plan_currency as "usd" | "eur")
          : currencyForPriceId(p.stripe_price_id);
      const isAnnual = p.plan_interval
        ? p.plan_interval === "year"
        : Boolean(p.stripe_price_id) && !planIdForPriceId(p.stripe_price_id);
      acc[currency] += (isAnnual ? ANNUAL_PRICE_BY_PLAN[plan] : PRICE_BY_PLAN[plan]) ?? 0;
      return acc;
    },
    { usd: 0, eur: 0 },
  );
  const pastDueCount = (profiles ?? []).filter((p) => p.plan_status === "past_due").length;
  const canceledCount = (profiles ?? []).filter((p) => p.plan_status === "canceled").length;

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900">Billing</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-neutral-500">MRR</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">
            ${mrrByCurrency.usd}
            {mrrByCurrency.eur > 0 && (
              <span className="text-neutral-400"> + €{mrrByCurrency.eur}</span>
            )}
          </p>
          <p className="mt-1 text-xs text-neutral-400">From active Stripe subscriptions only</p>
        </Card>
        <Card>
          <p className="text-sm text-neutral-500">Failed payments</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{pastDueCount}</p>
          <p className="mt-1 text-xs text-neutral-400">Accounts past due right now</p>
        </Card>
        <Card>
          <p className="text-sm text-neutral-500">Canceled</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{canceledCount}</p>
          <p className="mt-1 text-xs text-neutral-400">
            Snapshot, not a rate — a proper churn-rate needs a subscription-events log we don&apos;t have yet
          </p>
        </Card>
      </div>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-900">Plan distribution</h2>
        <div className="mt-4 space-y-3">
          {(Object.keys(distribution) as PlanId[]).map((plan) => {
            const count = distribution[plan];
            const total = profiles?.length || 1;
            const pct = Math.round((count / total) * 100);
            return (
              <div key={plan}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-700">{PLAN_LABELS[plan]}</span>
                  <span className="text-neutral-500">
                    {count} {plan !== "none" && `/ ${PLAN_LIMITS[plan]} gen`}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full bg-neutral-900"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
