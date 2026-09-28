// Admin → Users search and filters, shared by the list and its CSV export
// (2026-09-28 admin redesign): email or name, or an account id pasted whole.

/** Search text safe inside a PostgREST or() filter: its separators and wildcards are dropped. */
export function searchTerm(q: string | null | undefined): string {
  return (q ?? "").replace(/[,()*%\\]/g, " ").trim().slice(0, 100);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Filterable<Q> = {
  eq(column: string, value: string | boolean): Q;
  or(filters: string): Q;
};

/** The list's search and tab, applied to a profiles query. */
export function applyUserFilters<Q extends Filterable<Q>>(query: Q, q: string, tab: string): Q {
  let out = query;
  if (q) out = UUID_RE.test(q) ? out.eq("id", q) : out.or(`email.ilike.%${q}%,full_name.ilike.%${q}%`);
  if (tab === "active") out = out.eq("status", "active");
  if (tab === "suspended") out = out.eq("status", "suspended");
  if (tab === "admin") out = out.eq("role", "admin");
  if (tab === "assistant") out = out.eq("producer_access", true);
  if (tab === "light") out = out.eq("app_mode", "light");
  return out;
}
