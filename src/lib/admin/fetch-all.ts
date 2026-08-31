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
