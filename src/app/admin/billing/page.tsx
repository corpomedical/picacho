import { createClient } from "@/lib/supabase/server";
import { PLAN_LIMITS, PLAN_LABELS, type PlanId } from "@/lib/plans";
import { PRICING_TIERS } from "@/lib/pricing";
import { Card } from "@/components/ui/card";

const PRICE_BY_PLAN: Record<string, number> = Object.fromEntries(
  PRICING_TIERS.map((t) => [t.id, t.price]),
);

export default async function AdminBillingPage() {
  const supabase = await createClient();
  const { data: profiles } = await supabase.from("profiles").select("plan");

  const distribution = Object.fromEntries(
    (Object.keys(PLAN_LIMITS) as PlanId[]).map((plan) => [plan, 0]),
  ) as Record<PlanId, number>;

  (profiles ?? []).forEach((p) => {
    const plan = (p.plan ?? "none") as PlanId;
    distribution[plan] = (distribution[plan] ?? 0) + 1;
  });

  const mrr = (Object.keys(distribution) as PlanId[]).reduce(
    (sum, plan) => sum + distribution[plan] * (PRICE_BY_PLAN[plan] ?? 0),
    0,
  );

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900">Billing</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-neutral-500">MRR</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">${mrr}</p>
          <p className="mt-1 text-xs text-neutral-400">Computed from assigned plans</p>
        </Card>
        <Card>
          <p className="text-sm text-neutral-500">Churn</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-300">—</p>
          <p className="mt-1 text-xs text-neutral-400">Needs Stripe connected</p>
        </Card>
        <Card>
          <p className="text-sm text-neutral-500">Failed payments</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-300">—</p>
          <p className="mt-1 text-xs text-neutral-400">Needs Stripe connected</p>
        </Card>
      </div>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-900">Plan distribution</h2>
        <div className="mt-4 space-y-3">
          {(Object.keys(distribution) as PlanId[]).map((plan) => {
            const count = distribution[plan];
            const total = profiles?.length || 1;
            const pct = Math.round((count / total) * 100);
            return (
              <div key={plan}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-700">{PLAN_LABELS[plan]}</span>
                  <span className="text-neutral-500">
                    {count} {plan !== "none" && `/ ${PLAN_LIMITS[plan]} gen`}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full bg-neutral-900"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
