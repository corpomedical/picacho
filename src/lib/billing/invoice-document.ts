import type Stripe from "stripe";
import type { Messages } from "../i18n/messages/en";
import type { Locale } from "../i18n/locales";
import { formatMsg } from "../i18n/format";
import { LEGAL_ENTITY } from "../legal-entity";
import { isEUCountry } from "../eu-countries";
import { PLAN_LABELS, type PlanId } from "../plans";
import { planIdForPriceId } from "../stripe/plans";
import { creditsForPriceId } from "../stripe/credit-packs";

// Relative imports on purpose: vitest here does not resolve "@/", and this
// module is tested directly (invoice-document.test.ts).

// The invoice, as a document (2026-09-19, look I "Ledger" on the Settings &
// Invoices canvas). Pure: a finalized Stripe invoice in, every string the PDF
// prints out, already in the account's language. The PDF writer
// (invoice-pdf.ts) only places what this returns.
//
// THE NUMBERS ARE NEVER OURS. Stripe numbered the invoice and Stripe Tax
// computed every tax amount; this reads them and prints them. Where a total
// exists on the invoice (total_excluding_tax, total, amount_paid,
// amount_remaining) it is printed as Stripe has it, never re-added from the
// lines, so a rounding difference between lines can never make our copy
// disagree with Stripe's. Only a line's own net amount is derived — from the
// taxable amount Stripe Tax recorded on it.
//
// What we do write ourselves: the words. Stripe's line descriptions are
// English ("1 × Growth (at €79.00 / month)"); a plan or a credit pack is named
// here from our own price tables, in the reader's language.

export type InvoiceStrings = Messages["invoicePdf"];

export type TaxRateInfo = {
  /** 21 for 21%. Null when the rate could not be read — the row then shows no rate. */
  percentage: number | null;
  /** Stripe's tax_type: "vat", "sales_tax", "gst"… */
  taxType: string | null;
};

export type CardInfo = { brand: string; last4: string };

export type InvoiceDocRow = { label: string; value: string };

export type InvoiceDocLine = {
  title: string;
  detail: string | null;
  quantity: string;
  unitPrice: string;
  amount: string;
};

export type InvoiceDoc = {
  title: string;
  numberLine: string;
  meta: { label: string; lines: string[] }[];
  seller: { label: string; name: string; lines: string[]; note: string };
  buyer: { label: string; name: string; lines: string[]; note: string | null };
  columns: { description: string; quantity: string; unitPrice: string; amount: string };
  lines: InvoiceDocLine[];
  /** Tax base and the tax rows, above the total. */
  preTotal: InvoiceDocRow[];
  total: InvoiceDocRow;
  /** What was paid and what is still due, below the total. */
  postTotal: InvoiceDocRow[];
  notesLabel: string;
  notes: string[];
  questions: string;
  footer: string;
  /** "{n} / {total}" — the writer fills in the page numbers. */
  pageTemplate: string;
  fileName: string;
};

// Dates on an invoice are the issuer's dates: the company is in Madrid.
export const INVOICE_TIME_ZONE = "Europe/Madrid";

// en-GB, not en-US: "9 September 2026" is how a Spanish company's English
// invoice should read, and it is unambiguous for everyone.
const INTL_LOCALE: Record<Locale, string> = { en: "en-GB", es: "es-ES", pt: "pt-BR", it: "it-IT" };

// Stripe amounts are in the currency's minor unit, except these.
const ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

export function formatMoney(
  minor: number,
  currency: string,
  locale: Locale,
  opts: { dropZeroCents?: boolean } = {},
): string {
  const code = currency.toLowerCase();
  const zeroDecimal = ZERO_DECIMAL.has(code);
  const major = zeroDecimal ? minor : minor / 100;
  // A price ("€79 a month") reads without cents; an amount on an invoice never does.
  const whole = opts.dropZeroCents && (zeroDecimal || minor % 100 === 0);
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: "currency",
    currency: code.toUpperCase(),
    // "$79.00", not en-GB's "US$79.00".
    currencyDisplay: "narrowSymbol",
    ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
  }).format(major);
}

export function formatInvoiceDate(unixSeconds: number, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: INVOICE_TIME_ZONE,
  }).format(new Date(unixSeconds * 1000));
}

export function formatPeriod(start: number, end: number, locale: Locale): string {
  const fmt = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: INVOICE_TIME_ZONE,
  });
  return fmt.formatRange(new Date(start * 1000), new Date(end * 1000));
}

function formatPercent(pct: number, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(pct / 100);
}

function priceIdOf(line: Stripe.InvoiceLineItem): string | null {
  const price = line.pricing?.price_details?.price;
  if (!price) return null;
  return typeof price === "string" ? price : price.id;
}

