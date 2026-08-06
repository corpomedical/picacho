import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

export default async function AdminDashboard() {
  const supabase = await createClient();

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [
    { count: totalUsers },
    { count: generationsThisMonth },
    { count: activePlans },
    { count: flagged },
    { data: recentUsers },
    { data: recentGenerations },
  ] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }),
    supabase
      .from("generations")
      .select("*", { count: "exact", head: true })
      .gte("created_at", startOfMonth.toISOString()),
    supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .neq("plan", "none"),
    supabase
      .from("generations")
      .select("*", { count: "exact", head: true })
      .eq("status", "failed"),
    supabase
      .from("profiles")
      .select("id, email, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("generations")
      .select("id, user_id, status, prompt_input, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const userIds = Array.from(new Set((recentGenerations ?? []).map((g) => g.user_id)));
  const { data: genUsers } = userIds.length
    ? await supabase.from("profiles").select("id, email").in("id", userIds)
    : { data: [] as { id: string; email: string }[] };
  const emailById = new Map((genUsers ?? []).map((u) => [u.id, u.email]));

  const activity = [
    ...(recentUsers ?? []).map((u) => ({
      key: `user-${u.id}`,
      created_at: u.created_at,
      node: (
        <>
          <span className="font-medium text-neutral-900">{u.email}</span> signed up
        </>
      ),
    })),
    ...(recentGenerations ?? []).map((g) => ({
      key: `gen-${g.id}`,
      created_at: g.created_at,
      node: (
        <>
          <span className="font-medium text-neutral-900">
            {emailById.get(g.user_id) ?? "Someone"}
          </span>{" "}
          generated &mdash; {g.status === "succeeded" ? (
            <Badge tone="success">succeeded</Badge>
          ) : (
            <Badge tone="danger">failed</Badge>
          )}
        </>
      ),
    })),
  ]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8);

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900">Dashboard</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-neutral-500">Total users</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{totalUsers ?? 0}</p>
        </Card>
        <Card>
          <p className="text-sm text-neutral-500">Generations this month</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">
            {generationsThisMonth ?? 0}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-neutral-500">Active plans</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{activePlans ?? 0}</p>
        </Card>
        <Card>
          <p className="text-sm text-neutral-500">Flagged generations</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{flagged ?? 0}</p>
          {(flagged ?? 0) > 0 && (
            <Link href="/admin/moderation" className="mt-1 text-xs text-neutral-900 underline">
              Review
            </Link>
          )}
        </Card>
      </div>

      <Card className="mt-6">
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
