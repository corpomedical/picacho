import Link from "next/link";
import type { Messages } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locales";
import { formatMsg } from "@/lib/i18n/format";
import { cn } from "@/lib/cn";
import { PLAN_LABELS } from "@/lib/plans";
import { PRICING_TIERS } from "@/lib/pricing";
import { cardLabel, formatMoney } from "@/lib/billing/invoice-document";
import {
  getCustomerBilling,
  getSubscriptionSummary,
  listInvoiceRows,
  type InvoiceRow,
  type SubscriptionSummary,
} from "@/lib/billing/stripe-account";
import { settingsHref } from "@/lib/settings/tabs";
import { SettingsSection } from "@/components/settings/settings-section";
import {
  BillingDetailsCard,
  invoiceStatus,
  InvoiceList,
  InvoicesUnavailable,
  PaymentMethodCard,
  type ReceiptRow,
} from "@/components/settings/hub/billing";
import { PortalButton } from "@/components/settings/hub/portal-button";
import { CARD, DownloadIcon, FactRow, StatusDot, periodLabel } from "@/components/settings/hub/parts";

// The parts of Settings that read Stripe (2026-09-19). Each is an async
// server component the page wraps in <Suspense>, so the rest of the page
// never waits on a Stripe round trip, and a Stripe failure costs one card.

function longDate(unix: number, locale: Locale) {
  return new Date(unix * 1000).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Madrid",
  });
}

/**
 * "€79 a month · renews 9 October" — the line under the plan's name, from
 * the subscription itself. It is what says "ends" instead of "renews" once
 * someone has cancelled, which the profile row cannot know.
 */
export function planLineText(sub: SubscriptionSummary, locale: Locale, h: Messages["settingsHub"]): string {
  const parts: string[] = [];
  if (sub.amount !== null && sub.interval) {
    const price = formatMoney(sub.amount, sub.currency, locale, { dropZeroCents: true });
    parts.push(formatMsg(sub.interval === "year" ? h.planPriceYear : h.planPriceMonth, { price }));
  }
  const endsAt = sub.cancelAtPeriodEnd ? sub.periodEnd : sub.cancelAt;
  if (endsAt) parts.push(formatMsg(h.planEnds, { date: longDate(endsAt, locale) }));
  else if (sub.periodEnd && (sub.status === "active" || sub.status === "trialing"))
    parts.push(formatMsg(h.planRenews, { date: longDate(sub.periodEnd, locale) }));
  return parts.join(" · ");
}

export async function PlanStripeLine({
  subscriptionId,
  locale,
  h,
}: {
  subscriptionId: string;
  locale: Locale;
  h: Messages["settingsHub"];
}) {
  const sub = await getSubscriptionSummary(subscriptionId);
  return sub ? <>{planLineText(sub, locale, h)}</> : null;
}

/** Plan & billing's plan card body: price, the next payment or the end, and yearly. */
export async function PlanFacts({
  subscriptionId,
  locale,
  h,
  nativeApp,
}: {
  subscriptionId: string;
  locale: Locale;
  h: Messages["settingsHub"];
  nativeApp: boolean;
}) {
  const sub = await getSubscriptionSummary(subscriptionId);
  return sub ? <PlanFactsView sub={sub} locale={locale} h={h} nativeApp={nativeApp} /> : null;
}

export function PlanFactsView({
  sub,
  locale,
  h,
  nativeApp,
}: {
  sub: SubscriptionSummary;
  locale: Locale;
  h: Messages["settingsHub"];
  nativeApp: boolean;
}) {
  const rows: { label: string; value: React.ReactNode }[] = [];
  if (sub.amount !== null && sub.interval) {
    const price = formatMsg(sub.interval === "year" ? h.planPriceYear : h.planPriceMonth, {
      price: formatMoney(sub.amount, sub.currency, locale, { dropZeroCents: true }),
    });
    // Euro prices include VAT (Stripe Tax, tax behaviour inferred by currency).
    rows.push({ label: h.rowPrice, value: sub.currency === "eur" ? formatMsg(h.priceVatIncluded, { price }) : price });
  }
  const endsAt = sub.cancelAtPeriodEnd ? sub.periodEnd : sub.cancelAt;
  if (endsAt) {
    rows.push({ label: h.rowEnds, value: formatMsg(h.endsValue, { date: longDate(endsAt, locale) }) });
  } else if (sub.periodEnd && sub.amount !== null) {
    const card = sub.card ? ` · ${cardLabel(sub.card)}` : "";
    rows.push({
      label: h.rowNextPayment,
      value: `${formatMsg(h.nextPaymentValue, {
        amount: formatMoney(sub.amount, sub.currency, locale),
        date: longDate(sub.periodEnd, locale),
      })}${card}`,
    });
  }
  // Only the monthly plans have a yearly price to offer, and only outside the store apps.
  if (!nativeApp && sub.interval === "month" && !endsAt) {
    // Euro and dollar prices are the same numbers (checkout-core.ts), so the
    // tier is the one whose monthly price this subscription pays. A price
    // from before a repricing matches none, and then no yearly offer is made.
    const tier = PRICING_TIERS.find((t) => t.price * 100 === sub.amount);
    if (tier) {
      rows.push({
        label: h.rowPayYearly,
        value: (
          <>
            {formatMsg(h.payYearlyValue, {
              monthly: formatMoney(tier.annualPrice * 100, sub.currency, locale, { dropZeroCents: true }),
              total: formatMoney(tier.annualPrice * 12 * 100, sub.currency, locale, { dropZeroCents: true }),
            })}
            {" · "}
            <PortalButton inline className="text-atelier-ink underline underline-offset-2 hover:text-atelier-accent">
              {h.switchLink}
            </PortalButton>
          </>
        ),
      });
    }
  }
  if (rows.length === 0) return null;
  return (
    <div className="-my-2.5">
      {rows.map((r, i) => (
        <FactRow key={r.label} label={r.label} last={i === rows.length - 1}>
          {r.value}
        </FactRow>
      ))}
    </div>
  );
}

