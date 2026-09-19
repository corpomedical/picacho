import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import {
  invoiceIssuedAt,
  invoiceSubject,
  type CardInfo,
  type InvoiceSubject,
  type TaxRateInfo,
} from "@/lib/billing/invoice-document";

// What Settings → Plan & billing reads from Stripe (2026-09-19). Every call
// here is a READ, and every one is made with the account's own customer or
// subscription id, taken from its profile row — never from a request.
//
// Each function returns null instead of throwing: a Stripe hiccup costs the
// person one card on the page, not the page. The callers say so in words
// (invoicesUnavailable) rather than showing an empty list, which would read
// as "you have no invoices".

export type CardSummary = CardInfo & { expMonth: number; expYear: number };

export type SubscriptionSummary = {
  status: Stripe.Subscription.Status;
  /** Minor units, before any discount; null for a metered or odd price. */
  amount: number | null;
  currency: string;
  interval: "month" | "year" | null;
  periodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
  card: CardSummary | null;
};

export type BillingDetails = {
  name: string | null;
  email: string | null;
  address: Stripe.Address | null;
  taxIds: { type: string; value: string }[];
};

export type InvoiceRow = {
  id: string;
  number: string | null;
  issuedAt: number;
  subject: InvoiceSubject;
  total: number;
  currency: string;
  status: "paid" | "open" | "void" | "uncollectible";
  /** A credit note covers the whole invoice. */
  refunded: boolean;
};

function cardOf(pm: string | Stripe.PaymentMethod | null | undefined): CardSummary | null {
  if (!pm || typeof pm === "string" || !pm.card) return null;
  return { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
}

export async function getSubscriptionSummary(subscriptionId: string): Promise<SubscriptionSummary | null> {
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["default_payment_method"] });
    const item = sub.items.data[0];
    const recurring = item?.price.recurring?.interval;
    return {
      status: sub.status,
      amount: item?.price.unit_amount ?? null,
      currency: item?.price.currency ?? sub.currency,
      interval: recurring === "month" ? "month" : recurring === "year" ? "year" : null,
      periodEnd: item?.current_period_end ?? null,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      cancelAt: sub.cancel_at,
      card: cardOf(sub.default_payment_method),
    };
  } catch (err) {
    console.error("billing: subscription read failed", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function getCustomerBilling(
  customerId: string,
): Promise<{ details: BillingDetails; card: CardSummary | null } | null> {
  try {
    const customer = await stripe.customers.retrieve(customerId, {
      expand: ["invoice_settings.default_payment_method", "tax_ids"],
    });
    if (customer.deleted) return null;
    let card = cardOf(customer.invoice_settings?.default_payment_method as Stripe.PaymentMethod | string | null);
    if (!card) {
      // A card saved by Checkout sits on the customer without being made its
      // default; the newest one is the one they last paid with.
      const methods = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
      card = cardOf(methods.data[0]);
    }
    return {
      details: {
        name: customer.name ?? null,
        email: customer.email ?? null,
        address: customer.address ?? null,
        taxIds: (customer.tax_ids?.data ?? []).map((t) => ({ type: t.type, value: t.value })),
      },
      card,
    };
  } catch (err) {
    console.error("billing: customer read failed", err instanceof Error ? err.message : err);
    return null;
  }
}

/** The account's invoices, newest first. Drafts are Stripe's business, not the customer's. */
export async function listInvoiceRows(customerId: string, limit = 24): Promise<InvoiceRow[] | null> {
  try {
    const list = await stripe.invoices.list({ customer: customerId, limit });
    return list.data
      .filter((inv) => inv.status === "paid" || inv.status === "open" || inv.status === "void" || inv.status === "uncollectible")
      .map((inv) => ({
        id: inv.id,
        number: inv.number,
        issuedAt: invoiceIssuedAt(inv),
        subject: invoiceSubject(inv),
        total: inv.total,
        currency: inv.currency,
        status: inv.status as InvoiceRow["status"],
        refunded: inv.total > 0 && (inv.post_payment_credit_notes_amount ?? 0) >= inv.total,
      }));
  } catch (err) {
    console.error("billing: invoice list failed", err instanceof Error ? err.message : err);
    return null;
  }
}

const INVOICE_ID = /^in_[A-Za-z0-9]{8,64}$/;

/**
 * One invoice, only if it belongs to this customer and has been finalized.
 * The ownership check is the whole security of the PDF route: an invoice id
 * is not a secret the way a session is.
 */
export async function getOwnedInvoice(customerId: string, invoiceId: string): Promise<Stripe.Invoice | null> {
  if (!INVOICE_ID.test(invoiceId)) return null;
  try {
    const invoice = await stripe.invoices.retrieve(invoiceId);
    const owner = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    if (owner !== customerId) return null;
    if (invoice.status === "draft" || invoice.status == null) return null;
    return invoice;
  } catch (err) {
    const code = (err as { statusCode?: number }).statusCode;
    if (code !== 404) console.error("billing: invoice read failed", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * The card that paid an invoice, when Stripe can say. Its own call, after the
 * ownership check, so a lookup that fails only leaves the card off the PDF.
 */
export async function cardThatPaid(invoice: Stripe.Invoice): Promise<CardInfo | null> {
  if (invoice.status !== "paid") return null;
  try {
    const payments = await stripe.invoicePayments.list({
      invoice: invoice.id,
      limit: 5,
      expand: ["data.payment.payment_intent.payment_method"],
    });
    for (const p of payments.data) {
      if (p.status !== "paid") continue;
      const intent = p.payment.payment_intent;
      if (!intent || typeof intent === "string") continue;
      const card = cardOf(intent.payment_method as Stripe.PaymentMethod | string | null);
      if (card) return { brand: card.brand, last4: card.last4 };
    }
  } catch (err) {
    console.error("billing: invoice payment read failed", err instanceof Error ? err.message : err);
  }
  return null;
}

/** Percentage and kind of each tax rate the invoice charged. Unreadable rates print without a number. */
export async function taxRatesFor(invoice: Stripe.Invoice): Promise<Record<string, TaxRateInfo>> {
  const ids = new Set<string>();
  for (const t of invoice.total_taxes ?? []) {
    const id = t.tax_rate_details?.tax_rate;
    if (id) ids.add(id);
  }
  const out: Record<string, TaxRateInfo> = {};
  await Promise.all(
    [...ids].map(async (id) => {
      try {
        const rate = await stripe.taxRates.retrieve(id);
        out[id] = { percentage: rate.effective_percentage ?? rate.percentage, taxType: rate.tax_type ?? null };
      } catch {
        out[id] = { percentage: null, taxType: null };
      }
    }),
  );
  return out;
}
