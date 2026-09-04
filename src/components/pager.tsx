import Link from "next/link";

// The pager for the library surfaces. A server component of two links and a
// count — no client JS, the same reasoning as the filter chips: the page
// stays a pure server component and every view is a URL you can share.
//
// It says the count out loud on purpose. The bug it closes was not the cap
// itself (a page has to stop somewhere) but that the cap was SILENT: History
// called itself "the complete record" and showed the most recent fifty with
// nothing on screen admitting it.
export function Pager({
  prevHref,
  nextHref,
  label,
  prevLabel,
  nextLabel,
}: {
  prevHref: string | null;
  nextHref: string | null;
  /** Already formatted, e.g. "49–96 shown". */
  label: string;
  prevLabel: string;
  nextLabel: string;
}) {
  if (!prevHref && !nextHref) {
    return (
      <p className="mt-6 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-atelier-muted">
        {label}
      </p>
    );
  }
  return (
    <nav className="mt-6 flex items-center justify-between gap-4" aria-label={label}>
      <div className="flex-1">
        {prevHref && (
          <Link
            href={prevHref}
            rel="prev"
            className="inline-flex min-h-[38px] items-center rounded-full border border-atelier-rule bg-atelier-surface px-4 text-xs font-medium text-atelier-ink transition-colors hover:border-atelier-muted"
          >
            ← <span className="ml-1.5">{prevLabel}</span>
          </Link>
        )}
      </div>
      <p className="flex-shrink-0 text-[11px] font-medium uppercase tracking-[0.14em] text-atelier-muted">
        {label}
      </p>
      <div className="flex flex-1 justify-end">
        {nextHref && (
          <Link
            href={nextHref}
            rel="next"
            className="inline-flex min-h-[38px] items-center rounded-full border border-atelier-rule bg-atelier-surface px-4 text-xs font-medium text-atelier-ink transition-colors hover:border-atelier-muted"
          >
            <span className="mr-1.5">{nextLabel}</span> →
          </Link>
        )}
      </div>
    </nav>
  );
}
