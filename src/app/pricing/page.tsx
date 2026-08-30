import Link from "next/link";
import type { Metadata } from "next";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { PricingCard } from "@/components/marketing/pricing-card";
import { PRICING_TIERS } from "@/lib/pricing";
import { getServerMessages } from "@/lib/i18n/server";
import { localeAlternates } from "@/lib/i18n/metadata";
import { isNativeApp } from "@/lib/native/server";

// Renders as "Pricing | Picacho" via the title.template set in the root
// layout. Without this the tab title and search-result link for this page
// were just "Picacho" — identical to every other page, so Google had no
// signal this was the page to rank for pricing-related searches.
// generateMetadata rather than a static object (2026-08-30): the canonical
// now depends on which locale URL is being served — /pricing vs /es/pricing —
// and the hreflang set has to be emitted on all four. The static
// `alternates: { canonical: "/pricing" }` this replaces would have pinned
// every locale's canonical to the English page, which is the standard way to
// make Google discard the translations as duplicates.
//
// Title and description stay English for now: the localized <html lang> and
// body are what make the page indexable in its language, and inventing
// translated SEO strings without them being reviewed would be worse than
// leaving these until they are. Localize them by moving these two strings
// into the message files.
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Pricing",
    description:
      "Simple, transparent pricing for consistent AI character photos and videos. Compare plans and find the right fit, from casual creators to studios.",
    alternates: await localeAlternates("/pricing"),
  };
}

// Always render fresh, never serve a CDN-cached copy. These marketing/legal
// pages were getting stuck: after a deploy, one hostname (picacho.ai) kept
// serving a weeks-old prerendered copy while others served the new build,
// because the pages were statically cacheable and a stale per-host edge copy
// never got evicted. force-dynamic makes every request render on the server,
// so a stale copy can't be served and the content always matches the deploy.
export const dynamic = "force-dynamic";

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string }>;
}) {
  const { t } = await getServerMessages();
  const p = t.marketing.pricing;

  // Inside the native app (Apple 3.1.1 / Google Play) this page may show no
  // prices and no checkout buttons. Render a minimal "manage your plan on the
  // web" message instead of the pricing tables — the server-side purchase
  // actions are blocked separately; this is purely so an App reviewer never
  // sees a purchase entry point. Web visitors fall through to the full page.
  const native = await isNativeApp();
  if (native) {
    return (
      <div className="min-h-screen bg-neutral-50">
        <MarketingHeader />
        <section className="mx-auto flex max-w-2xl flex-col items-center px-8 py-32 text-center">
          <h1 className="font-display text-2xl font-bold tracking-[-0.03em] text-neutral-900 sm:text-3xl">
            {p.title}
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm text-neutral-500">{p.manageOnWeb}</p>
          <Link
            href="/app"
            className="mt-8 inline-flex items-center justify-center rounded-[10px] bg-neutral-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
          >
            {t.marketing.nav.goToApp}
          </Link>
        </section>
        <MarketingFooter />
      </div>
    );
  }

  const { billing } = await searchParams;
  // Annual is the default view — it's the offer we lead with. ?billing=monthly
  // flips it; a URL param (not client state) so the server-rendered cards and
  // their checkout forms stay in lockstep, and the choice is shareable.
  const interval: "annual" | "month" = billing === "monthly" ? "month" : "annual";

  return (
    <div className="min-h-screen bg-neutral-50">
      <MarketingHeader />

      <section className="mx-auto max-w-3xl px-8 pt-20 pb-4 text-center">
        <h1 className="font-display text-3xl font-bold tracking-[-0.03em] text-neutral-900 sm:text-4xl">
          {p.title}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm text-neutral-500">{p.subtitle}</p>
      </section>

      {/* max-w-6xl + a 5-column top break (2026-08-19): the Basic tier made
          it five cards, and five into the old lg:grid-cols-4 left one card
          orphaned on its own row. */}
      <section className="mx-auto max-w-6xl px-8 py-16">
        <div className="mb-10 flex justify-center">
          <div className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white p-1">
            <Link
              href="/pricing"
              className={
                interval === "annual"
                  ? "flex items-center gap-1.5 rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white"
                  : "rounded-full px-4 py-1.5 text-sm text-neutral-500 hover:text-neutral-900"
              }
            >
              {p.billingAnnual}
              {/* Matches the real annualPrice discount in lib/pricing.ts
                  (~15% since 2026-08-19; was -25%) — change both together. */}
              <span
                className={
                  interval === "annual"
                    ? "rounded-full bg-ochre px-1.5 py-0.5 text-[10px] font-semibold text-white"
                    : "hidden"
                }
              >
                -15%
              </span>
            </Link>
            <Link
              href="/pricing?billing=monthly"
              className={
                interval === "month"
                  ? "rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white"
                  : "rounded-full px-4 py-1.5 text-sm text-neutral-500 hover:text-neutral-900"
              }
            >
              {p.billingMonthly}
            </Link>
          </div>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {PRICING_TIERS.map((tier) => (
            <PricingCard key={tier.id} tier={tier} interval={interval} />
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-neutral-400">{p.overageNote}</p>
      </section>

      {/* FAQ — answers the questions that previously made buying blind:
          what a "generation" actually is, whether failures cost money,
          the free trial, refunds, and cancellation. */}
      <section className="mx-auto max-w-2xl px-8 pb-20">
        <h2 className="text-center text-xl font-semibold tracking-tight text-neutral-900">
          {p.faqTitle}
        </h2>
        <dl className="mt-8 space-y-6">
          {p.faq.map((item) => (
            <div key={item.q} className="rounded-[18px] border border-neutral-100 bg-white p-5">
              <dt className="text-sm font-medium text-neutral-900">{item.q}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-neutral-500">{item.a}</dd>
            </div>
          ))}
        </dl>
        {/* FAQPage structured data for rich results — generated from the
            SAME localized array rendered above, so the markup can never say
            something the page doesn't (Google's core requirement for FAQ
            snippets). JSON-LD is inert data, no nonce needed (see layout). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: p.faq.map((item) => ({
                "@type": "Question",
                name: item.q,
                acceptedAnswer: { "@type": "Answer", text: item.a },
              })),
            }),
          }}
        />
      </section>

      <MarketingFooter />
    </div>
  );
}
