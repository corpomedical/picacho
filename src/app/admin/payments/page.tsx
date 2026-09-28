import Link from "next/link";
import { requireAdmin } from "@/lib/admin/require-admin";
import { loadPayments, OPEN_DISPUTE_STATUSES, type PaymentRow } from "@/lib/admin/payments";
import { money } from "@/lib/admin/today";
import { LocalDate } from "@/components/local-date";
import { cn } from "@/lib/cn";

// Admin → Payments & disputes (2026-09-28 admin redesign, part 4). Straight
// from Stripe: the last 100 charges and every recent dispute, matched to
// Picacho accounts. Refunds and dispute answers happen in Stripe, one click
// away on each row; this page makes sure nothing waits there unseen.

const STATE_STYLE: Record<PaymentRow["state"], string> = {
  paid: "bg-[#e4efe3] text-[#245a2e] dark:bg-[#1b2e1e] dark:text-[#a6d6ad]",
  pending: "bg-[#ecebe7] text-[#44474f] dark:bg-white/10 dark:text-neutral-300",
  failed: "bg-[#fbeedd] text-[#7a4a0c] dark:bg-[#3a2c18] dark:text-[#f0c98f]",
  refunded: "bg-[#e3ecf6] text-[#1f4770] dark:bg-[#1c2a3a] dark:text-[#a9c6e8]",
  "partly refunded": "bg-[#e3ecf6] text-[#1f4770] dark:bg-[#1c2a3a] dark:text-[#a9c6e8]",
  disputed: "bg-[#fbe4e1] text-[#8f1d15] dark:bg-[#3a1d1a] dark:text-[#f3b1a8]",
};

