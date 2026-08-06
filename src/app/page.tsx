import Link from "next/link";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { PricingCard } from "@/components/marketing/pricing-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PRICING_TIERS } from "@/lib/pricing";
import { getServerMessages } from "@/lib/i18n/server";

export default async function Home() {
  const { t } = await getServerMessages();
  const m = t.marketing.home;

  const STEPS = [
    { title: m.step1Title, detail: m.step1Detail },
    { title: m.step2Title, detail: m.step2Detail },
    { title: m.step3Title, detail: m.step3Detail },
    { title: m.step4Title, detail: m.step4Detail },
  ];

  return (
    <div className="min-h-screen bg-neutral-50">
      <MarketingHeader />

      <section className="mx-auto max-w-3xl px-8 pt-24 pb-20 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-neutral-900 sm:text-5xl">
          {m.heroTitle}
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-neutral-500">{m.heroSubtitle}</p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/signup">
            <Button size="md">{m.getStarted}</Button>
          </Link>
          <Link href="/pricing">
            <Button variant="secondary" size="md">
              {m.seePricing}
            </Button>
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-8 pb-24">
        <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-neutral-400">
          {m.howItWorks}
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, idx) => (
            <Card key={step.title} className="p-6">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-500">
                {idx + 1}
              </span>
              <p className="mt-4 text-sm font-medium text-neutral-900">{step.title}</p>
              <p className="mt-1.5 text-xs text-neutral-500">{step.detail}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-8 pb-24">
        <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-neutral-400">
          {m.pricingHeading}
        </h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PRICING_TIERS.map((tier) => (
            <PricingCard key={tier.id} tier={tier} />
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-neutral-500">
          <Link href="/pricing" className="font-medium text-neutral-900 underline">
            {m.fullPlanDetails}
          </Link>
        </p>
      </section>

      <section className="mx-auto max-w-2xl px-8 pb-24 text-center">
        <Card className="p-12">
          <h2 className="text-xl font-semibold text-neutral-900">{m.ctaTitle}</h2>
          <p className="mt-2 text-sm text-neutral-500">{m.ctaSubtitle}</p>
          <Link href="/signup" className="mt-6 inline-block">
            <Button>{m.getStarted}</Button>
          </Link>
        </Card>
      </section>

      <MarketingFooter />
    </div>
  );
}
