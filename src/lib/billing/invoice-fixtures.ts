import type Stripe from "stripe";

// Invoices shaped like Stripe's (API 2026-07-29.dahlia), for the invoice
// tests and the PDF proof renders. Only the fields the document builder
// reads are filled in; the rest of Stripe's object is irrelevant to it.
// Amounts follow Stripe Tax's own arithmetic for each case.

const SEP_9 = Date.UTC(2026, 8, 9, 7, 12) / 1000;
const OCT_9 = Date.UTC(2026, 9, 9, 7, 12) / 1000;
const AUG_28 = Date.UTC(2026, 7, 28, 16, 40) / 1000;

type LineInput = {
  amount: number;
  price: string;
  period?: { start: number; end: number };
  subscription?: boolean;
  proration?: boolean;
  discount?: number;
  taxes?: { amount: number; taxable: number; behavior: "inclusive" | "exclusive"; reason: string; rate: string | null }[];
  description?: string;
};

function line(input: LineInput, i: number): Stripe.InvoiceLineItem {
  const period = input.period ?? { start: SEP_9, end: SEP_9 };
  return {
    id: `il_test_${i}`,
    object: "line_item",
    amount: input.amount,
    currency: "eur",
    description: input.description ?? null,
    discount_amounts: input.discount ? [{ amount: input.discount, discount: "di_test" }] : [],
    discountable: true,
    discounts: [],
    invoice: "in_test",
    livemode: false,
    metadata: {},
    parent: input.subscription
      ? {
          type: "subscription_item_details",
          invoice_item_details: null,
          subscription_item_details: {
            invoice_item: null,
            proration: input.proration ?? false,
            proration_details: null,
            subscription: "sub_test",
            subscription_item: "si_test",
          },
        }
      : {
          type: "invoice_item_details",
          subscription_item_details: null,
          invoice_item_details: {
            invoice_item: "ii_test",
            proration: false,
            proration_details: null,
            subscription: null,
          },
        },
    period,
    pretax_credit_amounts: null,
    pricing: {
      type: "price_details",
      price_details: { price: input.price, product: "prod_test" },
      unit_amount_decimal: String(input.amount),
    },
    quantity: 1,
    quantity_decimal: null,
    subscription: input.subscription ? "sub_test" : null,
    subtotal: input.amount,
    taxes: (input.taxes ?? []).map((t) => ({
      amount: t.amount,
      tax_behavior: t.behavior,
      tax_rate_details: t.rate ? { tax_rate: t.rate } : null,
      taxability_reason: t.reason,
      taxable_amount: t.taxable,
      type: "tax_rate_details",
    })),
  } as unknown as Stripe.InvoiceLineItem;
}

export function makeInvoice(o: {
  number?: string;
  currency?: string;
  status?: Stripe.Invoice.Status;
  created?: number;
  lines: LineInput[];
  total: number;
  totalExcludingTax: number;
  totalTaxes?: LineInput["taxes"];
  amountPaid: number;
  amountRemaining: number;
  customer: {
    name: string | null;
    email: string | null;
    country: string;
    line1?: string;
    postal?: string;
    city?: string;
    state?: string | null;
    taxIds?: { type: string; value: string }[];
  };
  planMetadata?: string | null;
}): Stripe.Invoice {
  const created = o.created ?? SEP_9;
  return {
    id: "in_test",
    object: "invoice",
    number: o.number ?? "3F7A2C1D-0004",
    currency: o.currency ?? "eur",
    status: o.status ?? "paid",
    created,
    effective_at: created,
    due_date: null,
    status_transitions: {
      finalized_at: created,
      paid_at: (o.status ?? "paid") === "paid" ? created + 5 : null,
      voided_at: o.status === "void" ? created + 60 : null,
      marked_uncollectible_at: null,
    },
    customer: "cus_test",
    customer_name: o.customer.name,
    customer_email: o.customer.email,
    customer_address: {
      line1: o.customer.line1 ?? null,
      line2: null,
      postal_code: o.customer.postal ?? null,
      city: o.customer.city ?? null,
      state: o.customer.state ?? null,
      country: o.customer.country,
    },
    customer_tax_ids: o.customer.taxIds ?? [],
    lines: {
      object: "list",
      data: o.lines.map((l, i) => ({ ...line(l, i), currency: o.currency ?? "eur" })),
      has_more: false,
      url: "/v1/invoices/in_test/lines",
    },
    total: o.total,
    total_excluding_tax: o.totalExcludingTax,
    subtotal: o.total,
    subtotal_excluding_tax: o.totalExcludingTax,
    total_taxes: (o.totalTaxes ?? []).map((t) => ({
      amount: t.amount,
      tax_behavior: t.behavior,
      tax_rate_details: t.rate ? { tax_rate: t.rate } : null,
      taxability_reason: t.reason,
      taxable_amount: t.taxable,
      type: "tax_rate_details",
    })),
    amount_paid: o.amountPaid,
    amount_remaining: o.amountRemaining,
    amount_due: o.amountRemaining,
    parent:
      o.planMetadata !== undefined
        ? {
            type: "subscription_details",
            quote_details: null,
            subscription_details: { metadata: o.planMetadata ? { plan: o.planMetadata } : {}, subscription: "sub_test" },
          }
        : null,
  } as unknown as Stripe.Invoice;
}

