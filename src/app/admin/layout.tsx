import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminCommandBar } from "@/components/admin-command-bar";
import { Logo } from "@/components/logo";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    redirect("/login");
  }

  // Server-side role check — never trust a client-side check alone for admin access.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profile?.role !== "admin") {
    redirect("/app");
  }

  // Badge counts for the nav — computed here (Server Component) and passed
  // down, since AdminCommandBar is a Client Component and can't query
  // Supabase itself. Reports and Feedback already have a real open/resolved
  // workflow, so their count is genuinely "still needs handling" and shrinks
  // as items get resolved, same as an iOS Mail unread badge. Moderation has
  // no such state to hook into, so it's "new in the last 24h" — a real,
  // non-fabricated number that still behaves like a notification. Users
  // instead reads app_settings.admin_users_last_viewed_at, the same
  // timestamp admin/users/page.tsx updates on every visit — so opening that
  // page clears its own badge, rather than the badge just fading out on a
  // fixed timer whether or not anyone actually looked (see that page for the
  // full reasoning; it also drives the "new user" row highlight there).
  const last24hDate = new Date();
  last24hDate.setDate(last24hDate.getDate() - 1);
  const last24h = last24hDate.toISOString();
  const [
    { data: usersLastViewedSetting },
    { count: newFlagged },
    { count: openReports },
    { count: openFeedback },
  ] = await Promise.all([
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "admin_users_last_viewed_at")
      .single(),
    supabase
      .from("generations")
      .select("*", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", last24h),
    supabase
      .from("generation_reports")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),
    supabase
      .from("feedback")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),
  ]);
  const usersLastViewedAt = usersLastViewedSetting?.value ?? new Date(0).toISOString();
  const { count: newUsers } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .gt("created_at", usersLastViewedAt);

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200/70 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-8 py-4">
          <Link href="/admin" className="flex items-center gap-2">
            <Logo className="h-5" />
            <span className="text-sm font-medium text-neutral-400">admin</span>
          </Link>
          <Link href="/app" className="text-sm text-neutral-500 hover:text-neutral-900">
            Back to app
          </Link>
        </div>
        <div className="border-t border-neutral-100">
          <AdminCommandBar
            badges={{
              "/admin/users": newUsers ?? 0,
              "/admin/moderation": newFlagged ?? 0,
              "/admin/reports": openReports ?? 0,
              "/admin/feedback": openFeedback ?? 0,
            }}
          />
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-8 py-10">{children}</div>
    </div>
  );
}
