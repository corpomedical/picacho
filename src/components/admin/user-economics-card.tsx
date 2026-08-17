import { Card } from "@/components/ui/card";
import type { UserEconomics } from "@/lib/admin/economics";

// The money view for one account, on the admin user page.
//
// Two rules it tries to hold to. First, never present an estimate as a fact:
// costs are reconstructed from what each generation is known to consume, not
// read off an invoice, and the footnote says so in plain words. Second, make
// the number that matters — is this account worth having — readable without
// arithmetic, which is why margin is coloured and stated per month.

function eur(cents: number): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function Stat({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
  hint?: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</p>
      <p
        className={
          "mt-1 text-xl font-semibold " +
          (tone === "good"
            ? "text-emerald-700"
            : tone === "bad"
              ? "text-red-600"
              : "text-neutral-900")
        }
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-neutral-400">{hint}</p>}
    </div>
  );
}

export function UserEconomicsCard({ economics }: { economics: UserEconomics }) {
  const { months, lifetime, acquisition } = economics;
  const current = months[0];

  return (
    <Card className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">Money</h2>
        <p className="text-xs text-neutral-400">Last {months.length} months</p>
      </div>

      <div className="mt-4 grid gap-5 sm:grid-cols-3">
        <Stat
          label="This month — revenue"
          value={eur(current?.revenueCents ?? 0)}
          hint={
            current && current.purchaseRevenueCents > 0
              ? `${eur(current.planRevenueCents)} plan + ${eur(current.purchaseRevenueCents)} top-ups`
              : "plan value"
          }
        />
        <Stat
          label="This month — cost"
          value={eur(current?.costCents ?? 0)}
          hint="estimated provider spend"
        />
        <Stat
          label="This month — margin"
          value={eur(current?.marginCents ?? 0)}
          tone={(current?.marginCents ?? 0) >= 0 ? "good" : "bad"}
          hint={
            current && current.revenueCents > 0
              ? `${Math.round((current.marginCents / current.revenueCents) * 100)}% of revenue`
              : "no revenue this month"
          }
        />
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-neutral-400">
              <th className="pb-2 font-medium">Month</th>
              <th className="pb-2 text-right font-medium">Revenue</th>
              <th className="pb-2 text-right font-medium">Cost</th>
              <th className="pb-2 text-right font-medium">Margin</th>
              <th className="pb-2 text-right font-medium">Images</th>
              <th className="pb-2 text-right font-medium">Videos</th>
              <th className="pb-2 text-right font-medium">Failed</th>
              <th className="pb-2 text-right font-medium">Credits</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-t border-neutral-100">
                <td className="py-2 font-medium text-neutral-900">{m.label}</td>
                <td className="py-2 text-right text-neutral-700">{eur(m.revenueCents)}</td>
                <td className="py-2 text-right text-neutral-700">{eur(m.costCents)}</td>
                <td
                  className={
                    "py-2 text-right font-semibold " +
                    (m.marginCents >= 0 ? "text-emerald-700" : "text-red-600")
                  }
                >
                  {eur(m.marginCents)}
                </td>
                <td className="py-2 text-right text-neutral-500">{m.images}</td>
                <td className="py-2 text-right text-neutral-500">{m.videos}</td>
                <td
                  className={
                    "py-2 text-right " + (m.failed > 0 ? "text-red-500" : "text-neutral-300")
                  }
                >
                  {m.failed}
                </td>
                <td className="py-2 text-right text-neutral-500">{m.creditsUsed}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-neutral-200 text-sm">
              <td className="pt-2 font-semibold text-neutral-900">Total</td>
              <td className="pt-2 text-right font-semibold text-neutral-900">
                {eur(lifetime.revenueCents)}
              </td>
              <td className="pt-2 text-right font-semibold text-neutral-900">
                {eur(lifetime.costCents)}
              </td>
              <td
                className={
                  "pt-2 text-right font-semibold " +
                  (lifetime.marginCents >= 0 ? "text-emerald-700" : "text-red-600")
                }
              >
                {eur(lifetime.marginCents)}
              </td>
              <td className="pt-2 text-right text-neutral-400" colSpan={4}>
                {lifetime.generations} generations
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {current && (current.imageCostCents > 0 || current.videoCostCents > 0) && (
        <div className="mt-5 rounded-[12px] border border-neutral-100 bg-neutral-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            This month&apos;s cost, broken down
          </p>
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <div className="flex justify-between">
              <dt className="text-neutral-500">Images (incl. failed attempts)</dt>
              <dd className="font-medium text-neutral-900">{eur(current.imageCostCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">Video renders</dt>
              <dd className="font-medium text-neutral-900">{eur(current.videoCostCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">
                Character photos generated ({current.referencePhotos})
              </dt>
              <dd className="font-medium text-neutral-900">
                {eur(current.referencePhotoCostCents)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">Prompt assists ({current.assists})</dt>
              <dd className="font-medium text-neutral-900">{eur(current.assistCostCents)}</dd>
            </div>
          </dl>
        </div>
      )}

      {acquisition && (
        <div className="mt-4 rounded-[12px] border border-ochre/25 bg-ochre-soft/40 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ochre">
            Came through a salesperson
          </p>
          <p className="mt-1.5 text-sm text-neutral-800">
            Code <span className="font-mono font-semibold">{acquisition.code}</span> ·{" "}
            {acquisition.repName}
          </p>
          <p className="mt-1 text-xs text-neutral-600">
            Discount given {eur(acquisition.discountGivenCents)} · commission owed{" "}
            {eur(acquisition.commissionOwedCents)} — both already subtracted from what this
            account actually paid.
          </p>
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-neutral-400">
        Costs are <strong className="font-medium text-neutral-500">estimates</strong>, not
        invoices: providers don&apos;t bill us per request, so spend is reconstructed from what
        each generation consumes — €0.16 per image attempt (failed ones included, they cost the
        same), and video priced from its credit weight, which was itself derived from render
        cost. Revenue is the plan&apos;s list price plus one-off credit purchases; it is not read
        from Stripe invoices, so it reads &quot;what this plan bills&quot;, not &quot;what
        cleared&quot;.
      </p>
    </Card>
  );
}
