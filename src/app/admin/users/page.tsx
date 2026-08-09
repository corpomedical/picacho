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

  let query = supabase
    .from("profiles")
    .select("id, email, role, plan, status, created_at, last_seen_at")
    .order("created_at", { ascending: false });

  if (q) query = query.ilike("email", `%${q}%`);
  if (activeTab === "active") query = query.eq("status", "active");
  if (activeTab === "suspended") query = query.eq("status", "suspended");
  if (activeTab === "admin") query = query.eq("role", "admin");

  const { data: users, error } = await query;

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
            {users.map((user) => (
              <div key={user.id} className="flex items-center justify-between gap-4 p-5">
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
