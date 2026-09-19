import { describe, expect, it } from "vitest";
import en from "../i18n/messages/en";
import { buildInvoiceDocument, formatMoney, lineNet } from "./invoice-document";
import {
  TEST_TAX_RATES,
  growthDiscounted,
  growthReverseCharge,
  growthSpain,
  packUnitedStates,
  studioYearly,
  makeInvoice,
} from "./invoice-fixtures";

// What the invoice PDF says (2026-09-19). The document builder is the only
// place an invoice's words are decided, so this is where a wrong tax line or
// a note that isn't true of the invoice would be caught.

const s = en.invoicePdf;
const build = (invoice: Parameters<typeof buildInvoiceDocument>[0]["invoice"], card = { brand: "visa", last4: "4242" }) =>
  buildInvoiceDocument({ invoice, taxRates: TEST_TAX_RATES, card, locale: "en", strings: s });

describe("an invoice with VAT inside the price (Spain, Growth)", () => {
  const doc = build(growthSpain);

  it("names the plan in our words, with its period", () => {
    expect(doc.lines).toHaveLength(1);
    expect(doc.lines[0].title).toBe("Growth plan · monthly");
    expect(doc.lines[0].detail).toMatch(/9 Sept?.*9 Oct 2026/);
  });

  it("shows the line before tax, and Stripe's own totals", () => {
    expect(doc.lines[0].amount).toBe("€65.29");
    expect(doc.lines[0].unitPrice).toBe("€65.29");
    expect(doc.preTotal).toEqual([
      { label: "Tax base", value: "€65.29" },
      { label: "VAT 21%", value: "€13.71" },
    ]);
    expect(doc.total).toEqual({ label: "Total", value: "€79.00" });
    expect(doc.postTotal).toEqual([
      { label: "Paid 9 September 2026", value: "−€79.00" },
      { label: "Amount due", value: "€0.00" },
    ]);
  });

  it("prints both parties with their tax numbers", () => {
    expect(doc.seller.name).toBe("JEAR TECNICA S.A.");
    expect(doc.seller.lines[0]).toBe("NIF A28847549");
    expect(doc.buyer.name).toBe("Estudio Nube S.L.");
    expect(doc.buyer.lines).toEqual(["NIF B12345678", "Calle de Ejemplo 1", "28001 Madrid", "Spain"]);
    expect(doc.buyer.note).toBe("clara@example.com");
  });

  it("says only what is true of it", () => {
    expect(doc.notes).toEqual(["Prices include VAT.", "Paid in full, nothing to do."]);
    expect(doc.meta.map((m) => m.label)).toEqual(["Issued", "Service period", "Payment"]);
    expect(doc.meta[2].lines).toEqual(["Paid 9 September 2026", "Visa •••• 4242"]);
    expect(doc.numberLine).toBe("No. 3F7A2C1D-0004");
    expect(doc.fileName).toBe("Picacho-invoice-3F7A2C1D-0004.pdf");
  });
});

describe("a credit pack sold in dollars outside the EU", () => {
  const doc = build(packUnitedStates, { brand: "mastercard", last4: "5454" });

  it("names the pack and charges no tax, and says why", () => {
    expect(doc.lines[0].title).toBe("20 extra credits");
    expect(doc.lines[0].detail).toBeNull();
    expect(doc.preTotal).toEqual([
      { label: "Tax base", value: "$15.00" },
      { label: "Tax", value: "$0.00" },
    ]);
    expect(doc.total.value).toBe("$15.00");
    expect(doc.notes).toContain("VAT not applicable: service supplied to a customer outside the EU.");
    expect(doc.notes).not.toContain("Prices include VAT.");
    expect(doc.meta.map((m) => m.label)).toEqual(["Issued", "Payment"]);
    expect(doc.buyer.lines).toEqual(["1200 Example Ave", "Austin, TX 78701", "United States"]);
  });
});

describe("an EU business with a VAT number", () => {
  const doc = build(growthReverseCharge);

  it("prints the reverse charge, not a rate, and keeps the price whole", () => {
    expect(doc.preTotal).toEqual([
      { label: "Tax base", value: "€79.00" },
      { label: "VAT · reverse charge", value: "€0.00" },
    ]);
    expect(doc.notes).toContain("Reverse charge: VAT to be accounted for by the recipient.");
    expect(doc.notes).not.toContain("Prices include VAT.");
    expect(doc.notes).not.toContain("VAT not applicable: service supplied to a customer outside the EU.");
    expect(doc.buyer.lines[0]).toBe("VAT FR12345678901");
  });
});

describe("a discounted month", () => {
  const doc = build(growthDiscounted);

  it("nets the discount into the line and says how much it was", () => {
    expect(doc.lines[0].amount).toBe("€52.23");
    expect(doc.lines[0].detail).toContain("Includes €15.80 off");
    expect(doc.preTotal[0]).toEqual({ label: "Tax base", value: "€52.23" });
    expect(doc.total.value).toBe("€63.20");
  });
});

describe("a yearly plan", () => {
  it("is named from the subscription's metadata when its price is built at checkout", () => {
    const doc = build(studioYearly);
    expect(doc.lines[0].title).toBe("Studio plan · yearly");
    expect(doc.total.value).toBe("€3,048.00");
  });
});

describe("a void invoice", () => {
  it("says there is nothing to pay and prints no amount due", () => {
    const invoice = makeInvoice({
      status: "void",
      lines: [{ amount: 1900, price: "price_1U2ZItApOHKJpXjxMWvOYMa1", subscription: true }],
      total: 1900,
      totalExcludingTax: 1900,
      amountPaid: 0,
      amountRemaining: 1900,
      customer: { name: "Clara Ruiz", email: null, country: "ES" },
      planMetadata: "starter",
    });
    const doc = build(invoice);
    expect(doc.meta.find((m) => m.label === "Payment")?.lines).toEqual(["Void — nothing to pay"]);
    expect(doc.postTotal).toEqual([]);
    expect(doc.notes).not.toContain("Paid in full, nothing to do.");
  });
});

describe("the arithmetic helpers", () => {
  it("reads a line's net from Stripe Tax, once, however many taxes it has", () => {
    const line = growthSpain.lines.data[0];
    expect(lineNet(line)).toBe(6529);
    const twoTaxes = { ...line, taxes: [...(line.taxes ?? []), ...(line.taxes ?? [])] };
    expect(lineNet(twoTaxes)).toBe(6529);
    expect(lineNet({ ...line, taxes: null, discount_amounts: [{ amount: 900, discount: "di" }] })).toBe(7000);
  });

  it("formats money in the reader's language", () => {
    expect(formatMoney(7900, "eur", "en")).toBe("€79.00");
    expect(formatMoney(7900, "usd", "en")).toBe("$79.00");
    expect(formatMoney(7900, "eur", "es").replace(/\s/g, " ")).toBe("79,00 €");
    expect(formatMoney(500, "jpy", "en")).toBe("¥500");
  });
});