/** A Growth month for a Spanish company: €79.00 with 21% VAT inside it. */
export const growthSpain = makeInvoice({
  lines: [
    {
      amount: 7900,
      price: "price_1U2ZIuApOHKJpXjxnwr2dakn",
      period: { start: SEP_9, end: OCT_9 },
      subscription: true,
      taxes: [{ amount: 1371, taxable: 6529, behavior: "inclusive", reason: "standard_rated", rate: "txr_es_vat" }],
    },
  ],
  total: 7900,
  totalExcludingTax: 6529,
  totalTaxes: [{ amount: 1371, taxable: 6529, behavior: "inclusive", reason: "standard_rated", rate: "txr_es_vat" }],
  amountPaid: 7900,
  amountRemaining: 0,
  customer: {
    name: "Estudio Nube S.L.",
    email: "clara@example.com",
    country: "ES",
    line1: "Calle de Ejemplo 1",
    postal: "28001",
    city: "Madrid",
    taxIds: [{ type: "es_cif", value: "B12345678" }],
  },
  planMetadata: "growth",
});

/** Twenty extra credits for a customer in the US: dollars, nothing collected. */
export const packUnitedStates = makeInvoice({
  number: "9B1E77C0-0002",
  currency: "usd",
  created: AUG_28,
  lines: [
    {
      amount: 1500,
      price: "price_1U5zclApOHKJpXjx56fAsnOs",
      taxes: [{ amount: 0, taxable: 1500, behavior: "exclusive", reason: "not_collecting", rate: null }],
    },
  ],
  total: 1500,
  totalExcludingTax: 1500,
  totalTaxes: [{ amount: 0, taxable: 1500, behavior: "exclusive", reason: "not_collecting", rate: null }],
  amountPaid: 1500,
  amountRemaining: 0,
  customer: { name: "Jordan Lee", email: "jordan@example.com", country: "US", line1: "1200 Example Ave", postal: "78701", city: "Austin", state: "TX" },
});

/** A French business with a VAT number: reverse charge, the price stays the price. */
export const growthReverseCharge = makeInvoice({
  number: "5C0FFEE1-0001",
  lines: [
    {
      amount: 7900,
      price: "price_1U2ZIuApOHKJpXjxnwr2dakn",
      period: { start: SEP_9, end: OCT_9 },
      subscription: true,
      taxes: [{ amount: 0, taxable: 7900, behavior: "inclusive", reason: "reverse_charge", rate: "txr_fr_rc" }],
    },
  ],
  total: 7900,
  totalExcludingTax: 7900,
  totalTaxes: [{ amount: 0, taxable: 7900, behavior: "inclusive", reason: "reverse_charge", rate: "txr_fr_rc" }],
  amountPaid: 7900,
  amountRemaining: 0,
  customer: {
    name: "Atelier Lune SAS",
    email: "compta@example.fr",
    country: "FR",
    line1: "12 rue de l'Exemple",
    postal: "75011",
    city: "Paris",
    taxIds: [{ type: "eu_vat", value: "FR12345678901" }],
  },
  planMetadata: "growth",
});

/** A promotion code at 20% off a Growth month, VAT still inside the price. */
export const growthDiscounted = makeInvoice({
  number: "3F7A2C1D-0005",
  lines: [
    {
      amount: 7900,
      price: "price_1U2ZIuApOHKJpXjxnwr2dakn",
      period: { start: SEP_9, end: OCT_9 },
      subscription: true,
      discount: 1580,
      taxes: [{ amount: 1097, taxable: 5223, behavior: "inclusive", reason: "standard_rated", rate: "txr_es_vat" }],
    },
  ],
  total: 6320,
  totalExcludingTax: 5223,
  totalTaxes: [{ amount: 1097, taxable: 5223, behavior: "inclusive", reason: "standard_rated", rate: "txr_es_vat" }],
  amountPaid: 6320,
  amountRemaining: 0,
  customer: { name: "Clara Ruiz", email: "clara@example.com", country: "ES", postal: "28001", city: "Madrid" },
  planMetadata: "growth",
});

/** A yearly Studio plan: its price is built at checkout, so only the metadata names it. */
export const studioYearly = makeInvoice({
  number: "3F7A2C1D-0006",
  lines: [
    {
      amount: 304800,
      price: "price_adhoc_annual_studio",
      period: { start: SEP_9, end: SEP_9 + 365 * 86400 },
      subscription: true,
      taxes: [{ amount: 52899, taxable: 251901, behavior: "inclusive", reason: "standard_rated", rate: "txr_es_vat" }],
    },
  ],
  total: 304800,
  totalExcludingTax: 251901,
  totalTaxes: [{ amount: 52899, taxable: 251901, behavior: "inclusive", reason: "standard_rated", rate: "txr_es_vat" }],
  amountPaid: 304800,
  amountRemaining: 0,
  customer: { name: "Clara Ruiz", email: "clara@example.com", country: "ES" },
  planMetadata: "studio",
});

export const TEST_TAX_RATES = {
  txr_es_vat: { percentage: 21, taxType: "vat" },
  txr_fr_rc: { percentage: 0, taxType: "vat" },
};
