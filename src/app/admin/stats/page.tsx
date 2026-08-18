import { createClient } from "@/lib/supabase/server";
import { getFalAccountBalance } from "@/lib/generations/providers/fal";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/auto-refresh";

const STANDARD_GENDERS = ["Woman", "Man", "Non-binary"];

function topCounts(rows: Record<string, unknown>[] | null, key: string, limit = 8) {
  const counts = new Map<string, number>();
  (rows ?? []).forEach((r) => {
    const raw = r[key];
    const value = typeof raw === "string" && raw.trim() ? raw : "Unknown";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <p className="text-sm text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
    </Card>
  );
}

function BarRow({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-neutral-700">{label}</span>
        <span className="text-neutral-500">
          {count} <span className="text-neutral-400">({pct}%)</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
        <div className="h-full rounded-full bg-neutral-900" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CountList({ items, total }: { items: [string, number][]; total: number }) {
  if (items.length === 0) {
    return <p className="mt-3 text-sm text-neutral-500">No data yet.</p>;
  }
  return (
    <ul className="mt-4 space-y-2.5">
      {items.map(([label, count]) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <li key={label} className="flex items-center justify-between text-sm">
            <span className="truncate text-neutral-700">{label}</span>
            <span className="flex-shrink-0 text-neutral-500">
              {count} <span className="text-neutral-400">({pct}%)</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default async function AdminStatsPage() {
  const supabase = await createClient();

  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: totalUsers },
    { count: onlineNow },
    { data: noteRows },
    { data: projectRows },
    { data: characterRows },
    { data: generationRows },
    { count: pageViewsTotal },
    { count: pageViews7d },
    { count: pageViews30d },
    { data: visitorRows7d },
    { data: pathRows30d },
    { data: countryRows30d },
    { data: demographicRows },
    falBalance,
  ] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }),
    supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .gte("last_seen_at", fiveMinAgo),
    supabase.from("notes").select("user_id").limit(5000),
    supabase.from("projects").select("user_id").limit(5000),
    supabase.from("character_profiles").select("user_id").limit(5000),
    supabase.from("generations").select("user_id, content_type").limit(5000),
    supabase.from("page_views").select("*", { count: "exact", head: true }),
    supabase
      .from("page_views")
      .select("*", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo),
    supabase
      .from("page_views")
      .select("*", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo),
    supabase.from("page_views").select("visitor_id").gte("created_at", sevenDaysAgo).limit(20000),
    supabase.from("page_views").select("path").gte("created_at", thirtyDaysAgo).limit(20000),
    supabase.from("page_views").select("country").gte("created_at", thirtyDaysAgo).limit(20000),
    // One query for both demographic cards, not two full-table selects —
    // this page used to pull every profiles row twice (once for gender, once
    // for company). Capped like the page_views selects above; past 20k users
    // the two cards become a (very large) sample rather than a census, which
    // is fine for self-reported optional fields.
    supabase.from("profiles").select("gender, company").limit(20000),
    // Not a Supabase query — hits fal.ai's own billing API directly. Kept in
    // this same Promise.all purely so it loads in parallel with everything
    // else instead of adding its own extra round-trip; never throws (see
    // getFalAccountBalance), so it can't take the rest of the page down.
    getFalAccountBalance(),
  ]);

  const total = totalUsers ?? 0;

  const uniqueNoteUsers = new Set((noteRows ?? []).map((r) => r.user_id)).size;
  const uniqueProjectUsers = new Set((projectRows ?? []).map((r) => r.user_id)).size;
  const uniqueCharacterUsers = new Set((characterRows ?? []).map((r) => r.user_id)).size;
  const uniqueGenerationUsers = new Set((generationRows ?? []).map((r) => r.user_id)).size;
  const uniqueVideoUsers = new Set(
    (generationRows ?? []).filter((r) => r.content_type === "video").map((r) => r.user_id),
  ).size;
  const uniqueImageUsers = new Set(
    (generationRows ?? []).filter((r) => r.content_type === "image").map((r) => r.user_id),
  ).size;

  const uniqueVisitors7d = new Set((visitorRows7d ?? []).map((r) => r.visitor_id)).size;
  const topPages = topCounts(pathRows30d, "path", 8);
  const topCountries = topCounts(countryRows30d, "country", 8);

  const genderCounts = new Map<string, number>();
  (demographicRows ?? []).forEach((r) => {
    const g = r.gender as string | null;
    const bucket = !g ? "Not specified" : STANDARD_GENDERS.includes(g) ? g : "Self-described";
    genderCounts.set(bucket, (genderCounts.get(bucket) ?? 0) + 1);
  });
  const genderItems = Array.from(genderCounts.entries()).sort((a, b) => b[1] - a[1]);

  const companiesSet = (demographicRows ?? []).filter((r) => r.company);
  const companyFillRate = total > 0 ? Math.round((companiesSet.length / total) * 100) : 0;
  const topCompanies = topCounts(companiesSet as Record<string, unknown>[], "company", 10);

  return (
    <div>
      <AutoRefresh intervalMs={30_000} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Stats</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Refreshes automatically every 30s. Country data is empty until the app is deployed
            to Vercel — it reads geolocation headers Vercel adds in production.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total users" value={total} />
        <StatCard label="Online now" value={onlineNow ?? 0} hint="Active in the last 5 minutes" />
        <StatCard label="Page views (7d)" value={pageViews7d ?? 0} hint={`${pageViews30d ?? 0} in 30d · ${pageViewsTotal ?? 0} all-time`} />
        <StatCard label="Unique visitors (7d)" value={uniqueVisitors7d} />
      </div>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-900">AI provider funds</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Remaining balance on each account used to generate content. Only fal.ai publishes an API
          for this — OpenAI and Anthropic don&apos;t expose credit balance programmatically at
          all, so those two have to be checked on their own dashboards.
        </p>
        <div className="mt-4 divide-y divide-neutral-100">
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm text-neutral-900">fal.ai</p>
              <p className="mt-0.5 text-xs text-neutral-400">Video, Flux images, ElevenLabs + Sync Labs</p>
            </div>
            {falBalance.ok ? (
              <p className="text-lg font-semibold text-neutral-900">
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

          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm text-neutral-900">OpenAI</p>
              <p className="mt-0.5 text-xs text-neutral-400">GPT Image (review), Whisper + TTS</p>
            </div>
            <a
              href="https://platform.openai.com/settings/organization/billing/overview"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-neutral-500 underline hover:text-neutral-900"
            >
              Check on OpenAI &rarr;
            </a>
          </div>

          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm text-neutral-900">Anthropic</p>
              <p className="mt-0.5 text-xs text-neutral-400">Claude (prompt drafting)</p>
            </div>
            <a
              href="https://console.anthropic.com/settings/billing"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-neutral-500 underline hover:text-neutral-900"
            >
              Check on Anthropic &rarr;
            </a>
          </div>
        </div>
      </Card>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-900">Feature adoption</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Share of all users who&apos;ve used each feature at least once.
        </p>
        <div className="mt-4 space-y-4">
          <BarRow label="Characters" count={uniqueCharacterUsers} total={total} />
          <BarRow label="Projects" count={uniqueProjectUsers} total={total} />
          <BarRow label="Notes" count={uniqueNoteUsers} total={total} />
          <BarRow label="Any generation" count={uniqueGenerationUsers} total={total} />
          <BarRow label="— Video generations" count={uniqueVideoUsers} total={total} />
          <BarRow label="— Image generations" count={uniqueImageUsers} total={total} />
        </div>
      </Card>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-neutral-900">Top pages (30d)</h2>
          <CountList items={topPages} total={pageViews30d ?? 0} />
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-neutral-900">Countries (30d)</h2>
          <CountList items={topCountries} total={pageViews30d ?? 0} />
        </Card>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-neutral-900">Gender</h2>
          <p className="mt-1 text-xs text-neutral-500">Self-reported, optional — most users leave this unset.</p>
          <CountList items={genderItems} total={total} />
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-neutral-900">Company</h2>
          <p className="mt-1 text-xs text-neutral-500">
            {companyFillRate}% of users have set a company.
          </p>
          <CountList items={topCompanies} total={companiesSet.length} />
        </Card>
      </div>
    </div>
  );
}
