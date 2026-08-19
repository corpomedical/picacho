// Inline rather than ui/SkeletonPage: History's cards are Atelier sheets now
// (warm surface + hairline rule), so the skeleton shows the same sheets in
// the same places — title, the usage card, then the row list — instead of
// gray slabs that repaint on arrival.
export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="h-6 w-40 animate-pulse rounded-control bg-atelier-ink/10" />
      <div className="mt-6 h-28 animate-pulse rounded-control border border-atelier-rule bg-atelier-surface" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[74px] animate-pulse rounded-control border border-atelier-rule bg-atelier-surface" />
        ))}
      </div>
    </div>
  );
}
