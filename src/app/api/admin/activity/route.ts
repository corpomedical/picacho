import { json, preflight, requireAdminFromRequest } from "@/lib/admin/api-auth";
import { ADMIN_ACTION_COLUMNS, actionLabel, emailsForIds, isMissingAuditTable, type AdminActionRow } from "@/lib/admin/audit";

// GET /api/admin/activity — the newest 60 lines of the admin activity log for
// the phone admin app, names looked up (2026-09-28 admin redesign).
export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function GET(request: Request) {
  const auth = await requireAdminFromRequest(request);
  if (auth instanceof Response) return auth;
  const { admin } = auth;

  const { data, error } = await admin.from("admin_actions").select(ADMIN_ACTION_COLUMNS).order("created_at", { ascending: false }).limit(60);
  if (error) {
    return json(request, {
      rows: [],
      notice: isMissingAuditTable(error)
        ? "The activity log starts once supabase/applied/2026-09-29/admin-activity.sql has run in Supabase."
        : "Couldn't read the log.",
    });
  }
  const rows = (data ?? []) as AdminActionRow[];
  const emails = await emailsForIds(admin, [...rows.map((r) => r.admin_id), ...rows.map((r) => r.subject_user_id)]);
  return json(request, {
    rows: rows.map((r) => ({
      ...r,
      label: actionLabel(r.action),
      admin: (r.admin_id && emails.get(r.admin_id)) || "system",
      person: r.subject_user_id ? emails.get(r.subject_user_id) || "deleted account" : null,
    })),
  });
}
