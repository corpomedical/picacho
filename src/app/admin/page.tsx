import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { Card } from "@/components/ui/card";
import { TrafficChart, type TrafficDay } from "@/components/admin/traffic-chart";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { PLAN_LABELS, type PlanId } from "@/lib/plans";
import { PRICING_TIERS } from "@/lib/pricing";
import { currencyForPriceId, planIdForPriceId } from "@/lib/stripe/plans";

const PRICE_BY_PLAN: Record<string, number> = Object.fromEntries(
  PRICING_TIERS.map((t) => [t.id, t.price]),
);

// Monthly-equivalent value of an annual subscription — annual bills
// tier.annualPrice * 12 once a year, so its MRR contribution is annualPrice.
// Same constant and reasoning as admin/billing/page.tsx.
const ANNUAL_PRICE_BY_PLAN: Record<string, number> = Object.fromEntries(
  PRICING_TIERS.map((t) => [t.id, t.annualPrice]),
);

const PLAN_ORDER: PlanId[] = ["elite", "studio", "growth", "starter", "basic", "none"];

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

function dayLabel(key: string) {
  const d = new Date(`${key}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

function DailyBars({
  data,
  colorClass = "bg-neutral-900",
}: {
  data: { date: string; count: number }[];
  colorClass?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="mt-4 flex h-16 items-end gap-1">
      {data.map((d) => (
        <div
          key={d.date}
          title={`${dayLabel(d.date)}: ${d.count}`}
          className={cn("flex-1 rounded-t-[3px] transition-all", colorClass)}
          style={{
            height: `${Math.max(4, (d.count / max) * 100)}%`,
            opacity: d.count === 0 ? 0.12 : 1,
          }}
        />
      ))}
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
    return <p className="mt-4 text-sm text-neutral-500">{empty}</p>;
  }
  const max = items[0].count || 1;
  return (
    <div className="mt-4 space-y-2.5">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-neutral-700">{item.label}</span>
            <span className="flex-shrink-0 text-neutral-400">{item.count}</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-neutral-900"
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
    <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
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
    { data: activeSubRows },
    { data: planRows },
    { data: recentProfileRows },
    { data: signupRows },
    { count: generationsMonthCount },
    { count: succeededAllCount },
    { count: failedAllCount },
    { count: videoAllCount },
    { count: imageAllCount },
    { data: recentGenRows },
    { data: genWindowRows },
    { data: pageViews },
    { data: reports },
    { count: openFeedbackCount },
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
    supabase
      .from("profiles")
      .select("plan, stripe_price_id, plan_currency, plan_interval")
      .eq("plan_status", "active")
      .limit(10000),
    // One narrow column for the distribution chart; approximate past 20k users.
    supabase.from("profiles").select("plan").limit(20000),
    supabase
      .from("profiles")
      .select("id, email, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("profiles")
      .select("created_at")
      .gte("created_at", last14.toISOString())
      .limit(20000),
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
      .select("id, user_id, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    // Feeds the 14-day chart and the month's credit sum; approximate past
    // 20k generations in a month.
    supabase
      .from("generations")
      .select("created_at, credits_used")
      .gte("created_at", genSince.toISOString())
      .limit(20000),
    supabase
      .from("page_views")
      .select("path, referrer, country, visitor_id, created_at")
      .gte("created_at", last30.toISOString())
      .limit(20000),
    supabase.from("generation_reports").select("status, source").eq("status", "open").limit(5000),
    supabase.from("feedback").select("id", { count: "exact", head: true }).eq("status", "open"),
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

  // buildDailySeries only buckets rows inside its window, so handing it the
  // slightly wider genSince set is fine.
  const generationsSeries = buildDailySeries(genWindowRows ?? [], 14);
  const recentGenerations = recentGenRows ?? [];

  const userIds = Array.from(new Set(recentGenerations.map((g) => g.user_id)));
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

  const activity = [
    ...recentUsers.map((u) => ({
      key: `user-${u.id}`,
      created_at: u.created_at,
      node: (
        <>
          <span className="font-medium text-neutral-900">{u.email}</span> signed up
        </>
      ),
    })),
    ...recentGenerations.map((g) => ({
      key: `gen-${g.id}`,
      created_at: g.created_at,
      node: (
        <>
          <span className="font-medium text-neutral-900">
            {emailById.get(g.user_id) ?? "Someone"}
          </span>{" "}
          generated &mdash;{" "}
          {g.status === "succeeded" ? (
            <Badge tone="success">succeeded</Badge>
          ) : g.status === "failed" ? (
            <Badge tone="danger">failed</Badge>
          ) : (
            <Badge tone="neutral">{g.status}</Badge>
          )}
        </>
      ),
    })),
  ]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8);

  // Aggregated in Postgres (see the admin_traffic_daily migration) rather
  // than grouping the raw page_views rows already fetched above — that set is
  // capped for the other cards and would undercount once traffic grows.
  const { data: trafficRows } = await supabase.rpc("admin_traffic_daily", { days: 30 });
  const traffic: TrafficDay[] = (trafficRows ?? []).map(
    (r: { day: string; views: number; visitors: number }) => ({
      day: String(r.day),
      views: Number(r.views),
      visitors: Number(r.visitors),
    }),
  );

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900">Dashboard</h1>

      <div className="mt-6">
        <TrafficChart data={traffic} />
      </div>

      {/* Overview */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-neutral-500">MRR</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">
            ${mrrByCurrency.usd}
            {mrrByCurrency.eur > 0 && (
              <span className="text-neutral-400"> + €{mrrByCurrency.eur}</span>
            )}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            {activeSubscribers} paying subscriber{activeSubscribers === 1 ? "" : "s"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-neutral-500">Total users</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{totalUsers}</p>
          <p className="mt-1 text-xs text-neutral-400">
            +{newUsersThisWeek} in the last 7 days
          </p>
        </Card>
        <Card>
          <p className="text-sm text-neutral-500">Generations this month</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">
            {generationsThisMonthCount}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            {creditsThisMonth} credit{creditsThisMonth === 1 ? "" : "s"} consumed
          </p>
        </Card>
        <Card>
          <p className="text-sm text-neutral-500">Conversion rate</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">
            {conversionRate.toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-neutral-400">Free &rarr; paid, all-time</p>
        </Card>
      </div>

      {/* Growth */}
      <div className="mt-8">
        <SectionLabel>Growth &mdash; last 14 days</SectionLabel>
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <Card>
            <p className="text-sm text-neutral-500">Signups</p>
            <p className="mt-1 text-xl font-semibold text-neutral-900">
              {signupsSeries.reduce((s, d) => s + d.count, 0)}
            </p>
            <DailyBars data={signupsSeries} />
          </Card>
          <Card>
            <p className="text-sm text-neutral-500">Generations</p>
            <p className="mt-1 text-xl font-semibold text-neutral-900">
              {generationsSeries.reduce((s, d) => s + d.count, 0)}
            </p>
            <DailyBars data={generationsSeries} />
          </Card>
          <Card>
            <p className="text-sm text-neutral-500">Page views</p>
            <p className="mt-1 text-xl font-semibold text-neutral-900">
              {trafficSeries.reduce((s, d) => s + d.count, 0)}
            </p>
            <DailyBars data={trafficSeries} colorClass="bg-neutral-400" />
          </Card>
        </div>
      </div>

      {/* Revenue & health */}
      <div className="mt-8">
        <SectionLabel>Revenue &amp; health</SectionLabel>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">Plan distribution</h3>
              <Link href="/admin/billing" className="text-xs text-neutral-400 hover:text-neutral-900">
                Billing &rarr;
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {PLAN_ORDER.map((plan) => {
                const count = planDistribution.get(plan) ?? 0;
                const total = totalUsers || 1;
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={plan}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-neutral-700">{PLAN_LABELS[plan]}</span>
                      <span className="text-neutral-500">{count}</span>
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

          <Card>
            <h3 className="text-sm font-semibold text-neutral-900">Platform health</h3>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-neutral-500">Success rate</p>
                <p className="mt-1 text-xl font-semibold text-neutral-900">
                  {successRate === null ? "—" : `${successRate.toFixed(0)}%`}
                </p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {succeededAll} ok / {failedAll} failed
                </p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Video / image</p>
                <p className="mt-1 text-xl font-semibold text-neutral-900">
                  {videoCount} / {imageCount}
                </p>
                <p className="mt-0.5 text-xs text-neutral-400">All-time split</p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Open reports</p>
                <p className="mt-1 text-xl font-semibold text-neutral-900">
                  {openReports.length}
                </p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {openReportsAuto} auto / {openReportsUser} user
                </p>
                {openReports.length > 0 && (
                  <Link
                    href="/admin/reports"
                    className="mt-1 inline-block text-xs text-neutral-900 underline"
                  >
                    Review
                  </Link>
                )}
              </div>
              <div>
                <p className="text-xs text-neutral-500">Open feedback</p>
                <p className="mt-1 text-xl font-semibold text-neutral-900">{openFeedback}</p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {suspendedUsers} account{suspendedUsers === 1 ? "" : "s"} suspended
                </p>
                {openFeedback > 0 && (
                  <Link
                    href="/admin/feedback"
                    className="mt-1 inline-block text-xs text-neutral-900 underline"
                  >
                    Review
                  </Link>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Traffic sources */}
      <div className="mt-8">
        <SectionLabel>Traffic &mdash; last 30 days</SectionLabel>
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <Card>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">Top pages</h3>
              <span className="text-xs text-neutral-400">{pageViewsLast30} views</span>
            </div>
            <TopList items={topPages} empty="No page views recorded yet." />
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">Top referrers</h3>
              <span className="text-xs text-neutral-400">{uniqueVisitors30} visitors</span>
            </div>
            <TopList items={topReferrers} empty="No referrer data yet." />
          </Card>
          <Card>
            <h3 className="text-sm font-semibold text-neutral-900">Top countries</h3>
            <TopList items={topCountries} empty="No location data yet." />
          </Card>
        </div>
      </div>

      {/* Recent activity */}
      <Card className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-900">Recent activity</h2>
        {activity.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">Nothing yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {activity.map((item) => (
              <li key={item.key} className="flex items-start justify-between gap-4 text-sm">
                <p className="text-neutral-600">{item.node}</p>
                <span className="flex-shrink-0 text-xs text-neutral-400">
                  {timeAgo(item.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
