import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { PricingCard } from "@/components/marketing/pricing-card";
import { PRICING_TIERS } from "@/lib/pricing";
import { getServerMessages } from "@/lib/i18n/server";

export default async function PricingPage() {
  const { t } = await getServerMessages();
  const p = t.marketing.pricing;

  return (
    <div className="min-h-screen bg-neutral-50">
      <MarketingHeader />

      <section className="mx-auto max-w-3xl px-8 pt-20 pb-4 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900 sm:text-4xl">
          {p.title}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm text-neutral-500">{p.subtitle}</p>
      </section>

      <section className="mx-auto max-w-5xl px-8 py-16">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PRICING_TIERS.map((tier) => (
            <PricingCard key={tier.id} tier={tier} />
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-neutral-400">{p.overageNote}</p>
      </section>

      <MarketingFooter />
    </div>
  );
}
