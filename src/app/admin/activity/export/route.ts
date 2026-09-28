import { requireAdmin } from "@/lib/admin/require-admin";
import {
  ADMIN_ACTION_COLUMNS,
  ADMIN_ACTION_GROUPS,
  actionLabel,
  actionsInGroup,
  csvCell,
  emailsForIds,
  type AdminActionRow,
} from "@/lib/admin/audit";

// Admin → Activity log → Export CSV. The same filters as the page, up to the
// newest 5,000 lines. requireAdmin is the gate: this route sits outside the
// admin layout's redirect, so it answers 403 to anyone else.
export async function GET(request: Request) {
  let admin;
  try {
    ({ admin } = await requireAdmin());
  } catch {
    return new Response("Admins only.", { status: 403 });
  }

  const url = new URL(request.url);
  const group = url.searchParams.get("group");
  const user = url.searchParams.get("user");

  let query = admin.from("admin_actions").select(ADMIN_ACTION_COLUMNS).order("created_at", { ascending: false }).limit(5000);
  if (group && ADMIN_ACTION_GROUPS.some((g) => g.id === group)) query = query.in("action", actionsInGroup(group));
  if (user && /^[0-9a-f-]{36}$/i.test(user)) query = query.eq("subject_user_id", user);
  const { data, error } = await query;
  if (error) return new Response(`Couldn't read the log: ${error.message}`, { status: 500 });

  const rows = (data ?? []) as AdminActionRow[];
  const emails = await emailsForIds(admin, [...rows.map((r) => r.admin_id), ...rows.map((r) => r.subject_user_id)]);
  const header = ["when_utc", "admin", "action", "did", "person", "target", "before", "after", "amount", "reason"];
  const lines = rows.map((r) =>
    [
      r.created_at,
      r.admin_id ? emails.get(r.admin_id) || r.admin_id : "system",
      r.action,
      actionLabel(r.action),
      r.subject_user_id ? emails.get(r.subject_user_id) || "deleted account" : "",
      r.target_id ?? "",
      r.before_value ?? "",
      r.after_value ?? "",
      r.amount ?? "",
      r.reason ?? "",
    ]
      .map(csvCell)
      .join(","),
  );

  const date = new Date().toISOString().slice(0, 10);
  return new Response([header.join(","), ...lines].join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="picacho-admin-activity-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
