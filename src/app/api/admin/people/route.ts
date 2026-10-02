import { json, preflight, requireAdminFromRequest } from "@/lib/admin/api-auth";
import { applyUserFilters, searchTerm } from "@/lib/admin/user-search";
import { loadRetention } from "@/lib/retention/load";
import { NEW_DAYS, parseFilter } from "@/lib/retention/api";
import type { PersonPath, Retention } from "@/lib/retention/model";

// GET /api/admin/people?q=&filter= — the phone admin app's People tab:
// search by email, name or ID (the website Users list's own filter); with no
// search, the people seen most recently. Opening one is /api/admin/person?id=.
//
// Who comes back (2026-10-03): every row carries its four steps (joined,
// first render, came back, paid) and a line on where they are, and
// filter=new|quiet|paying lists those people instead of the most recent.
export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return preflight(request);
}

function fromPath(p: PersonPath) {
  return {
    id: p.id,
    email: p.email,
    full_name: p.name,
    plan: p.plan,
    plan_status: p.cancel ? "canceled" : null,
    status: null,
    created_at: p.joinedAt,
    last_seen_at: p.lastActiveAt,
    steps: p.steps,
    note: p.note,
  };
}

export async function GET(request: Request) {
  const auth = await requireAdminFromRequest(request);
  if (auth instanceof Response) return auth;
  const params = new URL(request.url).searchParams;
  const q = searchTerm(params.get("q"));
  const filter = parseFilter(params.get("filter"));

  let retention: Retention | null = null;
  try {
    retention = await loadRetention(auth.admin, 7);
  } catch (err) {
    console.warn("api/admin/people: retention unread", err);
  }

  if (!q && filter !== "recent" && retention) {
    const paths = [...retention.paths.values()];
    const now = Date.now();
    const list =
      filter === "quiet"
        ? retention.quiet.map((g) => retention!.paths.get(g.id)!).filter(Boolean)
        : filter === "new"
          ? paths
              .filter((p) => now - Date.parse(p.joinedAt) <= NEW_DAYS * 86_400_000)
              .sort((a, b) => b.joinedAt.localeCompare(a.joinedAt))
          : paths.filter((p) => p.paying).sort((a, b) => (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""));
    return json(request, { filter, people: list.slice(0, 50).map(fromPath) });
  }

  let query = auth.admin
    .from("profiles")
    .select("id, email, full_name, plan, plan_status, status, role, created_at, last_seen_at");
  query = applyUserFilters(query, q, "all");
  const { data, error } = await query.order(q ? "created_at" : "last_seen_at", { ascending: false, nullsFirst: false }).limit(30);
  if (error) {
    console.error("api/admin/people: search failed", error);
    return json(request, { error: "Couldn't search right now." }, 500);
  }
  const people = (data ?? []).map((row) => {
    const p = retention?.paths.get(row.id as string);
    return p ? { ...row, steps: p.steps, note: p.note } : row;
  });
  return json(request, { filter: "recent", people });
}
