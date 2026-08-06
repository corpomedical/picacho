import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { PRICING_TIERS } from "@/lib/pricing";
import { getServerMessages } from "@/lib/i18n/server";

type Tier = (typeof PRICING_TIERS)[number];

export async function PricingCard({ tier }: { tier: Tier }) {
  const { t } = await getServerMessages();
  const localized = t.pricingTiers[tier.id];

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

      <Link href="/signup" className="mt-6 block">
        <Button variant={tier.highlight ? "primary" : "secondary"} className="w-full">
          {t.marketing.pricing.getStarted}
        </Button>
      </Link>
    </Card>
  );
}
