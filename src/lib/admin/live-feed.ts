// The phone admin app's Live tab (2026-10-02, "Pocket admin", draft A): what
// happened, newest first, in four kinds — money (Stripe charges: plans,
// renewals, top-ups, failures, refunds, disputes), sign-ups, renders
// (finished and failed) and issues (problem reports, feedback, models taken
// out of service). Read from the same places the website admin reads.

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPayments } from "@/lib/admin/payments";
import { modelName } from "@/lib/admin/today";

export type LiveKind = "money" | "signups" | "renders" | "issues";

export type LiveEvent = {
  id: string;
  kind: LiveKind;
  title: string;
  sub: string;
  at: string;
  tone: "good" | "bad" | "warn" | "info";
  /** Where tapping it goes in the app: "#people/<id>" or "#controls". */
  open: string | null;
};

const money = (cents: number, currency: string) =>
  `${currency.toUpperCase() === "EUR" ? "€" : currency.toUpperCase() === "USD" ? "$" : `${currency.toUpperCase()} `}${(cents / 100).toFixed(2)}`;

export async function loadLiveFeed(admin: SupabaseClient, limit = 60): Promise<{ events: LiveEvent[]; moneyError: string | null }> {
  const [payments, signups, gens, reports, feedback, models] = await Promise.all([
    loadPayments(admin, { limit: 30 }),
    admin.from("profiles").select("id, email, full_name, created_at").order("created_at", { ascending: false }).limit(30),
    admin
      .from("generations")
      .select("id, user_id, status, content_type, video_model_id, model_id, created_at, updated_at")
      .in("status", ["succeeded", "failed"])
      .order("updated_at", { ascending: false })
      .limit(40),
    admin.from("generation_reports").select("id, user_id, reason, details, created_at").order("created_at", { ascending: false }).limit(15),
    admin.from("feedback").select("id, user_id, message, created_at").order("created_at", { ascending: false }).limit(15),
    admin.from("model_health").select("model_id, tripped_at, last_error").not("tripped_at", "is", null),
  ]);

  const events: LiveEvent[] = [];
  for (const p of payments.payments) {
    const bad = p.state === "failed" || p.state === "disputed";
    events.push({
      id: `pay:${p.id}`,
      kind: "money",
      title: `${p.state === "paid" ? "Payment" : p.state === "failed" ? "Payment failed" : p.state === "disputed" ? "Dispute" : p.state === "pending" ? "Payment pending" : "Refund"} · ${money(p.amountCents, p.currency)}`,
      sub: [p.description, p.email].filter(Boolean).join(" · ") || "Stripe",
      at: p.created,
      tone: bad ? "bad" : p.state === "paid" ? "good" : "warn",
      open: p.userId ? `#people/${p.userId}` : null,
    });
  }
  for (const d of payments.disputes) {
    events.push({
      id: `dispute:${d.id}`,
      kind: "issues",
      title: `Card dispute · ${money(d.amountCents, d.currency)}`,
      sub: `${d.reason.replace(/_/g, " ")}${d.dueBy ? ` · reply by ${new Date(d.dueBy).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}`,
      at: d.created,
      tone: "bad",
      open: d.userId ? `#people/${d.userId}` : null,
    });
  }
  for (const u of (signups.data ?? []) as { id: string; email: string | null; full_name: string | null; created_at: string }[]) {
    events.push({ id: `signup:${u.id}`, kind: "signups", title: "New sign-up", sub: u.email ?? u.full_name ?? "A new account", at: u.created_at, tone: "info", open: `#people/${u.id}` });
  }
  for (const g of (gens.data ?? []) as {
    id: string;
    user_id: string;
    status: string;
    content_type: string | null;
    video_model_id: string | null;
    model_id: string | null;
    updated_at: string | null;
    created_at: string;
  }[]) {
    const what = g.content_type === "video" ? "Video" : "Picture";
    const failed = g.status === "failed";
    events.push({
      id: `gen:${g.id}`,
      kind: "renders",
      title: failed ? `${what} failed` : `${what} finished`,
      sub: modelName(g.video_model_id ?? g.model_id),
      at: g.updated_at ?? g.created_at,
      tone: failed ? "bad" : "good",
      open: `#people/${g.user_id}`,
    });
  }
  for (const r of (reports.data ?? []) as { id: string; user_id: string | null; reason: string | null; details: string | null; created_at: string }[]) {
    events.push({ id: `report:${r.id}`, kind: "issues", title: "Problem report", sub: (r.details || r.reason || "Reported").slice(0, 90), at: r.created_at, tone: "warn", open: r.user_id ? `#people/${r.user_id}` : null });
  }
  for (const f of (feedback.data ?? []) as { id: string; user_id: string | null; message: string | null; created_at: string }[]) {
    events.push({ id: `feedback:${f.id}`, kind: "issues", title: "Feedback", sub: (f.message ?? "").slice(0, 90), at: f.created_at, tone: "info", open: f.user_id ? `#people/${f.user_id}` : null });
  }
  for (const m of (models.data ?? []) as { model_id: string; tripped_at: string; last_error: string | null }[]) {
    events.push({ id: `model:${m.model_id}`, kind: "issues", title: `${modelName(m.model_id)} switched off`, sub: (m.last_error ?? "Out of service").slice(0, 90), at: m.tripped_at, tone: "bad", open: "#controls" });
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { events: events.slice(0, limit), moneyError: payments.error };
}