function isProration(line: Stripe.InvoiceLineItem): boolean {
  return (
    line.parent?.subscription_item_details?.proration === true ||
    line.parent?.invoice_item_details?.proration === true
  );
}

function isSubscriptionLine(line: Stripe.InvoiceLineItem): boolean {
  return line.parent?.subscription_item_details != null;
}

// The plan a subscription line bills. Monthly prices are in our table; an
// annual price is built inline at checkout (checkout-core.ts), so its id is
// ad hoc — the plan then comes from the subscription's metadata, which
// Stripe snapshots onto the invoice.
function planOf(line: Stripe.InvoiceLineItem, invoice: Stripe.Invoice): PlanId | null {
  const priceId = priceIdOf(line);
  const fromPrice = priceId ? planIdForPriceId(priceId) : undefined;
  if (fromPrice) return fromPrice;
  if (!isSubscriptionLine(line)) return null;
  const fromMeta = invoice.parent?.subscription_details?.metadata?.plan;
  return fromMeta && fromMeta in PLAN_LABELS && fromMeta !== "none" ? (fromMeta as PlanId) : null;
}

// A year is anything past five weeks: monthly periods run 28–31 days.
function intervalOf(line: Stripe.InvoiceLineItem): "month" | "year" {
  return line.period.end - line.period.start > 35 * 86400 ? "year" : "month";
}

/** What a line bills for, in our terms — shared by the PDF and the Settings list. */
export type InvoiceSubject =
  | { kind: "plan"; plan: PlanId; interval: "month" | "year"; periodStart: number; periodEnd: number; adjustment: boolean }
  | { kind: "pack"; credits: number }
  | { kind: "other"; description: string | null };

export function describeLine(line: Stripe.InvoiceLineItem, invoice: Stripe.Invoice): InvoiceSubject {
  const plan = planOf(line, invoice);
  if (plan) {
    return {
      kind: "plan",
      plan,
      interval: intervalOf(line),
      periodStart: line.period.start,
      periodEnd: line.period.end,
      adjustment: isProration(line),
    };
  }
  const priceId = priceIdOf(line);
  const credits = priceId ? creditsForPriceId(priceId) : null;
  if (credits) return { kind: "pack", credits };
  return { kind: "other", description: line.description?.trim() || null };
}

/**
 * The one thing an invoice is "for", for a one-line list row: the plan it
 * renews (not a change-of-plan adjustment beside it), else the pack, else
 * whatever its first line says.
 */
export function invoiceSubject(invoice: Stripe.Invoice): InvoiceSubject {
  const subjects = (invoice.lines?.data ?? []).map((l) => describeLine(l, invoice));
  return (
    subjects.find((x) => x.kind === "plan" && !x.adjustment) ??
    subjects.find((x) => x.kind === "pack") ??
    subjects.find((x) => x.kind === "plan") ??
    subjects[0] ?? { kind: "other", description: null }
  );
}

function sumDiscounts(line: Stripe.InvoiceLineItem): number {
  return (line.discount_amounts ?? []).reduce((a, d) => a + d.amount, 0);
}

/**
 * The line's amount before tax and after its discounts. Stripe Tax records
 * that as each tax's taxable_amount (the same figure on every tax of a line,
 * so the first one is read, never a sum). A line Stripe Tax never saw has no
 * taxes: its amount less its discounts is then the whole story.
 */
export function lineNet(line: Stripe.InvoiceLineItem): number {
  const taxable = (line.taxes ?? []).find((t) => t.taxable_amount != null)?.taxable_amount;
  if (taxable != null) return taxable;
  return line.amount - sumDiscounts(line);
}

export function taxIdLine(t: { type: string; value: string | null }, s: InvoiceStrings): string | null {
  if (!t.value) return null;
  if (t.type === "es_cif") return formatMsg(s.taxIdEsCif, { id: t.value });
  if (t.type === "eu_vat") return formatMsg(s.taxIdEuVat, { id: t.value });
  return formatMsg(s.taxIdOther, { id: t.value });
}

// "Austin, TX 78701" where that is how the post reads it; "28001 Madrid"
// (postcode first) everywhere else.
const CITY_STATE_POSTAL = new Set(["US", "CA", "AU"]);

