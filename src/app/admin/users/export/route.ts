import { requireAdmin } from "@/lib/admin/require-admin";
import { csvCell, logAdminAction } from "@/lib/admin/audit";
import { applyUserFilters, searchTerm } from "@/lib/admin/user-search";

// Admin → Users → Export CSV (2026-09-28 admin redesign): the list's search
// and tab, every matching account (up to 20,000), as a spreadsheet. The
// route sits outside the admin layout's redirect, so requireAdmin is the
// gate. An export holds everyone's email, so it is itself written to the
// activity log.
export async function GET(request: Request) {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch {
    return new Response("Admins only.", { status: 403 });
  }
  const { admin, userId } = ctx;

  const url = new URL(request.url);
  const q = searchTerm(url.searchParams.get("q"));
  const tab = url.searchParams.get("status") ?? "all";

  const columns = "id, email, full_name, role, plan, plan_status, status, bonus_credits, purchased_credits, created_at, last_seen_at, marketing_opt_out";
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const query = applyUserFilters(
      admin.from("profiles").select(columns).order("created_at", { ascending: false }).range(from, from + 999),
      q,
      tab,
    );
    const { data, error } = await query;
    if (error) return new Response(`Couldn't read the accounts: ${error.message}`, { status: 500 });
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }

  await logAdminAction(admin, userId, {
    action: "export.users",
    targetType: "user",
    after: `${rows.length} accounts${q ? `, search "${q}"` : ""}${tab !== "all" ? `, tab ${tab}` : ""}`,
    amount: rows.length,
  });

  const header = columns.split(", ");
  const body = rows.map((r) => header.map((h) => csvCell(r[h])).join(","));
  const date = new Date().toISOString().slice(0, 10);
  return new Response([header.join(","), ...body].join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="picacho-users-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
