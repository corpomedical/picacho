// Inline rather than ui/SkeletonPage: History's cards are Atelier sheets
// (warm surface + hairline rule), so the skeleton shows the same sheets in
// the same places — title, the usage card, the filter-chip row, then the
// thumbnail-led rows — instead of gray slabs that repaint on arrival. Each
// row ghost carries its charcoal stage square so the contact-sheet rhythm
// is already there before the data lands.
export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="h-6 w-40 skeleton-shimmer rounded-control bg-atelier-ink/10" />
      <div className="mt-6 h-28 skeleton-shimmer rounded-control border border-atelier-rule bg-atelier-surface" />
      <div className="mt-6 flex gap-2">
        <div className="h-8 w-44 skeleton-shimmer rounded-full border border-atelier-rule bg-atelier-surface" />
        <div className="h-8 w-44 skeleton-shimmer rounded-full border border-atelier-rule bg-atelier-surface" />
      </div>
      <div className="mt-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex skeleton-shimmer items-center gap-4 rounded-control border border-atelier-rule bg-atelier-surface p-3"
          >
            <div className="h-16 w-16 flex-shrink-0 rounded-media bg-atelier-stage" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3.5 w-3/4 rounded-control bg-atelier-ink/10" />
              <div className="h-2.5 w-1/2 rounded-control bg-atelier-ink/5" />
              <div className="h-2.5 w-1/3 rounded-control bg-atelier-ink/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
