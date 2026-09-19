import type { ReactNode } from "react";
import type { Messages } from "@/lib/i18n/messages";
import { formatMsg } from "@/lib/i18n/format";
import { cn } from "@/lib/cn";
import { PLAN_LABELS } from "@/lib/plans";
import { addressLines, cardLabel, formatMoney, taxIdLine } from "@/lib/billing/invoice-document";
import type { BillingDetails, CardSummary, InvoiceRow } from "@/lib/billing/stripe-account";
import type { SpendPart } from "@/lib/settings/credit-spend";
import type { Locale } from "@/lib/i18n/locales";
import { SettingsSection } from "@/components/settings/settings-section";
import { PortalButton } from "@/components/settings/hub/portal-button";
import { BUTTON_SECONDARY, DownloadIcon, StatusDot, periodLabel } from "@/components/settings/hub/parts";

// Plan & billing's cards (direction A, 2026-09-19). Presentational: the page
// (and its Stripe-reading wrappers in stripe-parts.tsx) hand them plain data.

const SPEND_SHADES = ["bg-atelier-accent", "bg-atelier-accent/75", "bg-atelier-accent/50", "bg-atelier-accent/30", "bg-atelier-ink/25", "bg-atelier-ink/15"];

export function SpendBreakdown({
  parts,
  sinceLabel,
  h,
}: {
  parts: SpendPart[];
  sinceLabel: string;
  h: Messages["settingsHub"];
}) {
  const total = parts.reduce((a, p) => a + p.credits, 0);
  const name: Record<SpendPart["kind"], string> = {
    videos: h.kindVideos,
    images: h.kindImages,
    helios: h.kindHelios,
    upscales: h.kindUpscales,
    layers: h.kindLayers,
    mystique: h.kindMystique,
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-atelier-ink">
          {total === 1 ? h.whereWentOne : formatMsg(h.whereWent, { n: total })}
        </span>
        <span className="text-xs text-atelier-muted">{sinceLabel}</span>
      </div>
      {total === 0 ? (
        <p className="text-xs text-atelier-muted">{h.nothingSpent}</p>
      ) : (
        <>
          <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-[3px]" aria-hidden>
            {parts.map((p, i) => (
              <div key={p.kind} className={SPEND_SHADES[i] ?? SPEND_SHADES[SPEND_SHADES.length - 1]} style={{ width: `${(p.credits / total) * 100}%` }} />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-atelier-muted">
            {parts.map((p, i) => (
              <li key={p.kind} className="flex items-center gap-1.5">
                <span aria-hidden className={cn("h-2 w-2 rounded-[2px]", SPEND_SHADES[i] ?? SPEND_SHADES[SPEND_SHADES.length - 1])} />
                {name[p.kind]}
                <span className="font-numeral text-sm tabular-nums text-atelier-ink">{p.credits}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export type ReceiptRow = {
  id: string;
  createdAt: string;
  credits: number;
  amountCents: number;
  currency: string;
  refunded: boolean;
  source: "stripe" | "play";
};

function invoiceFor(row: InvoiceRow, locale: Locale, h: Messages["settingsHub"]) {
  const s = row.subject;
  if (s.kind === "plan") {
    return {
      title: formatMsg(h.linePlan, { plan: PLAN_LABELS[s.plan] }),
      detail: periodLabel(s.periodStart, s.periodEnd, locale),
    };
  }
  if (s.kind === "pack") return { title: formatMsg(h.lineExtraCredits, { n: s.credits }), detail: null };
  return { title: s.description ?? "—", detail: null };
}

export function invoiceStatus(row: InvoiceRow, h: Messages["settingsHub"]): { text: string; tone: "good" | "warn" | "off" } {
  if (row.refunded) return { text: h.statusRefunded, tone: "off" };
  switch (row.status) {
    case "paid":
      return { text: h.statusPaid, tone: "good" };
    case "open":
      return { text: h.statusDue, tone: "warn" };
    case "void":
      return { text: h.statusVoid, tone: "off" };
    default:
      return { text: h.statusUnpaid, tone: "warn" };
  }
}

const ROW = "grid grid-cols-[minmax(0,1fr)_auto_44px] items-center gap-x-3 gap-y-0.5 py-3 sm:grid-cols-[92px_128px_minmax(0,1fr)_84px_72px_32px] sm:gap-x-3.5";

export function InvoiceList({
  rows,
  receipts,
  locale,
  h,
  supportEmail,
  hasPlay,
}: {
  rows: InvoiceRow[];
  receipts: ReceiptRow[];
  locale: Locale;
  h: Messages["settingsHub"];
  supportEmail: string;
  hasPlay: boolean;
}) {
  const date = (unix: number) =>
    new Date(unix * 1000).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Madrid" });
  const stripeReceipts = receipts.filter((r) => r.source === "stripe");
  const playReceipts = receipts.filter((r) => r.source === "play");
  const all: { at: number; node: ReactNode }[] = [
    ...rows.map((row) => {
      const { title, detail } = invoiceFor(row, locale, h);
      const status = invoiceStatus(row, h);
      const number = row.number ?? "—";
      return {
        at: row.issuedAt,
        node: (
          <li key={row.id} className={ROW}>
            <span className="hidden text-[13px] text-atelier-muted sm:block">{date(row.issuedAt)}</span>
            <span className="hidden font-mono text-xs text-atelier-ink sm:block">{number}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm text-atelier-ink">{title}</span>
              <span className="block truncate text-xs text-atelier-muted">
                <span className="sm:hidden">{date(row.issuedAt)} · </span>
                {detail ?? <span className="sm:hidden">{number}</span>}
              </span>
            </span>
            <span className="text-right font-numeral text-[15px] tabular-nums text-atelier-ink">
              {formatMoney(row.total, row.currency, locale)}
            </span>
            <span className="hidden items-center gap-1.5 text-xs text-atelier-muted sm:flex">
              <StatusDot tone={status.tone} />
              {status.text}
            </span>
            <a
              href={`/app/settings/invoices/${row.id}`}
              aria-label={formatMsg(h.downloadInvoice, { number })}
              className="flex h-11 w-11 items-center justify-center rounded-control border border-atelier-rule text-atelier-ink transition-colors hover:bg-atelier-ink/5 sm:h-8 sm:w-8"
              download
            >
              <DownloadIcon />
            </a>
          </li>
        ),
      };
    }),
    ...[...stripeReceipts, ...playReceipts].map((r) => ({
      at: Date.parse(r.createdAt) / 1000,
      node: (
        <li key={r.id} className={ROW}>
          <span className="hidden text-[13px] text-atelier-muted sm:block">{date(Date.parse(r.createdAt) / 1000)}</span>
          <span className="hidden text-[12.5px] text-atelier-muted sm:block">{r.source === "play" ? h.viaGooglePlay : h.receiptOnly}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm text-atelier-ink">{formatMsg(h.lineExtraCredits, { n: r.credits })}</span>
            <span className="block truncate text-xs text-atelier-muted sm:hidden">
              {date(Date.parse(r.createdAt) / 1000)} · {r.source === "play" ? h.viaGooglePlay : h.receiptOnly}
            </span>
          </span>
          <span className="text-right font-numeral text-[15px] tabular-nums text-atelier-ink">
            {formatMoney(r.amountCents, r.currency, locale)}
          </span>
          <span className="hidden items-center gap-1.5 text-xs text-atelier-muted sm:flex">
            <StatusDot tone={r.refunded ? "off" : "good"} />
            {r.refunded ? h.statusRefunded : h.statusPaid}
          </span>
          <span />
        </li>
      ),
    })),
  ].sort((a, b) => b.at - a.at);

  return (
    <SettingsSection title={h.invoicesTitle} description={h.invoicesDesc}>
      {all.length === 0 ? (
        <p className="text-sm text-atelier-muted">{h.invoicesEmpty}</p>
      ) : (
        <div className="-my-2">
          <div
            aria-hidden
            className="hidden grid-cols-[92px_128px_minmax(0,1fr)_84px_72px_32px] gap-x-3.5 border-b border-atelier-rule pb-2 pt-1 text-[10.5px] font-medium uppercase tracking-[0.12em] text-atelier-muted sm:grid"
          >
            <span>{h.colDate}</span>
            <span>{h.colNumber}</span>
            <span>{h.colFor}</span>
            <span className="text-right">{h.colAmount}</span>
            <span>{h.colStatus}</span>
            <span />
          </div>
          <ul className="divide-y divide-atelier-rule/60">{all.map((x) => x.node)}</ul>
        </div>
      )}
      {stripeReceipts.length > 0 && (
        <p className="text-xs leading-relaxed text-atelier-muted">{formatMsg(h.receiptNote, { email: supportEmail })}</p>
      )}
      {hasPlay && <p className="text-xs leading-relaxed text-atelier-muted">{h.playNote}</p>}
    </SettingsSection>
  );
}

export function InvoicesUnavailable({ h }: { h: Messages["settingsHub"] }) {
  return (
    <SettingsSection title={h.invoicesTitle} description={h.invoicesDesc}>
      <p className="text-sm text-atelier-muted">{h.invoicesUnavailable}</p>
    </SettingsSection>
  );
}

export function PaymentMethodCard({
  card,
  h,
  editable,
}: {
  card: CardSummary | null;
  h: Messages["settingsHub"];
  editable: boolean;
}) {
  return (
    <SettingsSection title={h.paymentMethodTitle}>
      {card ? (
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-[26px] w-10 items-center justify-center rounded-[4px] border border-atelier-rule text-[9.5px] font-medium uppercase tracking-[0.08em] text-atelier-ink"
          >
            {card.brand.slice(0, 4)}
          </span>
          <div className="min-w-0">
            <p className="text-sm text-atelier-ink">{cardLabel(card)}</p>
            <p className="text-xs text-atelier-muted">
              {formatMsg(h.cardExpires, { date: `${String(card.expMonth).padStart(2, "0")}/${card.expYear}` })}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-atelier-muted">{h.noCard}</p>
      )}
      {editable && (
        <PortalButton flow="payment_method" className={BUTTON_SECONDARY}>
          {h.updateCard}
        </PortalButton>
      )}
    </SettingsSection>
  );
}

export function BillingDetailsCard({
  details,
  h,
  p,
  locale,
  editable,
}: {
  details: BillingDetails | null;
  h: Messages["settingsHub"];
  /** The invoice's own words for tax numbers, so the card reads like the invoice. */
  p: Messages["invoicePdf"];
  locale: Locale;
  editable: boolean;
}) {
  const lines = details
    ? [
        ...details.taxIds.map((t) => taxIdLine(t, p)).filter((l): l is string => l !== null),
        ...addressLines(details.address, locale),
      ]
    : [];
  return (
    <SettingsSection title={h.billingDetailsTitle} description={h.billingDetailsDesc}>
      {details && (details.name || lines.length > 0) ? (
        <div className="text-[13.5px] leading-relaxed">
          {details.name && <p className="font-medium text-atelier-ink">{details.name}</p>}
          {lines.map((l) => (
            <p key={l} className="text-atelier-muted">
              {l}
            </p>
          ))}
          {details.email && <p className="text-atelier-muted">{formatMsg(h.sentTo, { email: details.email })}</p>}
        </div>
      ) : (
        <p className="text-sm text-atelier-muted">{h.detailsEmpty}</p>
      )}
      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <PortalButton className={BUTTON_SECONDARY}>{h.editDetails}</PortalButton>
          <span className="text-xs text-atelier-muted">{h.changesFromNext}</span>
        </div>
      )}
    </SettingsSection>
  );
}
