import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { Card } from "@/components/ui/card";
import { TrafficChart, type TrafficDay } from "@/components/admin/traffic-chart";
import { COST_BASIS_USD_PER_CREDIT } from "@/lib/generations/providers/video-models";
import { IMAGE_COST_USD } from "@/lib/admin/economics";
import { cn } from "@/lib/cn";
import { PLAN_LABELS, type PlanId } from "@/lib/plans";
import { PRICING_TIERS } from "@/lib/pricing";
import { currencyForPriceId, planIdForPriceId } from "@/lib/stripe/plans";
import { fetchAll } from "@/lib/admin/fetch-all";

const PRICE_BY_PLAN: Record<string, number> = Object.fromEntries(
  PRICING_TIERS.map((t) => [t.id, t.price]),
);

// Monthly-equivalent value of an annual subscription — annual bills
// tier.annualPrice * 12 once a year, so its MRR contribution is annualPrice.
// Same constant and reasoning as admin/billing/page.tsx.
const ANNUAL_PRICE_BY_PLAN: Record<string, number> = Object.fromEntries(
  PRICING_TIERS.map((t) => [t.id, t.annualPrice]),
);

// Ledger order (board B): cheapest tier first, the free row beside Basic.
const PLAN_ORDER: PlanId[] = ["basic", "none", "starter", "growth", "studio", "elite"];

function timeAgo(dateStr: string) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return startOfDay(d);
}

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Buckets rows into a fixed-length run of calendar days (oldest -> newest) so
// every card's bar chart lines up on the same x-axis even on days with zero
// activity, rather than only showing days that happen to have rows.
function buildDailySeries(rows: { created_at: string }[], days: number) {
  const start = daysAgo(days - 1);
  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    buckets.set(dayKey(d), 0);
  }
  rows.forEach((r) => {
    const k = dayKey(new Date(r.created_at));
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1);
  });
  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }));
}

