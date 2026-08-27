// Inline rather than ui/SkeletonGrid: the gallery's tiles now sit on the
// theme-invariant Darkroom stage, and a light-gray skeleton flashing before
// charcoal tiles reads as a repaint glitch. This mirrors the real page's
// exact geometry (header + subtitle, full-width 2/3/4-column grid, media
// radius) so the loaded page lands in place, not beside it.
export default function Loading() {
  return (
    <div>
      <div className="h-6 w-40 skeleton-shimmer rounded-control bg-atelier-ink/10" />
      <div className="mt-2 h-4 w-64 skeleton-shimmer rounded-control bg-atelier-ink/5" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="aspect-square skeleton-shimmer rounded-media bg-atelier-stage" />
        ))}
      </div>
    </div>
  );
}
