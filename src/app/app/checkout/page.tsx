import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerMessages } from "@/lib/i18n/server";
import { startPlanCheckout, startCreditCheckout } from "@/lib/stripe/checkout-core";
import { PRICING_TIERS } from "@/lib/pricing";
import { PLAN_LIMITS, PLAN_LABELS, type PlanId } from "@/lib/plans";
import { getCreditPack } from "@/lib/stripe/credit-packs";
import { CheckoutEmbed } from "@/components/checkout-embed";
import { formatMsg } from "@/lib/i18n/format";
import { isEUVisitor } from "@/lib/geo";

// Embedded checkout (2026-08-22): Stripe's payment form rendered inside a
// Frost page on picacho.ai instead of a redirect to stripe.com. Session
// creation and EVERY guard live in lib/stripe/checkout-core.ts — this page
// calls the same creators the legacy hosted actions use, so the webhook
// payloads, promo codes, tax and metadata are byte-identical to before.
//
// Reached via /app/checkout?plan=<id>&interval=<month|annual>  (subscriptions)
//         or /app/checkout?pack=<id>&return_to=<path>          (credit packs)

export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { t } = await getServerMessages();
  const c = t.checkout;

  const planParam = typeof params.plan === "string" ? params.plan : null;
  const packParam = typeof params.pack === "string" ? params.pack : null;
  const interval = params.interval === "annual" ? "annual" : "month";
  const returnTo = typeof params.return_to === "string" ? params.return_to : "";

  let clientSecret: string | null = null;
  let summaryTitle = "";
  let summaryCredits = "";
  let summaryPrice = "";
  let backHref = "/app/settings?tab=usage";

  // The same visitor test startPlanCheckout itself uses to pick the Stripe
  // price. EU numbers are billed 1:1 in euros (the pricing page says so),
  // but this summary card hard-coded "$" — so an EU customer saw a dollar
  // figure stacked directly above a Stripe iframe collecting euros for the
  // same charge (2026-08-31 inspection). One page, one currency.
  const currencySymbol = (await isEUVisitor()) ? "€" : "$";

  if (planParam) {
    const { clientSecret: cs } = await startPlanCheckout(planParam, interval, "embedded");
    clientSecret = cs;
    const tier = PRICING_TIERS.find((p) => p.id === planParam);
    if (tier) {
      const planId = tier.id as PlanId;
      summaryTitle = `Picacho ${PLAN_LABELS[planId] ?? tier.id}`;
      summaryCredits = formatMsg(c.creditsMonthly, { n: PLAN_LIMITS[planId] ?? 0 });
      summaryPrice =
        interval === "annual"
          ? formatMsg(c.priceAnnual, { price: `${currencySymbol}${tier.annualPrice * 12}` })
          : formatMsg(c.priceMonthly, { price: `${currencySymbol}${tier.price}` });
    }
  } else if (packParam) {
    const { clientSecret: cs, returnTo: safeReturn } = await startCreditCheckout(
      packParam,
      returnTo,
      "embedded",
    );
    clientSecret = cs;
    backHref = safeReturn;
    const pack = getCreditPack(packParam);
    if (pack) {
      summaryTitle = formatMsg(c.packTitle, { n: pack.credits });
      summaryCredits = c.packNote;
      summaryPrice = `${currencySymbol}${pack.price}`;
    }
  } else {
    redirect("/app/settings?tab=usage");
  }

  if (!clientSecret) {
    redirect(
      `/app/settings?tab=usage&error=${encodeURIComponent("Couldn't start checkout — try again.")}`,
    );
  }

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-atelier-ink">{c.title}</h1>
          <p className="mt-1 text-sm text-atelier-muted">{c.subtitle}</p>
        </div>
        <Link
          href={backHref}
          className="text-sm text-atelier-muted underline decoration-atelier-rule underline-offset-2 transition-colors hover:text-atelier-ink"
        >
          {c.back}
        </Link>
      </div>

      {summaryTitle && (
        <div className="mb-5 flex items-center justify-between rounded-control bg-atelier-surface p-5 shadow-[0_0_0_1px_var(--frost-ring),0_16px_40px_-24px_rgba(33,29,22,0.12)]">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-atelier-ink">{summaryTitle}</p>
            <p className="mt-0.5 text-xs text-atelier-muted">{summaryCredits}</p>
          </div>
          <div className="text-right">
            <p className="font-numeral text-lg font-semibold tabular-nums text-atelier-ink">
              {summaryPrice}
            </p>
            <p className="mt-0.5 text-[11px] text-atelier-muted">{c.taxNote}</p>
          </div>
        </div>
      )}

      {/* Stripe's iframe manages its own light styling; the wrapper gives it
          the same floating-sheet treatment as the rest of Frost. */}
      <div className="overflow-hidden rounded-media bg-white p-2 shadow-[0_0_0_1px_var(--frost-ring),0_28px_70px_-28px_rgba(33,29,22,0.25)]">
        <CheckoutEmbed clientSecret={clientSecret} publishableKey={publishableKey} />
      </div>

      <p className="mt-4 text-center text-[11px] text-atelier-muted">{c.securedNote}</p>
    </div>
  );
}