function topN(
  values: (string | null | undefined)[],
  n: number,
  fallbackLabel: string,
): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  values.forEach((raw) => {
    const label = raw && raw.trim() ? raw : fallbackLabel;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

function hostnameOf(referrer: string | null | undefined) {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return referrer;
  }
}

function DailyBars({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  // Board B: square ink bars over three hairlines; a day with nothing is a
  // 2px stub at a quarter strength, so the row still reads as fourteen days.
  return (
    <div className="relative mt-4 h-[72px]">
      {[14, 53, 92].map((pct) => (
        <div key={pct} className="absolute inset-x-0 border-t border-atelier-rule" style={{ top: `${pct}%` }} />
      ))}
      <div className="absolute inset-x-0 top-0 bottom-[8%] grid auto-cols-fr grid-flow-col">
        {data.map((d) => (
          <div key={d.date} title={`${d.date}: ${d.count}`} className="flex items-end justify-center">
            <div
              className={cn("w-[60%] rounded-[1px]", d.count > 0 ? "bg-atelier-ink" : "bg-atelier-ink/25")}
              style={{ height: d.count > 0 ? `${(d.count / max) * 100}%` : "2px" }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function TopList({
  items,
  empty,
}: {
  items: { label: string; count: number }[];
  empty: string;
}) {
  if (items.length === 0) {
    return <p className="mt-4 text-sm text-atelier-muted">{empty}</p>;
  }
  const max = items[0].count || 1;
  return (
    <div className="mt-4 space-y-2.5">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-atelier-ink">{item.label}</span>
            <span className="flex-shrink-0 font-numeral tabular-nums text-atelier-muted">{item.count}</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-atelier-ink/[0.06]">
            <div
              className="h-full rounded-full bg-atelier-ink"
              style={{ width: `${Math.round((item.count / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="ml-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
      {children}
    </h2>
  );
}

export default async function AdminDashboard() {
  // Re-checked here, not just in the admin layout: this page calls the
  // admin_traffic_daily RPC (SECURITY DEFINER over the whole page_views
  // table — hardened with its own role check in supabase/pending-2026-08-19/
  // auth-admin.sql), so the page verifies the caller's role itself as well
  // rather than trusting that the layout gate can never be sidestepped.
  await requireAdmin();
  const supabase = await createClient();

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const last14 = daysAgo(13);
  const last30 = daysAgo(29);
  // One generations window that covers both the 14-day chart and the
  // current-month credit sum (whichever reaches further back).
  const genSince = startOfMonth < last14 ? startOfMonth : last14;

  // Counts come from head:true count queries and everything row-shaped is
  // windowed and capped. The old version selected EVERY generations row and
  // EVERY profile into memory — which not only grows without bound as the
  // product does, but was already silently wrong: PostgREST caps an
  // un-limited select at 1000 rows, so past the first thousand rows every
  // "all-time" figure on this page quietly froze. Exact counts don't have
  // that cap; the explicit .limit() calls raise the row windows well past
  // current volumes and are commented where an approximation begins.
  const [
    { count: totalUsersCount },
    { count: newUsersThisWeekCount },
    { count: activeSubscribersCount },
    { count: suspendedUsersCount },
    activeSubRows,
    planRows,
    { data: recentProfileRows },
    signupRows,
    { count: generationsMonthCount },
    { count: succeededAllCount },
    { count: failedAllCount },
    { count: videoAllCount },
    { count: imageAllCount },
    { data: recentGenRows },
    genWindowRows,
    pageViews,
    reports,
    { count: openFeedbackCount },
    { count: charactersCount },
    { data: recentPurchaseRows },
    monthPurchaseRows,
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", daysAgo(7).toISOString()),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("plan_status", "active"),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("status", "suspended"),
    // MRR only needs the paying rows — a small set by definition.
    // fetchAll on every read that feeds a sum or a distribution —
    // PostgREST answers at most 1,000 rows regardless of .limit(), so these
    // "approximate past 20k" comments were actually "wrong past 1k"
    // (2026-08-31 inspection; MRR is computed from the first of these).
    fetchAll((from, to) =>
      supabase
        .from("profiles")
        .select("plan, stripe_price_id, plan_currency, plan_interval")
        .eq("plan_status", "active")
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    fetchAll((from, to) =>
      supabase.from("profiles").select("plan").order("created_at", { ascending: true }).range(from, to),
    ),
    supabase
      .from("profiles")
      .select("id, email, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    fetchAll((from, to) =>
      supabase
        .from("profiles")
        .select("created_at")
        .gte("created_at", last14.toISOString())
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    supabase
      .from("generations")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfMonth.toISOString()),
    supabase
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("status", "succeeded"),
    supabase.from("generations").select("id", { count: "exact", head: true }).eq("status", "failed"),
    supabase
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("content_type", "video"),
    supabase
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("content_type", "image"),
    supabase
      .from("generations")
      .select("id, user_id, status, credits_used, content_type, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    // Feeds the 14-day chart and the month's credit sum; approximate past
    // 20k generations in a month.
    fetchAll((from, to) =>
      supabase
        .from("generations")
        .select("created_at, credits_used, content_type, attempts")
        .gte("created_at", genSince.toISOString())
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    fetchAll((from, to) =>
      supabase
        .from("page_views")
        .select("path, referrer, country, visitor_id, created_at")
        .gte("created_at", last30.toISOString())
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    fetchAll((from, to) =>
      supabase
        .from("generation_reports")
        .select("status, source")
        .eq("status", "open")
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    supabase.from("feedback").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("character_profiles").select("id", { count: "exact", head: true }),
    supabase
      .from("credit_purchases")
      .select("id, user_id, amount_cents, currency, created_at, refunded_at")
      .order("created_at", { ascending: false })
      .limit(5),
    fetchAll((from, to) =>
      supabase
        .from("credit_purchases")
        .select("amount_cents, currency, refunded_at")
        .gte("created_at", startOfMonth.toISOString())
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
  ]);

  const allPageViews = pageViews ?? [];

  // --- Users & revenue ---
  const totalUsers = totalUsersCount ?? 0;
  const newUsersThisWeek = newUsersThisWeekCount ?? 0;
  const activeSubscribers = activeSubscribersCount ?? 0;
  const suspendedUsers = suspendedUsersCount ?? 0;
  const conversionRate = totalUsers > 0 ? (activeSubscribers / totalUsers) * 100 : 0;

  // Split by currency, not combined into one sum — see admin/billing/page.tsx
  // for why (€19 + $19 isn't a meaningful single number, even though the
  // digits match per plan under the same-number-swap pricing decision).
  //
  // Same logic as that page exactly: plan_currency / plan_interval are the
  // webhook-snapshotted truth (annual subscriptions bill on an INLINE price
  // that currencyForPriceId can't classify, and an annual subscriber's MRR
  // contribution is annualPrice, not the monthly rate). Rows from before the
  // columns existed (NULL until their next webhook event) fall back to the
  // old price-id guesses, valuing an unrecognized-price active subscription
  // at annual/12. This card previously used the naive calc and disagreed
  // with Billing about the same number on the next screen over.
  const mrrByCurrency = (activeSubRows ?? []).reduce(
    (acc, p) => {
      const plan = (p.plan ?? "none") as PlanId;
      const currency: "usd" | "eur" =
        p.plan_currency === "eur" || p.plan_currency === "usd"
          ? (p.plan_currency as "usd" | "eur")
          : currencyForPriceId(p.stripe_price_id);
      const isAnnual = p.plan_interval
        ? p.plan_interval === "year"
        : Boolean(p.stripe_price_id) && !planIdForPriceId(p.stripe_price_id);
      acc[currency] += (isAnnual ? ANNUAL_PRICE_BY_PLAN[plan] : PRICE_BY_PLAN[plan]) ?? 0;
      return acc;
    },
    { usd: 0, eur: 0 },
  );

  // Which tiers the paying subscribers are on — the MRR sub-line names them
  // ("1 paying subscriber · Starter") instead of leaving the reader to open
  // Billing for it.
  const payingPlanNames = Array.from(
    new Set((activeSubRows ?? []).map((p) => PLAN_LABELS[(p.plan ?? "none") as PlanId])),
  );

  const planDistribution = new Map<PlanId, number>(PLAN_ORDER.map((p) => [p, 0]));
  (planRows ?? []).forEach((p) => {
    const plan = (p.plan ?? "none") as PlanId;
    planDistribution.set(plan, (planDistribution.get(plan) ?? 0) + 1);
  });

  const signupsSeries = buildDailySeries(signupRows ?? [], 14);
  const recentUsers = recentProfileRows ?? [];

  // --- Generations ---
  const generationsThisMonthCount = generationsMonthCount ?? 0;
  const succeededAll = succeededAllCount ?? 0;
  const failedAll = failedAllCount ?? 0;
  const successRate =
    succeededAll + failedAll > 0 ? (succeededAll / (succeededAll + failedAll)) * 100 : null;
  const creditsThisMonth = (genWindowRows ?? [])
    .filter((g) => new Date(g.created_at) >= startOfMonth)
    .reduce((sum, g) => sum + (g.credits_used ?? 1), 0);
  const videoCount = videoAllCount ?? 0;
  const imageCount = imageAllCount ?? 0;
  const generationsAllTime = videoCount + imageCount;

  // Compute cost, ESTIMATED the same way the per-user economics report does
  // (lib/admin/economics.ts): a video costs its credit weight × the cost
  // basis the weights were derived from; an image costs IMAGE_COST_USD per
  // attempt. Provider bills are in dollars, so this figure is too.
  const computeCostUsd = (genWindowRows ?? [])
    .filter((g) => new Date(g.created_at) >= startOfMonth)
    .reduce((sum, g) => {
      if (g.content_type === "video") {
        return sum + Math.max(1, Number(g.credits_used) || 1) * COST_BASIS_USD_PER_CREDIT;
      }
      return sum + Math.max(1, Number(g.attempts) || 1) * IMAGE_COST_USD;
    }, 0);
  // Gross margin is only stated when every revenue figure is in dollars —
  // a euro plan or a euro top-up would need an invented exchange rate, and
  // the ledger would rather show a dash than a guess (see admin/billing).
  const monthPurchases = (monthPurchaseRows ?? []).filter((p) => !p.refunded_at);
  const monthPurchasesUsd = monthPurchases
    .filter((p) => (p.currency ?? "usd").toLowerCase() === "usd")
    .reduce((sum, p) => sum + (Number(p.amount_cents) || 0) / 100, 0);
  const revenueIsAllUsd =
    mrrByCurrency.eur === 0 && monthPurchases.every((p) => (p.currency ?? "usd").toLowerCase() === "usd");
  const grossMarginUsd = revenueIsAllUsd ? mrrByCurrency.usd + monthPurchasesUsd - computeCostUsd : null;
  const characters = charactersCount ?? 0;

  // buildDailySeries only buckets rows inside its window, so handing it the
  // slightly wider genSince set is fine.
  const generationsSeries = buildDailySeries(genWindowRows ?? [], 14);
  const recentGenerations = recentGenRows ?? [];

  const recentPurchases = recentPurchaseRows ?? [];
  const userIds = Array.from(
    new Set([...recentGenerations.map((g) => g.user_id), ...recentPurchases.map((p) => p.user_id)]),
  );
  const { data: genUsers } = userIds.length
    ? await supabase.from("profiles").select("id, email").in("id", userIds)
    : { data: [] as { id: string; email: string }[] };
  const emailById = new Map((genUsers ?? []).map((u) => [u.id, u.email]));

  // --- Traffic (last 30 days) ---
  const pageViewsLast30 = allPageViews.length;
  const uniqueVisitors30 = new Set(allPageViews.map((v) => v.visitor_id)).size;
  const trafficSeries = buildDailySeries(allPageViews, 14);
  const topPages = topN(
    allPageViews.map((v) => v.path),
    5,
    "(unknown)",
  );
  const topReferrers = topN(
    allPageViews.map((v) => hostnameOf(v.referrer)),
    5,
    "Direct / unknown",
  );
  const topCountries = topN(
    allPageViews.map((v) => v.country),
    5,
    "Unknown",
  );

  // --- Health ---
  const openReports = reports ?? []; // query already filters to status=open
  const openReportsAuto = openReports.filter((r) => r.source === "auto").length;
  const openReportsUser = openReports.length - openReportsAuto;
  const openFeedback = openFeedbackCount ?? 0;

  // Board B's row anatomy: a serif day-word column, the account and what it
  // did, and a right-hand serif value — ochre when it is money. Purchases
  // join signups and renders here so the ledger's money rows are real ones.
  const dayWord = (iso: string): string => {
    const d = new Date(iso);
    const today = startOfDay(new Date());
    if (d >= today) return "Today";
    if (d >= daysAgo(1)) return "Yesterday";
    if (d >= daysAgo(6)) return "This week";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };
  const money = (cents: number, currency: string | null) =>
    `${(currency ?? "usd").toLowerCase() === "eur" ? "€" : "$"}${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

  const activity = [
    ...recentUsers.map((u) => ({
      key: `user-${u.id}`,
      created_at: u.created_at,
      title: u.email,
      sub: `Signed up · ${timeAgo(u.created_at)}`,
      value: "",
      tone: "muted" as const,
    })),
    ...recentGenerations.map((g) => ({
      key: `gen-${g.id}`,
      created_at: g.created_at,
      title: emailById.get(g.user_id) ?? "Someone",
      sub: `${g.content_type === "video" ? "Video" : "Image"} render · ${g.status} · ${timeAgo(g.created_at)}`,
      value: g.status === "succeeded" ? `${g.credits_used ?? 1} cr` : g.status,
      tone: g.status === "succeeded" ? ("ink" as const) : ("muted" as const),
    })),
    ...recentPurchases.map((p) => ({
      key: `buy-${p.id}`,
      created_at: p.created_at,
      title: emailById.get(p.user_id) ?? "Someone",
      sub: `Credit pack${p.refunded_at ? " · refunded" : ""} · ${timeAgo(p.created_at)}`,
      value: money(Number(p.amount_cents) || 0, p.currency as string | null),
      tone: p.refunded_at ? ("muted" as const) : ("money" as const),
    })),
  ]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8);

  // The totals band under the activity (board B): the week in three numbers.
  const last7 = (series: { count: number }[]) => series.slice(-7).reduce((sum, d) => sum + d.count, 0);
  const totals7 = { signups: last7(signupsSeries), renders: last7(generationsSeries), views: last7(trafficSeries) };

  // Aggregated in Postgres (see the admin_traffic_daily migration) rather
  // than grouping the raw page_views rows already fetched above — that set is
  // capped for the other cards and would undercount once traffic grows.
  const { data: trafficRows } = await supabase.rpc("admin_traffic_daily", { days: 14 });
  const traffic: TrafficDay[] = (trafficRows ?? []).map(
    (r: { day: string; views: number; visitors: number }) => ({
      day: String(r.day),
      views: Number(r.views),
      visitors: Number(r.visitors),
    }),
  );

  return (
    <div>
      {/* THE LEDGER (operator pick B, 2026-09-03): the overview reads as
          the studio's ledger — serif title, a period stamp, and the four
          KPIs as spec-sheet columns inside ONE sheet (the product's receipt
          idiom), money in ochre serif. Same data, same queries. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
            Studio ledger
          </p>
          <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">Overview</h1>
        </div>
        <div className="text-right">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">Period</p>
          <p className="mt-1 font-numeral text-[15px] leading-[22px] tabular-nums text-atelier-ink">
            Last 14 days · to{" "}
            {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
      </div>

      <Card className="mt-6 px-0 py-5">
        <dl className="grid divide-y divide-atelier-rule sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          {[
            {
              label: "MRR",
              value: (
                <>
                  ${mrrByCurrency.usd}
                  {mrrByCurrency.eur > 0 && <span className="text-atelier-muted"> + €{mrrByCurrency.eur}</span>}
                </>
              ),
              sub: `${activeSubscribers} paying subscriber${activeSubscribers === 1 ? "" : "s"}${
                payingPlanNames.length ? ` · ${payingPlanNames.join(" · ")}` : ""
              }`,
              money: true,
            },
            { label: "Total users", value: totalUsers, sub: `+${newUsersThisWeek} in the last 7 days`, money: false },
            {
              label: "Generations · this month",
              value: generationsThisMonthCount,
              sub: `${generationsAllTime} all-time · ${succeededAll} succeeded${
                successRate === null ? "" : ` (${successRate.toFixed(0)}%)`
              }`,
              money: false,
            },
            { label: "Conversion rate", value: `${conversionRate.toFixed(1)}%`, sub: "free → paid · all-time", money: false },
          ].map((kpi) => (
            <div key={kpi.label} className="px-7 py-1">
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
                {kpi.label}
              </dt>
              <dd
                className={cn(
                  "mt-2 font-numeral text-[40px] leading-[44px] tabular-nums",
                  kpi.money ? "text-atelier-accent" : "text-atelier-ink",
                )}
              >
                {kpi.value}
              </dd>
              <dd className="mt-1.5 text-[12.5px] leading-[18px] text-atelier-muted">{kpi.sub}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="mt-6">
        <TrafficChart data={traffic} />
      </div>

      {/* Growth */}
      <div className="mt-6">
        <SectionLabel>Growth · 14 days, daily</SectionLabel>
        <div className="mt-2.5 grid gap-6 lg:grid-cols-3">
          {[
            { label: "Signups", series: signupsSeries },
            { label: "Generations", series: generationsSeries },
            { label: "Page views", series: trafficSeries },
          ].map((g) => (
            <Card key={g.label}>
              <div className="flex items-start justify-between">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
                  {g.label}
                </p>
                <div className="text-right">
                  <p className="font-numeral text-[22px] leading-none tabular-nums text-atelier-ink">
                    {g.series.reduce((sum, d) => sum + d.count, 0)}
                  </p>
                  <p className="mt-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
                    last 14 days
                  </p>
                </div>
              </div>
              <DailyBars data={g.series} />
            </Card>
          ))}
        </div>
      </div>

      {/* Revenue & health */}
      <div className="mt-6">
        <SectionLabel>Revenue &amp; health</SectionLabel>
        <div className="mt-2.5 grid gap-6 lg:grid-cols-2">
          <Card>
            <div className="flex items-baseline justify-between">
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
                Plan distribution
              </h3>
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
                of {totalUsers} user{totalUsers === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-2 divide-y divide-atelier-rule">
              {PLAN_ORDER.map((plan) => {
                const count = planDistribution.get(plan) ?? 0;
                const pct = Math.round((count / (totalUsers || 1)) * 100);
                return (
                  <div key={plan} className="flex h-7 items-center gap-3">
                    <span className="w-[60px] flex-shrink-0 text-[12.5px] text-atelier-ink">
                      {plan === "none" ? "Free" : PLAN_LABELS[plan]}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-atelier-ink/[0.06]">
                      <div className="h-full rounded-full bg-atelier-ink" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-7 flex-shrink-0 text-right font-numeral text-sm tabular-nums text-atelier-ink">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <div className="flex items-baseline justify-between">
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
                Economics
              </h3>
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
                estimates marked ≈
              </span>
            </div>
            <dl className="mt-2 divide-y divide-atelier-rule">
              {[
                {
                  label: "Render success",
                  qual: "all-time",
                  value: `${succeededAll} / ${succeededAll + failedAll}${successRate === null ? "" : ` · ${successRate.toFixed(0)}%`}`,
                },
                { label: "Video / image", qual: "all-time", value: `${videoCount} / ${imageCount}` },
                {
                  label: "Open reports",
                  value: `${openReports.length}${openReports.length ? ` · ${openReportsAuto} auto / ${openReportsUser} user` : ""}`,
                  href: openReports.length ? "/admin/reports" : undefined,
                },
                {
                  label: "Open feedback",
                  value: `${openFeedback}${suspendedUsers ? ` · ${suspendedUsers} suspended` : ""}`,
                  href: openFeedback ? "/admin/feedback" : undefined,
                },
                { label: "Characters on the platform", value: String(characters) },
                { label: "Credits consumed", qual: "this month", value: String(creditsThisMonth) },
                { label: "Compute cost", qual: "this month", value: `≈ $${computeCostUsd.toFixed(2)}` },
                {
                  label: "Gross margin",
                  qual: "this month",
                  value: grossMarginUsd === null ? "—" : `≈ $${grossMarginUsd.toFixed(2)}`,
                  money: grossMarginUsd !== null,
                },
              ].map((row) => (
                <div key={row.label} className="flex h-7 items-center justify-between gap-3">
                  <dt className="text-[12.5px] text-atelier-ink">
                    {row.href ? (
                      <Link href={row.href} className="underline decoration-atelier-rule underline-offset-4 hover:decoration-atelier-ink">
                        {row.label}
                      </Link>
                    ) : (
                      row.label
                    )}
                    {row.qual && <span className="ml-2 text-[11.5px] text-atelier-muted">{row.qual}</span>}
                  </dt>
                  <dd
                    className={cn(
                      "font-numeral text-sm tabular-nums",
                      row.money ? "text-atelier-accent" : "text-atelier-ink",
                    )}
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>

      {/* Traffic sources */}
      <div className="mt-6">
        <SectionLabel>Traffic sources · 30 days</SectionLabel>
        <div className="mt-2.5 grid gap-6 lg:grid-cols-3">
          {[
            { label: "Top pages", note: `${pageViewsLast30} views`, items: topPages, empty: "No page views recorded yet." },
            { label: "Top referrers", note: `${uniqueVisitors30} visitors`, items: topReferrers, empty: "No referrer data yet." },
            { label: "Top countries", note: "", items: topCountries, empty: "No location data yet." },
          ].map((col) => (
            <Card key={col.label}>
              <div className="flex items-baseline justify-between">
                <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
                  {col.label}
                </h3>
                {col.note && (
                  <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
                    {col.note}
                  </span>
                )}
              </div>
              <TopList items={col.items} empty={col.empty} />
            </Card>
          ))}
        </div>
      </div>

      {/* Recent activity */}
      <Card className="mt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
            Recent activity
          </h2>
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">Latest</span>
        </div>
        {activity.length === 0 ? (
          <p className="mt-3 text-sm text-atelier-muted">Nothing yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-atelier-rule">
            {activity.map((item) => (
              <li key={item.key} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 py-[11px]">
                <span className="font-numeral text-[12.5px] italic text-atelier-muted">
                  {dayWord(item.created_at)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] text-atelier-ink">{item.title}</p>
                  <p className="text-xs text-atelier-muted">{item.sub}</p>
                </div>
                <span
                  className={cn(
                    "font-numeral text-[15px] tabular-nums",
                    item.tone === "money"
                      ? "text-atelier-accent"
                      : item.tone === "ink"
                        ? "text-atelier-ink"
                        : "text-atelier-muted",
                  )}
                >
                  {item.value}
                </span>
              </li>
            ))}
          </ul>
        )}
        {/* The sum-rule: a full-ink rule, not a hairline — the ledger's
            "total" line. */}
        <div className="mt-4 border-t border-atelier-ink pt-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
            Totals · last 7 days
          </p>
          <div className="-mx-3.5 mt-2.5 flex divide-x divide-atelier-rule">
            {[
              ["Signups", totals7.signups],
              ["Renders", totals7.renders],
              ["Page views", totals7.views],
              ["Open reports", openReports.length],
            ].map(([label, n]) => (
              <div key={String(label)} className="px-3.5">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">{label}</p>
                <p className="mt-0.5 font-numeral text-[20px] leading-6 tabular-nums text-atelier-ink">{n}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
