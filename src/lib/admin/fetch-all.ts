// Pages past PostgREST's silent 1,000-row response cap (2026-08-31
// inspection: admin stats asked for .limit(50000) of page_views, got exactly
// 1,000 back with no error, and every chart quietly under-counted — 1,839
// real rows that day. Same lesson the fal ledger taught on 2026-08-30:
// when a server truncates without saying so, walk pages until a short one.
//
// Admin-surface only. Product paths should never need unbounded reads —
// if one seems to, the fix is aggregation, not this.
type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
  hardCap = 200_000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < hardCap; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

// A lookup by a list of ids (`.in("id", ids)`) carries every id in the
// request's URL, so the request line grows with the list — the reports page
// looks up the renders and people behind up to 300 reports at once. Asks in
// slices instead, so each request stays short however long the list gets.
// Best-effort like the lookups it serves: a slice that fails is left out
// (and logged) rather than taking the page down, and the page already says
// "no longer exists" / "unknown" for anything it could not find.
export async function fetchIn<T>(
  ids: readonly string[],
  lookup: (slice: string[]) => PromiseLike<PageResult<T>>,
  sliceSize = 100,
): Promise<T[]> {
  const unique = Array.from(new Set(ids));
  const slices: string[][] = [];
  for (let i = 0; i < unique.length; i += sliceSize) slices.push(unique.slice(i, i + sliceSize));
  const results = await Promise.all(slices.map((slice) => lookup(slice)));
  const rows: T[] = [];
  for (const { data, error } of results) {
    if (error) console.error("Admin lookup slice failed:", error.message);
    if (data) rows.push(...data);
  }
  return rows;
}
