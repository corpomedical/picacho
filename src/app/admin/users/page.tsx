import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { setUserStatus } from "@/lib/admin/actions";
import { PLAN_LABELS, type PlanId } from "@/lib/plans";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { Input } from "@/components/ui/field";
import { AdminErrorBanner, AdminSuccessBanner } from "@/components/admin-error-banner";
import { LocalDate } from "@/components/local-date";
import { getUserActivity, formatDuration } from "@/lib/admin/activity";
import { cn } from "@/lib/cn";
import { ADMIN_LOOK_LABELS, ADMIN_MODE_LABELS, parseAppLook, parseAppMode } from "@/lib/light/mode";
import { applyUserFilters, searchTerm } from "@/lib/admin/user-search";

// One page of the list (2026-09-28 admin redesign): the list used to load
// every account in one query, which slows down with every sign-up.
const PAGE_SIZE = 100;

const TABS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "suspended", label: "Suspended" },
  { id: "admin", label: "Admins" },
  // Accounts an admin granted the Producer to (the user page's "Assistant" row).
  { id: "assistant", label: "Assistant" },
  // Accounts on Picacho Light (the simple chat), picked at sign-up or in Settings.
  { id: "light", label: "Picacho Light" },
] as const;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; error?: string; message?: string; page?: string }>;
}) {
  // ?message= carries success notices (deleteUser redirects here with one) —
  // it used to be silently dropped, so deleting a user landed on a list that
  // said nothing about whether it worked.
  const { q: rawQ, status, error: actionError, message, page: rawPage } = await searchParams;
  const q = searchTerm(rawQ);
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
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
    .select(
      "id, email, role, plan, status, created_at, last_seen_at, session_started_at, session_seconds, total_active_seconds",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  // Email or name, or the account's id pasted whole (2026-09-28: email only before).
  query = applyUserFilters(query, q, activeTab);

  const { data: users, error, count } = await query;
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const listHref = (next: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (activeTab !== "all") params.set("status", activeTab);
    if (next > 1) params.set("page", String(next));
    const str = params.toString();
    return str ? `/admin/users?${str}` : "/admin/users";
  };
  const exportParams = new URLSearchParams();
  if (q) exportParams.set("q", q);
  if (activeTab !== "all") exportParams.set("status", activeTab);

  // Each person's Picacho Light version and look, read on their own so the
  // list still loads if picacho-light.sql hasn't run (the columns are missing
  // and this read just errors).
  const choices = new Map<string, string>();
  if (users && users.length > 0) {
    const { data: rows } = await supabase
      .from("profiles")
      .select("id, app_mode, app_look")
      .in("id", users.map((u) => u.id));
    for (const row of (rows ?? []) as { id: string; app_mode?: unknown; app_look?: unknown }[]) {
      const mode = parseAppMode(row.app_mode);
      const look = parseAppLook(row.app_look);
      choices.set(
        row.id,
        [mode ? ADMIN_MODE_LABELS[mode] : "version not chosen", look ? `${ADMIN_LOOK_LABELS[look]} look` : null]
          .filter(Boolean)
          .join(" · "),
      );
    }
  }

  // Sign-in times, session length and live status, read from auth.users /
  // auth.sessions in one round trip for the whole page (see lib/admin/
  // activity.ts). Degrades to empty columns rather than failing the page.
  const activity = await getUserActivity(users ?? []);

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
      <AdminSuccessBanner message={message} />
      <div className="flex items-center justify-between">
        <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">People</p>
        <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">Users</h1>
      </div>
        <div className="flex items-center gap-2">
          <a
            href={`/admin/users/export${exportParams.toString() ? `?${exportParams}` : ""}`}
            className="inline-flex h-9 items-center whitespace-nowrap rounded-[10px] border border-atelier-rule bg-atelier-surface px-3 text-[13px] font-medium text-atelier-ink hover:border-atelier-ink/30"
          >
            Export CSV
          </a>
          <form className="w-64">
            {activeTab !== "all" && <input type="hidden" name="status" value={activeTab} />}
            <Input type="search" name="q" placeholder="Search email, name or id" defaultValue={q} />
          </form>
        </div>
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
        {error && activeTab === "light" && /app_mode/.test(error.message) ? (
          <p className="p-6 text-sm text-neutral-500">
            Nobody is on Picacho Light until supabase/pending/picacho-light.sql runs in Supabase.
          </p>
        ) : error && activeTab === "assistant" && /producer_access/.test(error.message) ? (
          <p className="p-6 text-sm text-neutral-500">
            Nobody can be granted the assistant until supabase/applied/2026-09-26/producer-access.sql runs in Supabase.
          </p>
        ) : error ? (
          <p className="p-6 text-sm text-red-600">Couldn&apos;t load users: {error.message}</p>
        ) : !users || users.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">No users found.</p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {users.map((user) => {
              const isNew = new Date(user.created_at) > lastViewedAt;
              const act = activity.get(user.id);
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
                  <Link href={`/admin/users/${user.id}`} className="min-w-0 flex-1 hover:opacity-70">
                    <p className="flex items-center gap-2 truncate text-sm font-medium text-neutral-900">
                      {/* Live dot — seen within the last five minutes, the
                          same window Admin > Stats counts as online. */}
                      {act?.online && (
                        <span
                          className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500"
                          title="Online now"
                        />
                      )}
                      <span className="truncate">{user.email}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {PLAN_LABELS[(user.plan ?? "none") as PlanId]}
                      {user.role === "admin" && " · admin"} · joined{" "}
                      <LocalDate date={user.created_at} />
                      {choices.get(user.id) && ` · ${choices.get(user.id)}`}
                    </p>
                  </Link>

                  {/* Activity columns. Fixed widths so the three read as real
                      columns down the list rather than ragged inline text;
                      hidden below lg, where the row has no room for them. */}
                  <dl className="hidden flex-shrink-0 gap-6 text-xs lg:flex">
                    <div className="w-36">
                      <dt className="text-neutral-400">Last login</dt>
                      <dd className="mt-0.5 text-neutral-700">
                        {act?.lastSignInAt ? (
                          <LocalDate date={act.lastSignInAt} mode="datetime" />
                        ) : (
                          "—"
                        )}
                      </dd>
                    </div>
                    <div className="w-36">
                      <dt className="text-neutral-400">Last seen</dt>
                      <dd className="mt-0.5 text-neutral-700">
                        {act?.online ? (
                          <span className="text-emerald-600">Online now</span>
                        ) : act?.lastSeenAt ? (
                          <LocalDate date={act.lastSeenAt} mode="datetime" />
                        ) : (
                          "—"
                        )}
                      </dd>
                    </div>
                    <div className="w-24">
                      <dt
                        className="text-neutral-400"
                        title="Time actually spent on the site during their latest visit — idle time excluded"
                      >
                        Session
                      </dt>
                      <dd className="mt-0.5 text-neutral-700">
                        {formatDuration(act?.sessionSeconds ?? null)}
                      </dd>
                    </div>
                  </dl>

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
                      <SubmitButton variant="secondary" size="sm" pendingLabel="Updating…">
                        {user.status === "active" ? "Suspend" : "Unsuspend"}
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-atelier-muted">
        <span>
          {count ?? 0} {count === 1 ? "account" : "accounts"}
          {pages > 1 && ` · page ${page} of ${pages}`}
        </span>
        {pages > 1 && (
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={listHref(page - 1)} className="rounded-full border border-atelier-rule px-3 py-1.5 text-atelier-ink hover:border-atelier-ink/30">
                Newer
              </Link>
            )}
            {page < pages && (
              <Link href={listHref(page + 1)} className="rounded-full border border-atelier-rule px-3 py-1.5 text-atelier-ink hover:border-atelier-ink/30">
                Older
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