export async function LatestInvoiceCard({
  customerId,
  locale,
  h,
}: {
  customerId: string;
  locale: Locale;
  h: Messages["settingsHub"];
}) {
  const rows = await listInvoiceRows(customerId, 3);
  const latest = rows?.[0];
  return latest ? <LatestInvoiceView latest={latest} locale={locale} h={h} /> : null;
}

export function LatestInvoiceView({
  latest,
  locale,
  h,
}: {
  latest: InvoiceRow;
  locale: Locale;
  h: Messages["settingsHub"];
}) {
  const s = latest.subject;
  const title =
    s.kind === "plan"
      ? formatMsg(h.linePlan, { plan: PLAN_LABELS[s.plan] })
      : s.kind === "pack"
        ? formatMsg(h.lineExtraCredits, { n: s.credits })
        : (s.description ?? "—");
  const detail = s.kind === "plan" ? periodLabel(s.periodStart, s.periodEnd, locale) : null;
  const status = invoiceStatus(latest, h);
  return (
    <section className={cn(CARD, "overflow-hidden")}>
      <header className="flex items-baseline justify-between gap-3 px-5 pb-3 pt-4 sm:px-6 sm:pt-5">
        <h2 className="font-numeral text-[15px] font-semibold leading-tight text-atelier-ink">{h.latestInvoice}</h2>
        <Link href={settingsHref("billing")} className="text-[13px] text-atelier-muted hover:text-atelier-ink">
          {h.allInvoices} ›
        </Link>
      </header>
      <div className="flex items-center gap-3 border-t border-atelier-rule/60 px-5 py-3.5 sm:gap-4 sm:px-6">
        <span className="hidden w-24 flex-shrink-0 text-[13px] text-atelier-muted sm:block">
          {new Date(latest.issuedAt * 1000).toLocaleDateString(locale, {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "Europe/Madrid",
          })}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-atelier-ink">{title}</span>
          {detail && <span className="block truncate text-xs text-atelier-muted">{detail}</span>}
        </span>
        <span className="font-numeral text-[15px] tabular-nums text-atelier-ink">{formatMoney(latest.total, latest.currency, locale)}</span>
        <span className="hidden items-center gap-1.5 text-xs text-atelier-muted sm:flex">
          <StatusDot tone={status.tone} />
          {status.text}
        </span>
        <a
          href={`/app/settings/invoices/${latest.id}`}
          download
          aria-label={formatMsg(h.downloadInvoice, { number: latest.number ?? "" })}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control border border-atelier-rule text-atelier-ink transition-colors hover:bg-atelier-ink/5 sm:h-8 sm:w-8"
        >
          <DownloadIcon />
        </a>
      </div>
    </section>
  );
}

export async function InvoicesCard({
  customerId,
  receipts,
  locale,
  h,
  supportEmail,
}: {
  customerId: string | null;
  receipts: ReceiptRow[];
  locale: Locale;
  h: Messages["settingsHub"];
  supportEmail: string;
}) {
  const rows = customerId ? await listInvoiceRows(customerId) : [];
  if (rows === null) return <InvoicesUnavailable h={h} />;
  return (
    <InvoiceList
      rows={rows}
      receipts={receipts}
      locale={locale}
      h={h}
      supportEmail={supportEmail}
      hasPlay={receipts.some((r) => r.source === "play")}
    />
  );
}

export async function CustomerCards({
  customerId,
  t,
  locale,
  editable,
}: {
  customerId: string;
  t: Messages;
  locale: Locale;
  editable: boolean;
}) {
  const billing = await getCustomerBilling(customerId);
  return <CustomerCardsView billing={billing} t={t} locale={locale} editable={editable} />;
}

export function CustomerCardsView({
  billing,
  t,
  locale,
  editable,
}: {
  billing: Awaited<ReturnType<typeof getCustomerBilling>>;
  t: Messages;
  locale: Locale;
  editable: boolean;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <PaymentMethodCard card={billing?.card ?? null} h={t.settingsHub} editable={editable} />
      <BillingDetailsCard
        details={billing?.details ?? null}
        h={t.settingsHub}
        p={t.invoicePdf}
        locale={locale}
        editable={editable}
      />
    </div>
  );
}

/** Shown while a Stripe card is on its way: the card's frame, quietly. */
export function StripeCardSkeleton({ title, rows = 2 }: { title: string; rows?: number }) {
  return (
    <SettingsSection title={title}>
      <div className="space-y-2.5" aria-hidden>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-atelier-ink/[0.06]" style={{ width: `${80 - i * 18}%` }} />
        ))}
      </div>
    </SettingsSection>
  );
}

export function PlanLineSkeleton() {
  return <span className="inline-block h-3.5 w-44 animate-pulse rounded bg-atelier-ink/[0.06] align-middle" aria-hidden />;
}

