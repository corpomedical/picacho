import Link from "next/link";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  ADMIN_ACTION_COLUMNS,
  ADMIN_ACTION_GROUPS,
  actionLabel,
  actionsInGroup,
  emailsForIds,
  isMissingAuditTable,
  type AdminActionRow,
} from "@/lib/admin/audit";
import { LocalDate } from "@/components/local-date";

// Admin → Activity log (2026-09-28 admin redesign): every change any admin
// made, newest first — who, when, what it was before, what it became, and
// why. Lines are written by logAdminAction (lib/admin/audit.ts) and can't be
// edited or deleted (the table's trigger refuses it).

const PAGE_SIZE = 50;

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; user?: string; page?: string }>;
}) {
  const { admin } = await requireAdmin();
  const params = await searchParams;
  const group = ADMIN_ACTION_GROUPS.some((g) => g.id === params.group) ? params.group! : null;
  const personId = params.user && /^[0-9a-f-]{36}$/i.test(params.user) ? params.user : null;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  let query = admin
    .from("admin_actions")
    .select(ADMIN_ACTION_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (group) query = query.in("action", actionsInGroup(group));
  if (personId) query = query.eq("subject_user_id", personId);
  const { data, count, error } = await query;
  const rows = (data ?? []) as AdminActionRow[];

  const emails = await emailsForIds(admin, [...rows.map((r) => r.admin_id), ...rows.map((r) => r.subject_user_id), personId]);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const href = (next: { group?: string | null; page?: number; user?: string | null }) => {
    const q = new URLSearchParams();
    const g = next.group === undefined ? group : next.group;
    const u = next.user === undefined ? personId : next.user;
    if (g) q.set("group", g);
    if (u) q.set("user", u);
    if (next.page && next.page > 1) q.set("page", String(next.page));
    const s = q.toString();
    return s ? `/admin/activity?${s}` : "/admin/activity";
  };
  const exportHref = `/admin/activity/export${href({ page: 1 }).replace("/admin/activity", "")}`;

  const chip = (active: boolean) =>
    `inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-medium transition-colors ${
      active
        ? "bg-atelier-ink text-atelier-paper"
        : "border border-atelier-rule bg-atelier-surface text-atelier-ink hover:border-atelier-ink/30"
    }`;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">Admin</p>
          <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">Activity log</h1>
          <p className="mt-1 text-sm text-atelier-muted">
            Every change any admin made: who, when, what it was before, what it became, and why. Nobody can
            edit or delete a line.
          </p>
        </div>
        <a
          href={exportHref}
          className="inline-flex h-9 items-center rounded-[10px] border border-atelier-rule bg-atelier-surface px-3.5 text-[13px] font-medium text-atelier-ink hover:border-atelier-ink/30"
        >
          Export CSV
        </a>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link href={href({ group: null, page: 1 })} className={chip(!group)}>
          All
        </Link>
        {ADMIN_ACTION_GROUPS.map((g) => (
          <Link key={g.id} href={href({ group: g.id, page: 1 })} className={chip(group === g.id)}>
            {g.label}
          </Link>
        ))}
      </div>

      {personId && (
        <p className="mt-3 text-sm text-atelier-muted">
          Only changes to{" "}
          <Link href={`/admin/users/${personId}`} className="font-medium text-atelier-accent hover:underline">
            {emails.get(personId) || "a deleted account"}
          </Link>{" "}
          ·{" "}
          <Link href={href({ user: null, page: 1 })} className="underline hover:text-atelier-ink">
            show everyone
          </Link>
        </p>
      )}

      <div className="mt-4 overflow-hidden rounded-2xl border border-atelier-rule bg-atelier-surface">
        {error ? (
          <p className="p-6 text-sm text-atelier-muted">
            {isMissingAuditTable(error)
              ? "The activity log starts once supabase/pending/admin-activity.sql has run in Supabase. Until then every admin action still works; it just isn't recorded here."
              : `Couldn't load the log: ${error.message}`}
          </p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-atelier-muted">
            {group || personId ? "Nothing here yet for this filter." : "No admin changes recorded yet. The next one lands here."}
          </p>
        ) : (
          <>
            <div className="hidden grid-cols-[150px_150px_170px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-atelier-muted lg:grid">
              <span>When</span>
              <span>Admin</span>
              <span>Did</span>
              <span>To</span>
              <span>Before → after</span>
              <span>Why</span>
            </div>
            <ul>
              {rows.map((r) => {
                const adminEmail = r.admin_id ? emails.get(r.admin_id) : null;
                const subjectEmail = r.subject_user_id ? emails.get(r.subject_user_id) : null;
                const change =
                  r.before_value !== null || r.after_value !== null
                    ? `${r.before_value ?? "—"} → ${r.after_value ?? "—"}`
                    : "—";
                return (
                  <li
                    key={r.id}
                    className="grid gap-1 border-t border-atelier-rule px-5 py-3 text-[13px] text-atelier-ink lg:grid-cols-[150px_150px_170px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-3"
                  >
                    <span className="text-atelier-muted">
                      <LocalDate date={r.created_at} mode="datetime" />
                    </span>
                    <span className="truncate">{adminEmail || (r.admin_id ? "former admin" : "system")}</span>
                    <span className="font-semibold">
                      {actionLabel(r.action)}
                      {r.amount !== null && r.action !== "email.blast" && (
                        <span className="ml-1 font-normal text-atelier-accent">{r.amount}</span>
                      )}
                    </span>
                    <span className="min-w-0 truncate">
                      {r.subject_user_id ? (
                        <Link href={`/admin/users/${r.subject_user_id}`} className="text-atelier-accent hover:underline">
                          {subjectEmail || "deleted account"}
                        </Link>
                      ) : (
                        <span className="font-mono text-[12px]">{r.target_id ?? "—"}</span>
                      )}
                    </span>
                    <span className="min-w-0 break-words font-mono text-[12px]">{change}</span>
                    <span className="min-w-0 break-words text-atelier-muted">{r.reason ?? "—"}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-atelier-muted">
          <span>
            Page {page} of {pages} · {count} changes
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={href({ page: page - 1 })} className={chip(false)}>
                Newer
              </Link>
            )}
            {page < pages && (
              <Link href={href({ page: page + 1 })} className={chip(false)}>
                Older
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
