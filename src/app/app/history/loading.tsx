// Inline rather than ui/SkeletonPage: History's cards are Atelier sheets
// (warm surface + hairline rule), so the skeleton shows the same sheets in
// the same places. Updated with the contact-sheet redesign (2026-09-04) —
// a skeleton that mirrors the OLD row geometry would flash a list and then
// repaint as a grid, which reads as a bug even though nothing failed.
export default function Loading() {
  return (
    <div>
      <div className="flex items-end justify-between gap-6">
        <div>
          <div className="h-3 w-20 skeleton-shimmer rounded-control bg-atelier-ink/10" />
          <div className="mt-2 h-8 w-40 skeleton-shimmer rounded-control bg-atelier-ink/10" />
        </div>
        <div className="h-12 w-24 skeleton-shimmer rounded-control bg-atelier-ink/10" />
      </div>
      <div className="mt-5 h-px bg-atelier-rule" />
      <div className="mt-5 flex gap-2">
        <div className="h-8 w-44 skeleton-shimmer rounded-full border border-atelier-rule bg-atelier-surface" />
        <div className="h-8 w-44 skeleton-shimmer rounded-full border border-atelier-rule bg-atelier-surface" />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="skeleton-shimmer rounded-[18px] border border-atelier-rule bg-atelier-surface p-2.5"
          >
            <div className="aspect-[4/3] w-full rounded-media bg-atelier-stage" />
            <div className="mt-2.5 h-3 w-11/12 rounded-control bg-atelier-ink/10" />
            <div className="mt-1.5 h-2.5 w-2/3 rounded-control bg-atelier-ink/5" />
            <div className="mt-1 h-2.5 w-1/2 rounded-control bg-atelier-ink/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
