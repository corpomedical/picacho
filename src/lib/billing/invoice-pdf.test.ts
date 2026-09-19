import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../i18n/messages/en";
import { buildInvoiceDocument } from "./invoice-document";
import { renderInvoicePdf } from "./invoice-pdf";
import {
  TEST_TAX_RATES,
  growthDiscounted,
  growthReverseCharge,
  growthSpain,
  packUnitedStates,
  studioYearly,
} from "./invoice-fixtures";

// The PDF writer runs end to end: real fonts, real logo, a real file.
// INVOICE_PDF_OUT=<dir> also writes each proof to disk to be looked at —
// the way this layout was checked against the canvas board.

const cases = {
  "growth-spain": growthSpain,
  "pack-united-states": packUnitedStates,
  "growth-reverse-charge": growthReverseCharge,
  "growth-discounted": growthDiscounted,
  "studio-yearly": studioYearly,
};

describe("the invoice PDF", () => {
  for (const [name, invoice] of Object.entries(cases)) {
    it(`renders ${name}`, async () => {
      const doc = buildInvoiceDocument({
        invoice,
        taxRates: TEST_TAX_RATES,
        card: { brand: "visa", last4: "4242" },
        locale: "en",
        strings: en.invoicePdf,
      });
      const bytes = await renderInvoicePdf(doc);
      expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
      expect(bytes.length).toBeGreaterThan(20_000);
      const out = process.env.INVOICE_PDF_OUT;
      if (out) {
        await mkdir(out, { recursive: true });
        await writeFile(path.join(out, `${name}.pdf`), bytes);
      }
    });
  }
});
