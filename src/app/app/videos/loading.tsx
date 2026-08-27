// Inline rather than ui/SkeletonGrid — same reasoning as images/loading.tsx:
// the tiles land on the theme-invariant Darkroom stage, so the skeleton
// shows the same charcoal grounds in the same full-width grid.
export default function Loading() {
  return (
    <div>
      <div className="h-6 w-40 skeleton-shimmer rounded-control bg-atelier-ink/10" />
      <div className="mt-2 h-4 w-64 skeleton-shimmer rounded-control bg-atelier-ink/5" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-square skeleton-shimmer rounded-media bg-atelier-stage" />
        ))}
      </div>
    </div>
  );
}
