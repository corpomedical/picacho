import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The assistant top-up paths through the Stripe webhook (2026-09-28): a paid
// top-up session grants its metadata's units once, an unpaid one grants
// nothing, a grant the database refuses answers 500 so Stripe retries, and a
// full refund takes the top-up back. Stripe, Supabase and the push are fakes;
// the route's own code runs.

const rpc = vi.fn();
const listLineItems = vi.fn();
const listSessions = vi.fn();
const notifyAdmins = vi.fn();

vi.mock("@/lib/stripe/client", () => ({
  stripe: {
    webhooks: { constructEvent: (body: string) => JSON.parse(body) },
    checkout: { sessions: { listLineItems: (...a: unknown[]) => listLineItems(...a), list: (...a: unknown[]) => listSessions(...a) } },
  },
}));
vi.mock("@/lib/push/web-push", () => ({ notifyAdmins: (...a: unknown[]) => notifyAdmins(...a) }));
vi.mock("@/lib/stripe/plans", async () => await import("../../../../lib/stripe/plans"));
vi.mock("@/lib/retention/subscription-events", () => ({ cancelTransition: () => null, noteSubscriptionEvent: async () => {} }));
vi.mock("@/lib/stripe/credit-packs", async () => await import("../../../../lib/stripe/credit-packs"));
vi.mock("@/lib/agent/allowance", async () => await import("../../../../lib/agent/allowance"));
vi.mock("@/lib/supabase/server", () => {
  // A query builder that answers every chain: awaited → no error;
  // maybeSingle/single → no row.
  const builder = (): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    for (const m of ["update", "select", "eq", "is", "in", "order", "limit", "gte"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: null, error: null });
    b.single = async () => ({ data: null, error: null });
    b.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
    return b;
  };
  return { createAdminClient: () => ({ from: () => builder(), rpc: (...a: unknown[]) => rpc(...a) }) };
});

const { POST } = await import("./route");

function event(type: string, object: Record<string, unknown>) {
  return new Request("https://picacho.ai/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=test" },
    body: JSON.stringify({ id: "evt_1", type, data: { object } }),
  });
}

const paidTopUp = {
  id: "cs_test_topup",
  mode: "payment",
  payment_status: "paid",
  amount_total: 1900,
  currency: "usd",
  customer: "cus_1",
  client_reference_id: "user-1",
  metadata: { supabase_user_id: "user-1", assistant_topup: "assistant-500", assistant_units: "500" },
};

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  rpc.mockReset();
  listLineItems.mockReset();
  listSessions.mockReset();
  notifyAdmins.mockReset();
});

describe("assistant top-up in the Stripe webhook", () => {
  it("grants the metadata's units once and tells the admins", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const res = await POST(event("checkout.session.completed", paidTopUp));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("grant_assistant_topup", {
      p_user_id: "user-1",
      p_session_id: "cs_test_topup",
      p_units: 500,
      p_amount_cents: 1900,
      p_currency: "usd",
    });
    // Never mistaken for a credit pack.
    expect(listLineItems).not.toHaveBeenCalled();
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
    expect(String(notifyAdmins.mock.calls[0][0].body)).toContain("assistant top-up, 500 units");
  });

  it("stays quiet on a redelivery", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const res = await POST(event("checkout.session.completed", paidTopUp));
    expect(res.status).toBe(200);
    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it("grants nothing while the payment is still in flight", async () => {
    const res = await POST(event("checkout.session.completed", { ...paidTopUp, payment_status: "unpaid" }));
    expect(res.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 500 when the grant fails, so Stripe retries (e.g. before the SQL has run)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.grant_assistant_topup" } });
    const res = await POST(event("checkout.session.completed", paidTopUp));
    expect(res.status).toBe(500);
  });

  it("refuses units it can't read", async () => {
    const res = await POST(
      event("checkout.session.completed", { ...paidTopUp, metadata: { ...paidTopUp.metadata, assistant_units: "lots" } }),
    );
    expect(res.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("takes a fully refunded top-up back", async () => {
    listSessions.mockResolvedValue({ data: [{ id: "cs_test_topup" }] });
    rpc.mockResolvedValue({ data: true, error: null });
    const res = await POST(event("charge.refunded", { payment_intent: "pi_1", refunded: true, amount: 1900, amount_refunded: 1900 }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("clawback_assistant_topup", { p_session_id: "cs_test_topup" });
  });

  it("acks a refund when the database has no top-ups yet, and retries on a real error", async () => {
    listSessions.mockResolvedValue({ data: [{ id: "cs_sub" }] });
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    expect((await POST(event("charge.refunded", { payment_intent: "pi_2", refunded: true, amount: 100, amount_refunded: 100 }))).status).toBe(200);
    rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "connection failure" } });
    expect((await POST(event("charge.refunded", { payment_intent: "pi_2", refunded: true, amount: 100, amount_refunded: 100 }))).status).toBe(500);
  });
});
