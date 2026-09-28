import { requireAdmin } from "@/lib/admin/require-admin";
import { csvCell, logAdminAction } from "@/lib/admin/audit";
import { loadPayments } from "@/lib/admin/payments";

// Admin → Payments → Export CSV (2026-09-28 admin redesign): the last 100
// Stripe charges and recent disputes as one spreadsheet. requireAdmin is the
// gate (routes sit outside the admin layout), and the export is logged.
export async function GET() {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch {
    return new Response("Admins only.", { status: 403 });
  }
  const { admin, userId } = ctx;
  const { payments, disputes, error } = await loadPayments(admin, { limit: 100 });
  if (error) return new Response(`Couldn't read Stripe: ${error}`, { status: 502 });

  await logAdminAction(admin, userId, {
    action: "export.payments",
    targetType: "user",
    after: `${payments.length} payments, ${disputes.length} disputes`,
    amount: payments.length,
  });

  const header = ["kind", "when_utc", "state", "amount", "currency", "email", "account_id", "detail", "stripe_link"];
  const lines = [
    ...payments.map((p) => ["payment", p.created, p.state, (p.amountCents / 100).toFixed(2), p.currency, p.email, p.userId, p.failure ?? p.description, p.stripeUrl]),
    ...disputes.map((d) => ["dispute", d.created, d.status, (d.amountCents / 100).toFixed(2), d.currency, d.email, d.userId, d.reason, d.stripeUrl]),
  ].map((cells) => cells.map(csvCell).join(","));

  const date = new Date().toISOString().slice(0, 10);
  return new Response([header.join(","), ...lines].join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="picacho-payments-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
