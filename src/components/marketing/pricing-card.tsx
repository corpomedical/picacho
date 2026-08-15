import Link from "next/link";
import { formatMsg } from "@/lib/i18n/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/cn";
import { PRICING_TIERS } from "@/lib/pricing";
import { getServerMessages } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { createCheckoutSession, createPortalSession } from "@/lib/stripe/actions";
import { isEUVisitor } from "@/lib/geo";

type Tier = (typeof PRICING_TIERS)[number];

export async function PricingCard({
  tier,
  interval = "annual",
}: {
  tier: Tier;
  // Which billing cycle this card displays and sells. Annual is the default
  // everywhere on purpose — it's the offer we lead with.
  interval?: "annual" | "month";
}) {
  const { t } = await getServerMessages();
  const localized = t.pricingTiers[tier.id];
  const annual = interval === "annual";
  const savePct = Math.round((1 - tier.annualPrice / tier.price) * 100);

  // Logged-out visitors go through signup first. Logged-in visitors get a
  // real button: straight to Checkout if they have no live subscription
  // yet, or to the Customer Portal if they do — Stripe's portal is what
  // actually handles switching between plans on an existing subscription
  // (with correct proration), so we never start a second Checkout for
  // someone who's already paying.
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  // Same-number swap (€19 not a literal $->€ conversion) — see plans.ts —
  // so only the symbol changes here, not the digits.
  const currencySymbol = (await isEUVisitor()) ? "€" : "$";

  let currentPlan: string | null = null;
  let hasLiveSubscription = false;
  if (userData.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan, plan_status")
      .eq("id", userData.user.id)
      .single();
    currentPlan = profile?.plan ?? null;
    hasLiveSubscription = profile?.plan_status === "active" || profile?.plan_status === "past_due";
  }

  const isCurrentPlan = hasLiveSubscription && currentPlan === tier.id;

  return (
    <Card
      className={cn(
        "flex flex-col",
        tier.highlight && "shadow-[0_1px_2px_rgba(0,0,0,0.03),0_16px_36px_-14px_rgba(0,0,0,0.14)] ring-1 ring-ochre",
      )}
    >
      {localized.badge && (
        <span className="mb-4 inline-flex w-fit items-center rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white">
          {localized.badge}
        </span>
      )}
      <h3 className="text-sm font-semibold text-neutral-900">{localized.name}</h3>
      <p className="mt-2 flex items-baseline gap-2">
        {annual && (
          <span className="text-base font-medium text-neutral-300 line-through">
            {currencySymbol}
            {tier.price}
          </span>
        )}
        <span className="text-3xl font-semibold text-neutral-900">
          {currencySymbol}
          {annual ? tier.annualPrice : tier.price}
        </span>
        <span className="text-sm text-neutral-500">{t.marketing.pricing.perMonth}</span>
      </p>
      {annual ? (
        <div className="mt-2 space-y-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-ochre-soft px-2 py-0.5 text-[11px] font-semibold text-ochre">
              {t.marketing.pricing.threeMonthsFree}
            </span>
            <span className="rounded-full border border-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-500">
              {formatMsg(t.marketing.pricing.savePercent, { n: savePct })}
            </span>
          </p>
          <p className="text-xs text-neutral-400">
            {formatMsg(t.marketing.pricing.billedAnnually, {
              sym: currencySymbol,
              total: tier.annualPrice * 12,
            })}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-neutral-400">
          {formatMsg(t.marketing.pricing.monthlyEquivalent, {
            sym: currencySymbol,
            price: tier.annualPrice,
          })}
        </p>
      )}

      <ul className="mt-6 flex-1 space-y-2.5">
        {localized.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-neutral-600">
            <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-neutral-400" />
            {feature}
          </li>
        ))}
      </ul>

      {isCurrentPlan ? (
        <span className="mt-6 flex w-full items-center justify-center rounded-[10px] border border-neutral-200 px-5 py-2.5 text-sm font-medium text-neutral-400">
          {t.marketing.pricing.currentPlan}
        </span>
      ) : !userData.user ? (
        <Link href="/signup" className="mt-6 block">
          <Button variant={tier.highlight ? "primary" : "secondary"} className="w-full">
            {t.marketing.pricing.getStarted}
          </Button>
        </Link>
      ) : hasLiveSubscription ? (
        <form action={createPortalSession} className="mt-6">
          <SubmitButton
            variant={tier.highlight ? "primary" : "secondary"}
            className="w-full"
            pendingLabel={t.common.loading}
          >
            {t.settings.manageBilling}
          </SubmitButton>
        </form>
      ) : (
        <form action={createCheckoutSession} className="mt-6">
          <input type="hidden" name="plan" value={tier.id} />
          <input type="hidden" name="billing_interval" value={annual ? "annual" : "month"} />
          <SubmitButton
            variant={tier.highlight ? "primary" : "secondary"}
            className="w-full"
            pendingLabel={t.common.loading}
          >
            {t.marketing.pricing.getStarted}
          </SubmitButton>
        </form>
      )}
    </Card>
  );
}
