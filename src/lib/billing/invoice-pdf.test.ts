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

// Every render embeds seven real fonts and the 1942 × 595 logo, which
// pdf-lib decodes, splits from its alpha and deflates again for each
// document: 0.1–0.5 s a render alone, but up to 5.7 s when three full
// suites run at once, as other sessions' do on this machine (measured
// 2026-09-22). That time is the machine's, not the layout's, so the block
// has room for it rather than vitest's 5 s.
describe("the invoice PDF", { timeout: 60_000 }, () => {
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
