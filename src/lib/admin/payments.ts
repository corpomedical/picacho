// Admin → Payments & disputes (2026-09-28 admin redesign, part 4): what
// Stripe itself says happened to money — recent charges (paid, failed,
// refunded, disputed) and the disputes waiting on an answer — matched to
// Picacho accounts by their Stripe customer id. Reads only: refunds and
// dispute answers stay in Stripe's dashboard, one click away on every row.
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe/client";

export type PaymentRow = {
  id: string;
  created: string;
  amountCents: number;
  currency: string;
  state: "paid" | "failed" | "refunded" | "partly refunded" | "disputed" | "pending";
  failure: string | null;
  description: string | null;
  email: string | null;
  userId: string | null;
  customerId: string | null;
  stripeUrl: string;
};

export type DisputeRow = {
  id: string;
  created: string;
  amountCents: number;
  currency: string;
  reason: string;
  status: string;
  dueBy: string | null;
  email: string | null;
  userId: string | null;
  stripeUrl: string;
};

/** The disputes Stripe is still waiting on us to answer. */
export const OPEN_DISPUTE_STATUSES = new Set(["needs_response", "warning_needs_response"]);

export function chargeState(c: Pick<Stripe.Charge, "status" | "refunded" | "amount_refunded" | "disputed">): PaymentRow["state"] {
  if (c.disputed) return "disputed";
  if (c.refunded) return "refunded";
  if (c.amount_refunded > 0) return "partly refunded";
  if (c.status === "failed") return "failed";
  if (c.status === "pending") return "pending";
  return "paid";
}

function customerIdOf(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

const iso = (unix: number) => new Date(unix * 1000).toISOString();

export async function loadPayments(
  admin: SupabaseClient,
  opts: { limit?: number } = {},
): Promise<{ payments: PaymentRow[]; disputes: DisputeRow[]; error: string | null }> {
  if (!process.env.STRIPE_SECRET_KEY) return { payments: [], disputes: [], error: "STRIPE_SECRET_KEY is not set." };
  let charges: Stripe.Charge[] = [];
  let disputes: Stripe.Dispute[] = [];
  try {
    const [c, d] = await Promise.all([
      stripe.charges.list({ limit: Math.min(opts.limit ?? 50, 100) }),
      stripe.disputes.list({ limit: 30 }),
    ]);
    charges = c.data;
    disputes = d.data;
  } catch (err) {
    return { payments: [], disputes: [], error: err instanceof Error ? err.message : "Stripe didn't answer." };
  }

  // Which Picacho account each Stripe customer is.
  const customerIds = [
    ...new Set(
      [...charges.map((c) => customerIdOf(c.customer)), ...disputes.map((d) => {
        const ch = d.charge;
        return typeof ch === "object" && ch ? customerIdOf(ch.customer) : null;
      })].filter((id): id is string => !!id),
    ),
  ];
  const byCustomer = new Map<string, { id: string; email: string | null }>();
  if (customerIds.length) {
    const { data } = await admin.from("profiles").select("id, email, stripe_customer_id").in("stripe_customer_id", customerIds);
    for (const p of data ?? []) byCustomer.set(p.stripe_customer_id as string, { id: p.id as string, email: (p.email as string) ?? null });
  }
  const chargeCustomer = new Map(charges.map((c) => [c.id, customerIdOf(c.customer)]));

  const payments: PaymentRow[] = charges.map((c) => {
    const customerId = customerIdOf(c.customer);
    const account = customerId ? byCustomer.get(customerId) : undefined;
    return {
      id: c.id,
      created: iso(c.created),
      amountCents: c.amount,
      currency: c.currency,
      state: chargeState(c),
      failure: c.failure_message ?? null,
      description: c.description ?? null,
      email: account?.email ?? c.billing_details?.email ?? c.receipt_email ?? null,
      userId: account?.id ?? null,
      customerId,
      stripeUrl: `https://dashboard.stripe.com/payments/${c.payment_intent && typeof c.payment_intent === "string" ? c.payment_intent : c.id}`,
    };
  });

  const disputeRows: DisputeRow[] = disputes.map((d) => {
    const chargeId = typeof d.charge === "string" ? d.charge : d.charge?.id;
    const customerId = (chargeId && chargeCustomer.get(chargeId)) || (typeof d.charge === "object" && d.charge ? customerIdOf(d.charge.customer) : null);
    const account = customerId ? byCustomer.get(customerId) : undefined;
    return {
      id: d.id,
      created: iso(d.created),
      amountCents: d.amount,
      currency: d.currency,
      reason: d.reason.replace(/_/g, " "),
      status: d.status,
      dueBy: d.evidence_details?.due_by ? iso(d.evidence_details.due_by) : null,
      email: account?.email ?? null,
      userId: account?.id ?? null,
      stripeUrl: `https://dashboard.stripe.com/disputes/${d.id}`,
    };
  });

  return { payments, disputes: disputeRows, error: null };
}