const FILTERS = ["all", "paid", "failed", "refunded", "disputed"] as const;

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { admin } = await requireAdmin();
  const { show } = await searchParams;
  const filter = (FILTERS as readonly string[]).includes(show ?? "") ? (show as (typeof FILTERS)[number]) : "all";
  const { payments, disputes, error } = await loadPayments(admin, { limit: 100 });
  const openDisputes = disputes.filter((d) => OPEN_DISPUTE_STATUSES.has(d.status));
  const rows =
    filter === "all"
      ? payments
      : payments.filter((p) => (filter === "refunded" ? p.state === "refunded" || p.state === "partly refunded" : p.state === filter));

  // Money in over the rows shown, per currency (paid charges, less refunds Stripe reported).
  const totals = new Map<string, number>();
  for (const p of payments) if (p.state === "paid") totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.amountCents);
  const failed = payments.filter((p) => p.state === "failed").length;

  const chip = (active: boolean) =>
    cn(
      "inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-medium capitalize",
      active ? "bg-atelier-ink text-atelier-paper" : "border border-atelier-rule bg-atelier-surface text-atelier-ink hover:border-atelier-ink/30",
    );

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">Money</p>
          <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">Payments &amp; disputes</h1>
          <p className="mt-1 text-sm text-atelier-muted">
            Straight from Stripe: the last 100 charges and recent disputes, matched to Picacho accounts. Refund or answer
            a dispute in Stripe — every row opens it there.
          </p>
        </div>
        <a
          href="/admin/payments/export"
          className="inline-flex h-9 items-center rounded-[10px] border border-atelier-rule bg-atelier-surface px-3.5 text-[13px] font-medium text-atelier-ink hover:border-atelier-ink/30"
        >
          Export CSV
        </a>
      </div>

      {error ? (
        <p className="mt-6 rounded-2xl border border-atelier-rule bg-atelier-surface p-6 text-sm text-atelier-muted">
          Couldn&apos;t read Stripe: {error}
        </p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                label: "Paid (these 100)",
                value: [...totals.entries()].map(([c, cents]) => money(cents, c)).join(" + ") || "0",
                bad: false,
              },
              { label: "Failed", value: String(failed), bad: failed > 0 },
              { label: "Disputes to answer", value: String(openDisputes.length), bad: openDisputes.length > 0 },
              { label: "Disputes (recent)", value: String(disputes.length), bad: false },
            ].map((t) => (
              <div key={t.label} className="rounded-2xl border border-atelier-rule bg-atelier-surface px-4 py-3.5">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-atelier-muted">{t.label}</p>
                <p className={cn("mt-1.5 font-numeral text-[26px] leading-none tabular-nums", t.bad ? "text-[#b3261e] dark:text-[#f3b1a8]" : "text-atelier-ink")}>
                  {t.value}
                </p>
              </div>
            ))}
          </div>

          {disputes.length > 0 && (
            <section className="mt-6 overflow-hidden rounded-2xl border border-atelier-rule bg-atelier-surface">
              <h2 className="px-5 pb-3 pt-4 text-[15px] font-semibold text-atelier-ink">Disputes</h2>
              <ul>
                {disputes.map((d) => (
                  <li key={d.id} className="flex flex-col gap-2 border-t border-atelier-rule px-5 py-3 text-[13px] sm:flex-row sm:items-center sm:gap-4">
                    <span
                      className={cn(
                        "w-[112px] flex-shrink-0 rounded-md py-1 text-center text-[10px] font-bold uppercase tracking-[0.06em]",
                        OPEN_DISPUTE_STATUSES.has(d.status) ? STATE_STYLE.disputed : STATE_STYLE.pending,
                      )}
                    >
                      {d.status.replace(/_/g, " ")}
                    </span>
                    <span className="min-w-0 flex-1 text-atelier-ink">
                      <span className="font-semibold">{money(d.amountCents, d.currency)}</span> · {d.reason}
                      <span className="block text-xs text-atelier-muted">
                        {d.userId ? (
                          <Link href={`/admin/users/${d.userId}`} className="text-atelier-accent hover:underline">
                            {d.email ?? "account"}
                          </Link>
                        ) : (
                          d.email ?? "no Picacho account matched"
                        )}
                        {d.dueBy && OPEN_DISPUTE_STATUSES.has(d.status) && (
                          <>
                            {" "}
                            · answer by <LocalDate date={d.dueBy} mode="date" />
                          </>
                        )}
                      </span>
                    </span>
                    <a
                      href={d.stripeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center self-start rounded-lg bg-atelier-ink px-3 text-[12.5px] font-medium text-atelier-paper sm:self-auto"
                    >
                      Open in Stripe ↗
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Link key={f} href={f === "all" ? "/admin/payments" : `/admin/payments?show=${f}`} className={chip(filter === f)}>
                {f}
              </Link>
            ))}
          </div>

          <section className="mt-3 overflow-hidden rounded-2xl border border-atelier-rule bg-atelier-surface">
            {rows.length === 0 ? (
              <p className="p-6 text-sm text-atelier-muted">No payments here.</p>
            ) : (
              <ul>
                {rows.map((p) => (
                  <li
                    key={p.id}
                    className="grid gap-1 border-t border-atelier-rule px-5 py-3 text-[13px] text-atelier-ink first:border-t-0 lg:grid-cols-[150px_110px_minmax(0,1fr)_minmax(0,1fr)_120px] lg:items-center lg:gap-3"
                  >
                    <span className="text-atelier-muted">
                      <LocalDate date={p.created} mode="datetime" />
                    </span>
                    <span className={cn("justify-self-start rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-[0.06em]", STATE_STYLE[p.state])}>
                      {p.state}
                    </span>
                    <span className="min-w-0 truncate">
                      {p.userId ? (
                        <Link href={`/admin/users/${p.userId}`} className="text-atelier-accent hover:underline">
                          {p.email ?? "account"}
                        </Link>
                      ) : (
                        <span className="text-atelier-muted">{p.email ?? "no Picacho account matched"}</span>
                      )}
                    </span>
                    <span className="min-w-0 truncate text-atelier-muted">
                      <span className="font-semibold text-atelier-ink">{money(p.amountCents, p.currency)}</span>
                      {p.failure ? ` · ${p.failure}` : p.description ? ` · ${p.description}` : ""}
                    </span>
                    <a href={p.stripeUrl} target="_blank" rel="noopener noreferrer" className="text-atelier-accent hover:underline lg:text-right">
                      Open in Stripe ↗
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
