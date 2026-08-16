import { createClient } from "@/lib/supabase/server";
import { createPromoCode } from "@/lib/admin/promo-actions";
import { Card } from "@/components/ui/card";
import { PromoCodeCard } from "@/components/admin/promo-code-card";
import { Input, Label } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { AdminErrorBanner } from "@/components/admin-error-banner";
import { LocalDate } from "@/components/local-date";

export const dynamic = "force-dynamic";

// Money helper: redemption amounts are stored in cents, commission is a
// straight percentage of the ex-tax subtotal. Kept as plain integer math on
// cents until the final formatting step, so nothing accumulates float error.
function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export default async function AdminPromoPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: actionError } = await searchParams;
  const supabase = await createClient();

  const [{ data: codes }, { data: redemptions }] = await Promise.all([
    supabase.from("promo_codes").select("*").order("created_at", { ascending: false }),
    supabase
      .from("promo_redemptions")
      .select(
        "promo_code_id, code, rep_name, user_email, amount_subtotal, discount_amount, commission_percent, currency, created_at",
      )
      .order("created_at", { ascending: false }),
  ]);

  // Per-code rollups, computed here rather than in SQL — the volumes are
  // tiny (one row per closed sale) and this keeps the page a single file.
  //
  // Commission is summed PER REDEMPTION, at the rate that sale closed at,
  // rather than applying the code's current rate to the total — otherwise
  // editing a rep's rate would silently rewrite what they're owed on business
  // already banked.
  const byCode = new Map<
    string,
    { count: number; subtotal: number; discount: number; commission: number; currency: string }
  >();
  for (const r of redemptions ?? []) {
    const key = r.promo_code_id ?? r.code;
    const agg =
      byCode.get(key) ?? { count: 0, subtotal: 0, discount: 0, commission: 0, currency: r.currency };
    agg.count += 1;
    agg.subtotal += r.amount_subtotal;
    agg.discount += r.discount_amount;
    agg.commission += Math.round((r.amount_subtotal * (r.commission_percent ?? 0)) / 100);
    byCode.set(key, agg);
  }

  return (
    <div>
      <AdminErrorBanner error={actionError} />
      <h1 className="text-lg font-semibold text-neutral-900">Promo codes</h1>
      <p className="mt-1 text-sm text-neutral-500">
        One code per salesperson. Clients enter it on the Stripe payment page; every redemption is
        recorded here with the revenue it brought and the commission owed.
      </p>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-900">New code</h2>
        <form action={createPromoCode} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="promo-code">Code</Label>
            <Input id="promo-code" name="code" placeholder="MARIA20" required className="uppercase" />
          </div>
          <div>
            <Label htmlFor="promo-rep">Salesperson</Label>
            <Input id="promo-rep" name="rep_name" placeholder="Maria G." required />
          </div>
          <div>
            <Label htmlFor="promo-discount">Discount %</Label>
            <Input id="promo-discount" name="discount_percent" type="number" min={1} max={100} defaultValue={20} required />
          </div>
          <div>
            <Label htmlFor="promo-duration">Discount duration (months, 0 = forever)</Label>
            <Input id="promo-duration" name="duration_months" type="number" min={0} max={36} defaultValue={3} required />
          </div>
          <div>
            <Label htmlFor="promo-commission">Commission % (of first payment)</Label>
            <Input id="promo-commission" name="commission_percent" type="number" min={0} max={100} defaultValue={10} required />
          </div>
          <div>
            <Label htmlFor="promo-notes">Notes (optional)</Label>
            <Input id="promo-notes" name="notes" placeholder="Lisbon region" />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <SubmitButton pendingLabel="Creating…">Create code</SubmitButton>
            <p className="mt-2 text-xs text-neutral-400">
              Codes only work for a client&apos;s first payment — an existing paying customer can&apos;t
              redeem one, so commission is only ever owed on genuinely new business.
            </p>
          </div>
        </form>
      </Card>

      <div className="mt-6 space-y-3">
        {!codes || codes.length === 0 ? (
          <Card>
            <p className="text-sm text-neutral-500">No codes yet — create the first one above.</p>
          </Card>
        ) : (
          codes.map((promo) => (
            <PromoCodeCard
              key={promo.id}
              promo={promo}
              stats={byCode.get(promo.id) ?? byCode.get(promo.code) ?? null}
            />
          ))
        )}
      </div>

      {redemptions && redemptions.length > 0 && (
        <Card className="mt-6 p-0">
          <h2 className="px-5 pt-5 text-sm font-semibold text-neutral-900">Recent redemptions</h2>
          <div className="mt-3 divide-y divide-neutral-100">
            {redemptions.slice(0, 20).map((r, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-900">{r.user_email ?? "Unknown"}</p>
                  <p className="text-xs text-neutral-500">
                    <span className="font-mono">{r.code}</span> · {r.rep_name} ·{" "}
                    <LocalDate date={r.created_at} mode="datetime" />
                  </p>
                </div>
                <p className="text-xs text-neutral-600">
                  paid {money(r.amount_subtotal, r.currency)}{" "}
                  <span className="text-neutral-400">(saved {money(r.discount_amount, r.currency)})</span>
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
