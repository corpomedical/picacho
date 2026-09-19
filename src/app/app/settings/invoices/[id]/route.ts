import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerMessages } from "@/lib/i18n/server";
import { rateLimited } from "@/lib/rate-limit";
import { buildInvoiceDocument } from "@/lib/billing/invoice-document";
import { renderInvoicePdf } from "@/lib/billing/invoice-pdf";
import { cardThatPaid, getOwnedInvoice, taxRatesFor } from "@/lib/billing/stripe-account";

// GET /app/settings/invoices/<Stripe invoice id> — the invoice as our PDF
// (look I "Ledger", 2026-09-19), in the account's language.
//
// Only the account's own invoices: the invoice's Stripe customer must be the
// customer on the signed-in profile (getOwnedInvoice), and anything else —
// someone else's invoice, a draft, a malformed id — is the same 404, so the
// route never confirms that an id exists.
//
// Node runtime: the writer reads its font files from disk.
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Sign in to download invoices." }, { status: 401 });
  // The same two-step rule as every /app page (app/app/layout.tsx): a route
  // handler never passes through that layout, so it asks for itself.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    return NextResponse.json({ error: "Finish signing in first." }, { status: 401 });
  }

  // A PDF is cheap, but the Stripe reads behind it are not free to hammer.
  if (await rateLimited(data.user.id, "invoice-pdf", 60, 30)) {
    return NextResponse.json({ error: "Too many downloads at once — try again in a minute." }, { status: 429 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", data.user.id)
    .single();
  const customerId = profile?.stripe_customer_id as string | null | undefined;
  if (!customerId) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const invoice = await getOwnedInvoice(customerId, id);
  if (!invoice) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { locale, t } = await getServerMessages();
  const [taxRates, card] = await Promise.all([taxRatesFor(invoice), cardThatPaid(invoice)]);
  const doc = buildInvoiceDocument({ invoice, taxRates, card, locale, strings: t.invoicePdf });
  const bytes = await renderInvoicePdf(doc);

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${doc.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
