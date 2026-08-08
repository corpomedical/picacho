import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { PRICING_TIERS } from "@/lib/pricing";
import { getServerMessages } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { createCheckoutSession, createPortalSession } from "@/lib/stripe/actions";

type Tier = (typeof PRICING_TIERS)[number];

export async function PricingCard({ tier }: { tier: Tier }) {
  const { t } = await getServerMessages();
  const localized = t.pricingTiers[tier.id];

  // Logged-out visitors go through signup first. Logged-in visitors get a
  // real button: straight to Checkout if they have no live subscription
  // yet, or to the Customer Portal if they do — Stripe's portal is what
  // actually handles switching between plans on an existing subscription
  // (with correct proration), so we never start a second Checkout for
  // someone who's already paying.
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

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
        tier.highlight && "shadow-[0_1px_2px_rgba(0,0,0,0.03),0_16px_36px_-14px_rgba(0,0,0,0.14)] ring-1 ring-neutral-900",
      )}
    >
      {localized.badge && (
        <span className="mb-4 inline-flex w-fit items-center rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white">
          {localized.badge}
        </span>
      )}
      <h3 className="text-sm font-semibold text-neutral-900">{localized.name}</h3>
      <p className="mt-2">
        <span className="text-3xl font-semibold text-neutral-900">${tier.price}</span>
        <span className="text-sm text-neutral-500">{t.marketing.pricing.perMonth}</span>
      </p>

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
          <Button type="submit" variant={tier.highlight ? "primary" : "secondary"} className="w-full">
            {t.settings.manageBilling}
          </Button>
        </form>
      ) : (
        <form action={createCheckoutSession} className="mt-6">
          <input type="hidden" name="plan" value={tier.id} />
          <Button type="submit" variant={tier.highlight ? "primary" : "secondary"} className="w-full">
            {t.marketing.pricing.getStarted}
          </Button>
        </form>
      )}
    </Card>
  );
}