function regionName(code: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([INTL_LOCALE[locale]], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function addressLines(address: Stripe.Address | null, locale: Locale): string[] {
  if (!address) return [];
  const statePostal = CITY_STATE_POSTAL.has((address.country ?? "").toUpperCase());
  const cityLine = statePostal
    ? [address.city, [address.state, address.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    : [address.postal_code, address.city].filter(Boolean).join(" ");
  const country = address.country ? regionName(address.country, locale) : null;
  return [address.line1, address.line2, cityLine, statePostal ? null : address.state, country].filter(
    (l): l is string => typeof l === "string" && l.trim().length > 0,
  );
}

const CARD_BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
  cartes_bancaires: "Cartes Bancaires",
  link: "Link",
};

export function cardLabel(card: CardInfo): string {
  const brand = CARD_BRANDS[card.brand] ?? card.brand.charAt(0).toUpperCase() + card.brand.slice(1);
  return `${brand} •••• ${card.last4}`;
}

export function invoiceIssuedAt(invoice: Stripe.Invoice): number {
  return invoice.effective_at ?? invoice.status_transitions?.finalized_at ?? invoice.created;
}

export function buildInvoiceDocument(input: {
  invoice: Stripe.Invoice;
  taxRates: Record<string, TaxRateInfo>;
  card: CardInfo | null;
  locale: Locale;
  strings: InvoiceStrings;
}): InvoiceDoc {
  const { invoice, taxRates, card, locale, strings: s } = input;
  const money = (minor: number) => formatMoney(minor, invoice.currency, locale);
  const number = invoice.number ?? invoice.id;
  const lines = invoice.lines?.data ?? [];

  // ── The lines ──────────────────────────────────────────────────────────
  const docLines: InvoiceDocLine[] = lines.map((line) => {
    const subject = describeLine(line, invoice);
    let title: string;
    let detail: string | null = null;
    if (subject.kind === "plan") {
      title = subject.adjustment
        ? formatMsg(s.adjustmentLine, { plan: PLAN_LABELS[subject.plan] })
        : formatMsg(s.planLine, {
            plan: PLAN_LABELS[subject.plan],
            interval: subject.interval === "year" ? s.intervalYear : s.intervalMonth,
          });
      detail = formatPeriod(subject.periodStart, subject.periodEnd, locale);
    } else if (subject.kind === "pack") {
      title = formatMsg(s.packLine, { n: subject.credits });
    } else {
      title = subject.description ?? "—";
    }
    const discount = sumDiscounts(line);
    if (discount > 0) {
      const off = formatMsg(s.discountDetail, { amount: money(discount) });
      detail = detail ? `${detail} · ${off}` : off;
    }
    const quantity = Math.max(1, line.quantity ?? 1);
    const net = lineNet(line);
    return {
      title,
      detail,
      quantity: String(quantity),
      unitPrice: money(Math.round(net / quantity)),
      amount: money(net),
    };
  });

  // ── Taxes, grouped the way the reader thinks of them: one row per rate ──
  const taxes = invoice.total_taxes ?? [];
  const totalTax = taxes.reduce((a, t) => a + t.amount, 0);
  const groups = new Map<string, { amount: number; reason: string; rateId: string | null }>();
  for (const t of taxes) {
    const rateId = t.tax_rate_details?.tax_rate ?? null;
    const key = `${rateId ?? "none"}|${t.taxability_reason}`;
    const g = groups.get(key) ?? { amount: 0, reason: t.taxability_reason, rateId };
    g.amount += t.amount;
    groups.set(key, g);
  }
  const taxRows: InvoiceDocRow[] = [];
  for (const g of groups.values()) {
    if (g.reason === "reverse_charge") {
      taxRows.push({ label: s.taxReverseCharge, value: money(g.amount) });
      continue;
    }
    const rate = g.rateId ? taxRates[g.rateId] : undefined;
    const pct = rate?.percentage;
    if (g.amount === 0 && (pct == null || pct === 0)) {
      taxRows.push({ label: s.taxNone, value: money(0) });
      continue;
    }
    const rateText = pct != null ? formatPercent(pct, locale) : "";
    const template =
      rate?.taxType === "vat" ? s.taxVat : rate?.taxType === "sales_tax" ? s.taxSales : s.taxGeneric;
    taxRows.push({ label: formatMsg(template, { rate: rateText }).trim(), value: money(g.amount) });
  }
  // Nothing taxed at all still gets its row: "Tax 0.00" says it on purpose.
  if (taxRows.length === 0) taxRows.push({ label: s.taxNone, value: money(0) });
  // Several zero rows (one per jurisdiction Stripe looked at) say nothing more than one.
  const dedupedTaxRows = taxRows.filter(
    (row, i) => !(row.label === s.taxNone && taxRows.findIndex((r) => r.label === s.taxNone) !== i),
  );

  const taxBase = invoice.total_excluding_tax ?? invoice.total - totalTax;
  const paidAt = invoice.status_transitions?.paid_at ?? null;

  const postTotal: InvoiceDocRow[] = [];
  if (invoice.amount_paid > 0) {
    postTotal.push({
      label: formatMsg(s.paidLine, { date: formatInvoiceDate(paidAt ?? invoiceIssuedAt(invoice), locale) }),
      value: `−${money(invoice.amount_paid)}`,
    });
  }
  if (invoice.status !== "void") {
    postTotal.push({ label: s.amountDue, value: money(invoice.amount_remaining) });
  }

  // ── The facts at the top ───────────────────────────────────────────────
  const meta: InvoiceDoc["meta"] = [
    { label: s.issued, lines: [formatInvoiceDate(invoiceIssuedAt(invoice), locale)] },
  ];
  const subLines = lines.filter((l) => isSubscriptionLine(l) && !isProration(l));
  if (subLines.length > 0) {
    const start = Math.min(...subLines.map((l) => l.period.start));
    const end = Math.max(...subLines.map((l) => l.period.end));
    meta.push({ label: s.servicePeriod, lines: [formatPeriod(start, end, locale)] });
  }
  const paymentLines: string[] = [];
  if (invoice.status === "void") {
    paymentLines.push(s.voided);
  } else if (invoice.status === "paid") {
    // paid_at is always set on a paid invoice; the issue date stands in if not.
    paymentLines.push(formatMsg(s.paidOn, { date: formatInvoiceDate(paidAt ?? invoiceIssuedAt(invoice), locale) }));
    if (card) paymentLines.push(cardLabel(card));
  } else if (invoice.due_date) {
    paymentLines.push(formatMsg(s.dueOn, { date: formatInvoiceDate(invoice.due_date, locale) }));
  } else {
    paymentLines.push(s.notPaid);
  }
  meta.push({ label: s.payment, lines: paymentLines });

  // ── Who ────────────────────────────────────────────────────────────────
  const buyerName = invoice.customer_name?.trim() || invoice.customer_email || "—";
  const buyerLines = [
    ...(invoice.customer_tax_ids ?? []).map((t) => taxIdLine(t, s)).filter((l): l is string => l !== null),
    ...addressLines(invoice.customer_address, locale),
  ];

  // ── Notes: only the ones that are true of this invoice ─────────────────
  const notes: string[] = [];
  if (taxes.some((t) => t.tax_behavior === "inclusive" && t.amount > 0)) notes.push(s.notePricesIncludeVat);
  if (taxes.some((t) => t.taxability_reason === "reverse_charge")) notes.push(s.noteReverseCharge);
  const country = invoice.customer_address?.country ?? null;
  if (country && !isEUCountry(country) && totalTax === 0) notes.push(s.noteOutsideEu);
  if (invoice.status === "paid" && invoice.amount_remaining === 0) notes.push(s.notePaidInFull);

  const supportEmail = `${LEGAL_ENTITY.emailUser}@${LEGAL_ENTITY.emailDomain}`;
  const footerParts = [
    LEGAL_ENTITY.name,
    `NIF ${LEGAL_ENTITY.nif}`,
    LEGAL_ENTITY.addressLines.slice(0, 2).join(", "),
    LEGAL_ENTITY.registryLine,
  ].filter((p) => p && p.length > 0);

  return {
    title: s.title,
    numberLine: `${s.numberPrefix} ${number}`,
    meta,
    seller: {
      label: s.from,
      name: LEGAL_ENTITY.name,
      // The street and city as registered; the country in the invoice's
      // language, like the customer's ("España" on a Spanish invoice).
      lines: [
        formatMsg(s.taxIdSeller, { id: LEGAL_ENTITY.nif }),
        ...LEGAL_ENTITY.addressLines.slice(0, 2),
        regionName("ES", locale),
      ],
      note: s.operatorLine,
    },
    buyer: {
      label: s.billedTo,
      name: buyerName,
      lines: buyerLines,
      note: invoice.customer_name?.trim() && invoice.customer_email ? invoice.customer_email : null,
    },
    columns: { description: s.description, quantity: s.quantity, unitPrice: s.unitPrice, amount: s.amount },
    lines: docLines,
    preTotal: [{ label: s.taxBase, value: money(taxBase) }, ...dedupedTaxRows],
    total: { label: s.total, value: money(invoice.total) },
    postTotal,
    notesLabel: s.notes,
    notes,
    questions: formatMsg(s.questions, { email: supportEmail }),
    footer: footerParts.join(" · "),
    pageTemplate: s.page,
    fileName: formatMsg(s.fileName, { number: number.replace(/[^A-Za-z0-9-]/g, "") }),
  };
}
