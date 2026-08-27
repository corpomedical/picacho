// Media-library skeleton — title, the type filter pills, then the square
// tile grid in the page's own rhythm, sweeping with the scanning shimmer.
export default function Loading() {
  return (
    <div>
      <div className="skeleton-shimmer h-7 w-32 rounded-control bg-atelier-ink/10" />
      <div className="skeleton-shimmer mt-2 h-4 w-64 rounded-control bg-atelier-ink/5" />
      <div className="skeleton-shimmer mt-5 h-9 w-52 rounded-full border border-atelier-rule bg-atelier-surface" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer aspect-square rounded-media bg-atelier-stage/80" />
        ))}
      </div>
    </div>
  );
}
