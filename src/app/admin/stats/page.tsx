import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getFalBalance } from "@/lib/generations/providers/fal-ledger";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { cn } from "@/lib/cn";
import { fetchAll } from "@/lib/admin/fetch-all";

// Stats, the Jetpack way (2026-08-29, operator: "I don't like it and it's
// confusing… Jetpack stats is very clean and useful"). The page leads with
// the one thing the old version never had — TIME: a daily views chart with
// 7/30/90-day tabs, a range summary with deltas vs the previous equal
// period, and a Today row vs yesterday. Then the Jetpack-style ranked
// lists (pages, referrers, countries) with quiet fill bars, and only then
// the operational extras (provider funds, adoption, audience).
//
// Chart color note: a single magnitude series in neutral ink with TODAY
// emphasized in ochre — deliberately not a categorical palette (one
// series has no identity problem; the dataviz validator's categorical
// checks don't apply, and the emphasis pair passes CVD separation 31.9
// and 3:1 contrast on white).

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayLabel(key: string): string {
  return new Date(key + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function Delta({ now, prev }: { now: number; prev: number }) {
  if (prev === 0 && now === 0) return <span className="text-xs text-neutral-400">—</span>;
  const pct = prev === 0 ? 100 : Math.round(((now - prev) / prev) * 100);
  const up = pct >= 0;
  return (
    <span className={cn("text-xs font-medium tabular-nums", up ? "text-emerald-600" : "text-red-500")}>
      {up ? "↑" : "↓"} {Math.abs(pct)}%
    </span>
  );
}

// A Jetpack-style ranked row: quiet fill behind, label left, count right.
function RankedList({ items, total, empty }: { items: [string, number][]; total: number; empty: string }) {
  if (items.length === 0) return <p className="mt-3 text-sm text-neutral-400">{empty}</p>;
  const max = items[0]?.[1] ?? 1;
  return (
    <ul className="mt-3">
      {items.map(([label, count]) => {
        const fill = Math.max(4, Math.round((count / max) * 100));
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <li key={label} className="relative overflow-hidden rounded-[6px]">
            <span className="absolute inset-y-0.5 left-0 rounded-[5px] bg-neutral-100" style={{ width: `${fill}%` }} />
            <span className="relative flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
              <span className="min-w-0 truncate text-neutral-800">{label}</span>
              <span className="flex-shrink-0 tabular-nums text-neutral-500">
                {count.toLocaleString()} <span className="text-neutral-300">·</span>{" "}
                <span className="text-neutral-400">{pct}%</span>
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function topCounts(values: (string | null | undefined)[], limit = 8): [string, number][] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const v = raw && raw.trim() ? raw : "Unknown";
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function referrerBucket(ref: string | null): string {
  if (!ref) return "Direct";
  try {
    const host = new URL(ref).hostname.replace(/^www\./, "");
    if (host.endsWith("picacho.ai") || host === "localhost") return "__self__";
    return host;
  } catch {
    return "Direct";
  }
}

const STANDARD_GENDERS = ["Woman", "Man", "Non-binary"];

export default async function AdminStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rangeParam } = await searchParams;
  const range: Range = RANGES.includes(Number(rangeParam) as Range) ? (Number(rangeParam) as Range) : 30;

  const supabase = await createClient();
  const now = new Date();
  const DAY = 24 * 60 * 60 * 1000;
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const rangeStart = new Date(now.getTime() - (range - 1) * DAY);
  rangeStart.setUTCHours(0, 0, 0, 0);
  // The previous equal period, for the deltas.
  const prevStart = new Date(rangeStart.getTime() - range * DAY);

  const [
    { count: totalUsers },
    { count: onlineNow },
    viewRows,
    prevViewRows,
    signupRows,
    { count: prevSignups },
    genRows,
    { count: prevGens },
    adoptionRows,
    demographicRows,
    falBalance,
  ] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }),
    supabase.from("profiles").select("*", { count: "exact", head: true }).gte("last_seen_at", fiveMinAgo),
    // fetchAll, not .limit(): PostgREST answers at most 1,000 rows per
    // response whatever the limit says, and these charts were silently
    // under-counting the moment traffic passed that (2026-08-31, verified
    // live: 1,839 rows existed, 1,000 came back).
    fetchAll((from, to) =>
      supabase
        .from("page_views")
        .select("created_at, visitor_id, path, country, referrer")
        .gte("created_at", rangeStart.toISOString())
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    fetchAll((from, to) =>
      supabase
        .from("page_views")
        .select("visitor_id")
        .gte("created_at", prevStart.toISOString())
        .lt("created_at", rangeStart.toISOString())
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    fetchAll((from, to) =>
      supabase
        .from("profiles")
        .select("created_at")
        .gte("created_at", rangeStart.toISOString())
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .gte("created_at", prevStart.toISOString())
      .lt("created_at", rangeStart.toISOString()),
    fetchAll((from, to) =>
      supabase
        .from("generations")
        .select("created_at")
        .gte("created_at", rangeStart.toISOString())
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    supabase
      .from("generations")
      .select("*", { count: "exact", head: true })
      .gte("created_at", prevStart.toISOString())
      .lt("created_at", rangeStart.toISOString()),
    fetchAll((from, to) =>
      supabase
        .from("generations")
        .select("user_id, content_type")
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    fetchAll((from, to) =>
      supabase.from("profiles").select("gender, company").order("created_at", { ascending: true }).range(from, to),
    ),
    // The ledger's ADMIN-key reader, not fal.ts's FAL_KEY one — verified
    // live (2026-08-31): FAL_KEY gets 403 on account/billing, FAL_ADMIN_KEY
    // gets 200, so this panel had been permanently dead since it shipped.
    getFalBalance().then((b) =>
      b.ok
        ? ({ ok: true, balance: b.balanceUsd, currency: b.currency } as const)
        : ({ ok: false, reason: b.error } as const),
    ),
  ]);

  // ---- daily buckets for the chart ----
  const days: string[] = [];
  for (let i = 0; i < range; i++) days.push(dayKey(new Date(rangeStart.getTime() + i * DAY)));
  const viewsByDay = new Map<string, number>(days.map((d) => [d, 0]));
  const visitorsByDay = new Map<string, Set<string>>(days.map((d) => [d, new Set()]));
  for (const r of viewRows ?? []) {
    const k = (r.created_at as string).slice(0, 10);
    if (viewsByDay.has(k)) {
      viewsByDay.set(k, (viewsByDay.get(k) ?? 0) + 1);
      visitorsByDay.get(k)?.add(r.visitor_id as string);
    }
  }
  const maxViews = Math.max(1, ...days.map((d) => viewsByDay.get(d) ?? 0));
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(new Date(now.getTime() - DAY));

  // ---- range totals + previous-period deltas ----
  const totalViews = (viewRows ?? []).length;
  const totalVisitors = new Set((viewRows ?? []).map((r) => r.visitor_id)).size;
  const prevViews = (prevViewRows ?? []).length;
  const prevVisitors = new Set((prevViewRows ?? []).map((r) => r.visitor_id)).size;
  const totalSignups = (signupRows ?? []).length;
  const totalGens = (genRows ?? []).length;

  // ---- today vs yesterday ----
  const todayViews = viewsByDay.get(todayKey) ?? 0;
  const yViews = viewsByDay.get(yesterdayKey) ?? 0;
  const todayVisitors = visitorsByDay.get(todayKey)?.size ?? 0;
  const yVisitors = visitorsByDay.get(yesterdayKey)?.size ?? 0;
  const todaySignups = (signupRows ?? []).filter((r) => (r.created_at as string).slice(0, 10) === todayKey).length;
  const ySignups = (signupRows ?? []).filter((r) => (r.created_at as string).slice(0, 10) === yesterdayKey).length;
  const todayGens = (genRows ?? []).filter((r) => (r.created_at as string).slice(0, 10) === todayKey).length;
  const yGens = (genRows ?? []).filter((r) => (r.created_at as string).slice(0, 10) === yesterdayKey).length;

  // ---- ranked lists (range-scoped) ----
  const topPages = topCounts((viewRows ?? []).map((r) => r.path as string));
  const referrers = topCounts(
    (viewRows ?? []).map((r) => referrerBucket(r.referrer as string | null)),
  ).filter(([label]) => label !== "__self__");
  const topCountries = topCounts((viewRows ?? []).map((r) => r.country as string | null));

  // ---- adoption + audience (unchanged data, tidier home) ----
  const total = totalUsers ?? 0;
  const uniqueVideoUsers = new Set((adoptionRows ?? []).filter((r) => r.content_type === "video").map((r) => r.user_id)).size;
  const uniqueImageUsers = new Set((adoptionRows ?? []).filter((r) => r.content_type === "image").map((r) => r.user_id)).size;

  const genderCounts = new Map<string, number>();
  (demographicRows ?? []).forEach((r) => {
    const g = r.gender as string | null;
    const bucket = !g ? "Not specified" : STANDARD_GENDERS.includes(g) ? g : "Self-described";
    genderCounts.set(bucket, (genderCounts.get(bucket) ?? 0) + 1);
  });
  const genderItems = Array.from(genderCounts.entries()).sort((a, b) => b[1] - a[1]);
  const companies = (demographicRows ?? []).filter((r) => r.company);
  const topCompanies = topCounts(companies.map((r) => r.company as string), 8);

  const summary = [
    { label: "Views", now: totalViews, prev: prevViews },
    { label: "Visitors", now: totalVisitors, prev: prevVisitors },
    { label: "Signups", now: totalSignups, prev: prevSignups ?? 0 },
    { label: "Renders", now: totalGens, prev: prevGens ?? 0 },
  ];
  const today = [
    { label: "Views today", now: todayViews, prev: yViews },
    { label: "Visitors today", now: todayVisitors, prev: yVisitors },
    { label: "Signups today", now: todaySignups, prev: ySignups },
    { label: "Renders today", now: todayGens, prev: yGens },
  ];

  return (
    <div>
      <AutoRefresh intervalMs={30_000} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Stats</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {total.toLocaleString()} users all-time · {onlineNow ?? 0} online now · refreshes every 30s
          </p>
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-full border border-neutral-200 bg-white p-1">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/admin/stats?range=${r}`}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                r === range ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-neutral-900",
              )}
            >
              {r} days
            </Link>
          ))}
        </div>
      </div>

      {/* The chart: one bar per day, today in ochre. Hover a bar for the
          exact numbers (native tooltip — this is a server component). */}
      <Card className="mt-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">Views per day</h2>
          <span className="text-xs tabular-nums text-neutral-400">peak {maxViews.toLocaleString()}</span>
        </div>
        <div className="mt-4 flex h-40 items-end gap-[2px]">
          {days.map((d) => {
            const v = viewsByDay.get(d) ?? 0;
            const h = Math.max(v > 0 ? 3 : 1, Math.round((v / maxViews) * 100));
            const isToday = d === todayKey;
            return (
              <div
                key={d}
                title={`${dayLabel(d)} — ${v.toLocaleString()} views · ${visitorsByDay.get(d)?.size ?? 0} visitors`}
                className="group relative flex-1"
                style={{ height: "100%" }}
              >
                <div
                  className={cn(
                    "absolute bottom-0 left-0 right-0 rounded-t-[4px] transition-colors",
                    isToday ? "bg-ochre" : "bg-neutral-900 group-hover:bg-neutral-600",
                  )}
                  style={{ height: `${h}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-neutral-400">
          <span>{dayLabel(days[0])}</span>
          {range >= 30 && <span>{dayLabel(days[Math.floor(days.length / 2)])}</span>}
          <span className="font-medium text-ochre">{dayLabel(days[days.length - 1])} (today)</span>
        </div>

        {/* Range totals with previous-equal-period deltas. */}
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-neutral-100 pt-4 sm:grid-cols-4">
          {summary.map((s) => (
            <div key={s.label}>
              <p className="text-xs text-neutral-500">{s.label}</p>
              <p className="mt-0.5 flex items-baseline gap-2">
                <span className="text-xl font-semibold tabular-nums text-neutral-900">
                  {s.now.toLocaleString()}
                </span>
                <Delta now={s.now} prev={s.prev} />
              </p>
              <p className="text-[10px] text-neutral-400">vs previous {range} days</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Today vs yesterday — the numbers you check every morning. */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {today.map((s) => (
          <Card key={s.label} className="py-4">
            <p className="text-xs text-neutral-500">{s.label}</p>
            <p className="mt-0.5 flex items-baseline gap-2">
              <span className="text-xl font-semibold tabular-nums text-neutral-900">
                {s.now.toLocaleString()}
              </span>
              <Delta now={s.now} prev={s.prev} />
            </p>
            <p className="text-[10px] text-neutral-400">vs yesterday</p>
          </Card>
        ))}
      </div>

      {/* Jetpack's ranked lists, scoped to the selected range. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="text-sm font-semibold text-neutral-900">Top pages</h2>
          <RankedList items={topPages} total={totalViews} empty="No views in this range." />
        </Card>
        <Card>
          <h2 className="text-sm font-semibold text-neutral-900">Referrers</h2>
          <p className="mt-0.5 text-[11px] text-neutral-400">Where visitors came from — internal navigation excluded.</p>
          <RankedList items={referrers} total={totalViews} empty="No referred visits yet." />
        </Card>
        <Card>
          <h2 className="text-sm font-semibold text-neutral-900">Countries</h2>
          <RankedList items={topCountries} total={totalViews} empty="No views in this range." />
        </Card>
      </div>

      {/* Operational extras — unchanged data, below the fold on purpose. */}
      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-900">AI provider funds</h2>
        <div className="mt-3 divide-y divide-neutral-100">
          <div className="flex items-center justify-between py-2.5">
            <div>
              <p className="text-sm text-neutral-900">fal.ai</p>
              <p className="mt-0.5 text-xs text-neutral-400">Video, Flux images, ElevenLabs + Sync Labs</p>
            </div>
            {falBalance.ok ? (
              <p className="text-lg font-semibold tabular-nums text-neutral-900">
                {falBalance.currency === "USD" ? "$" : `${falBalance.currency} `}
                {falBalance.balance.toFixed(2)}
              </p>
            ) : (
              <div className="text-right">
                <Badge tone="warning">unavailable</Badge>
                <p className="mt-1 max-w-64 text-xs text-neutral-400">{falBalance.reason}</p>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between py-2.5">
            <p className="text-sm text-neutral-900">OpenAI</p>
            <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer" className="text-xs text-neutral-500 underline hover:text-neutral-900">
              Check on OpenAI →
            </a>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <p className="text-sm text-neutral-900">Anthropic</p>
            <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noreferrer" className="text-xs text-neutral-500 underline hover:text-neutral-900">
              Check on Anthropic →
            </a>
          </div>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="text-sm font-semibold text-neutral-900">Feature adoption</h2>
          <p className="mt-0.5 text-[11px] text-neutral-400">Share of all users, all-time.</p>
          <RankedList
            items={[
              ["Any generation", new Set((adoptionRows ?? []).map((r) => r.user_id)).size],
              ["Videos", uniqueVideoUsers],
              ["Images", uniqueImageUsers],
            ]}
            total={total}
            empty="No usage yet."
          />
        </Card>
        <Card>
          <h2 className="text-sm font-semibold text-neutral-900">Gender</h2>
          <p className="mt-0.5 text-[11px] text-neutral-400">Self-reported, optional.</p>
          <RankedList items={genderItems} total={total} empty="No data yet." />
        </Card>
        <Card>
          <h2 className="text-sm font-semibold text-neutral-900">Company</h2>
          <p className="mt-0.5 text-[11px] text-neutral-400">
            {total > 0 ? Math.round((companies.length / total) * 100) : 0}% of users set one.
          </p>
          <RankedList items={topCompanies} total={companies.length} empty="No data yet." />
        </Card>
      </div>
    </div>
  );
}
