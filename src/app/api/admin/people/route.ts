import { json, preflight, requireAdminFromRequest } from "@/lib/admin/api-auth";
import { applyUserFilters, searchTerm } from "@/lib/admin/user-search";

// GET /api/admin/people?q= — the phone admin app's People tab: search by
// email, name or ID (the website Users list's own filter); with no search,
// the people seen most recently. Opening one is /api/admin/person?id=.
export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function GET(request: Request) {
  const auth = await requireAdminFromRequest(request);
  if (auth instanceof Response) return auth;
  const q = searchTerm(new URL(request.url).searchParams.get("q"));
  let query = auth.admin
    .from("profiles")
    .select("id, email, full_name, plan, plan_status, status, role, created_at, last_seen_at");
  query = applyUserFilters(query, q, "all");
  const { data, error } = await query.order(q ? "created_at" : "last_seen_at", { ascending: false, nullsFirst: false }).limit(30);
  if (error) {
    console.error("api/admin/people: search failed", error);
    return json(request, { error: "Couldn't search right now." }, 500);
  }
  return json(request, { people: data ?? [] });
}
