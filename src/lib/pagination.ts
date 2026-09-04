// Paging for the library surfaces.
//
// Until now History stopped at 50 rows, Images and Videos at 60, Media at 90 —
// with nothing on screen saying so. History's own header comment called it
// "the COMPLETE record" while silently being the most recent fifty. That is
// the same defect as commit cef9142 ("Every image is a source, not the eight
// most recent"), one order of magnitude larger and on four surfaces at once.
//
// Offset paging, not a cursor. A cursor on created_at is stabler under
// concurrent inserts, but these pages already carry their filters in the URL
// as plain search params so the whole thing stays a server component with no
// client JS — and ?page=2 is a URL a person can read, type, share and
// bookmark, which ?before=2026-09-04T00%3A26%3A15.687Z is not. The tradeoff
// is real and bounded: a render finishing mid-browse can shift one row across
// a page boundary. Nothing is lost, and the next page load is correct.
//
// Alias-free so it can be unit-tested — same reasoning as upscale.ts.

/** Rows per page, per surface. Matches what each page used to cap at. */
export const PAGE_SIZES = {
  projects: 12,
  history: 48,
  media: 90,
  images: 60,
  videos: 60,
} as const;

export type PagedSurface = keyof typeof PAGE_SIZES;

/**
 * The 1-based page from a raw search param. Anything that is not a positive
 * integer — absent, "0", "-3", "abc", "1e3", a float — is page 1, because a
 * malformed URL should show the library, never an error.
 */
export function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return 1;
  if (!/^\d+$/.test(value)) return 1;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) return 1;
  // A page number far past anything real would ask PostgREST for a range
  // starting in the millions. Clamped rather than rejected: the page renders
  // empty with a working "previous", which is what a stale bookmark deserves.
  return Math.min(n, 10_000);
}

/**
 * The PostgREST range for a page, fetching ONE extra row.
 *
 * The extra row is how "is there a next page" is answered without a second
 * count query: ask for 49 and get 49, and there is a 50th somewhere. It is
 * dropped before render — see takePage.
 */
export function pageRange(page: number, size: number): { from: number; to: number } {
  const from = (page - 1) * size;
  return { from, to: from + size };
}

/** Drop the probe row, and say whether it was there. */
export function takePage<T>(rows: T[], size: number): { rows: T[]; hasNext: boolean } {
  const hasNext = rows.length > size;
  return { rows: hasNext ? rows.slice(0, size) : rows, hasNext };
}

/**
 * The href for a page, preserving every OTHER search param exactly as it
 * arrived (the filter chips live there too, and a "next page" that silently
 * dropped the active filter would be worse than no paging at all).
 * Page 1 omits the param, so the first page has one canonical URL.
 */
export function pageHref(
  basePath: string,
  current: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (key === "page" || value === undefined) continue;
    const one = Array.isArray(value) ? value[0] : value;
    if (one) params.set(key, one);
  }
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** The 1-based number of the first and last row on this page, for the count line. */
export function pageBounds(page: number, size: number, count: number): { first: number; last: number } {
  const first = count === 0 ? 0 : (page - 1) * size + 1;
  return { first, last: (page - 1) * size + count };
}
