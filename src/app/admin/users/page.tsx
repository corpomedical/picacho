import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { setUserStatus } from "@/lib/admin/actions";
import { PLAN_LABELS, type PlanId } from "@/lib/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { AdminErrorBanner } from "@/components/admin-error-banner";
import { cn } from "@/lib/cn";

const TABS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "suspended", label: "Suspended" },
  { id: "admin", label: "Admins" },
] as const;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; error?: string }>;
}) {
  const { q, status, error: actionError } = await searchParams;
  const activeTab = TABS.some((t) => t.id === status) ? status! : "all";
  const supabase = await createClient();

  // Same timestamp the Users nav badge reads (see admin/layout.tsx) — a
  // profile created after it is "new" for both. Read it before updating it
  // below, so this render still shows what's new *since your last visit*,
  // not since right now.
  const { data: lastViewedSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "admin_users_last_viewed_at")
    .single();
  const lastViewedAt = lastViewedSetting?.value ? new Date(lastViewedSetting.value) : new Date(0);

  let query = supabase
    .from("profiles")
    .select("id, email, role, plan, status, created_at, last_seen_at")
    .order("created_at", { ascending: false });

  if (q) query = query.ilike("email", `%${q}%`);
  if (activeTab === "active") query = query.eq("status", "active");
  if (activeTab === "suspended") query = query.eq("status", "suspended");
  if (activeTab === "admin") query = query.eq("role", "admin");

  const { data: users, error } = await query;

  // Mark everything as seen as of right now — this is what makes the badge
  // and the highlight below both clear once you've actually opened this
  // page, instead of just fading out on a fixed timer regardless of whether
  // anyone looked. Best-effort: a failed write here shouldn't break the page,
  // it just means the badge won't clear until the next successful visit.
  await supabase
    .from("app_settings")
    .update({ value: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("key", "admin_users_last_viewed_at");

  return (
    <div>
      <AdminErrorBanner error={actionError} />
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Users</h1>
        <form className="w-64">
          <Input type="search" name="q" placeholder="Search by email" defaultValue={q ?? ""} />
        </form>
      </div>

      <div className="mt-4 flex gap-1 text-sm">
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            href={tab.id === "all" ? "/admin/users" : `/admin/users?status=${tab.id}`}
            className={cn(
              "rounded-full px-3 py-1.5 transition-colors",
              activeTab === tab.id
                ? "bg-neutral-900 text-white"
                : "text-neutral-500 hover:bg-neutral-100",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-[18px] border border-neutral-100 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03),0_12px_28px_-12px_rgba(0,0,0,0.06)]">
        {error ? (
          <p className="p-6 text-sm text-red-600">Couldn&apos;t load users: {error.message}</p>
        ) : !users || users.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">No users found.</p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {users.map((user) => {
              const isNew = new Date(user.created_at) > lastViewedAt;
              return (
                <div
                  key={user.id}
                  className={cn(
                    "flex items-center justify-between gap-4 p-5",
                    // Slightly darker than the row's default white so a new
                    // signup stands out at a glance — clears back to default
                    // the next time this page loads, once lastViewedAt has
                    // moved past their created_at (see the update above).
                    isNew && "bg-neutral-50",
                  )}
                >
                  <Link href={`/admin/users/${user.id}`} className="min-w-0 hover:opacity-70">
                    <p className="truncate text-sm font-medium text-neutral-900">{user.email}</p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {PLAN_LABELS[(user.plan ?? "none") as PlanId]}
                      {user.role === "admin" && " · admin"} · joined{" "}
                      {new Date(user.created_at).toLocaleDateString()} ·{" "}
                      {user.last_seen_at
                        ? `active ${new Date(user.last_seen_at).toLocaleDateString()}`
                        : "never active"}
                    </p>
                  </Link>
                  <div className="flex flex-shrink-0 items-center gap-3">
                    <Badge tone={user.status === "active" ? "success" : "danger"}>
                      {user.status}
                    </Badge>
                    <form action={setUserStatus}>
                      <input type="hidden" name="user_id" value={user.id} />
                      <input type="hidden" name="redirect_to" value="/admin/users" />
                      <input
                        type="hidden"
                        name="status"
                        value={user.status === "active" ? "suspended" : "active"}
                      />
                      <Button variant="secondary" size="sm" type="submit">
                        {user.status === "active" ? "Suspend" : "Unsuspend"}
                      </Button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
