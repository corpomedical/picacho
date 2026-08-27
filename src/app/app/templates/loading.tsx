// Templates skeleton — header, a section label, then the sample-led cards
// (tall image ghost + title line + copy lines) in the page's real grid, all
// sweeping with the scanning shimmer.
export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="skeleton-shimmer h-7 w-40 rounded-control bg-atelier-ink/10" />
      <div className="skeleton-shimmer mt-2 h-4 w-80 rounded-control bg-atelier-ink/5" />
      <div className="skeleton-shimmer mt-8 h-3.5 w-24 rounded-control bg-atelier-ink/5" />
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-control border border-atelier-rule bg-atelier-surface">
            <div className="skeleton-shimmer aspect-[4/3] bg-atelier-stage/80" />
            <div className="space-y-2 p-4">
              <div className="skeleton-shimmer h-4 w-2/3 rounded-control bg-atelier-ink/10" />
              <div className="skeleton-shimmer h-3 w-full rounded-control bg-atelier-ink/5" />
              <div className="skeleton-shimmer h-3 w-5/6 rounded-control bg-atelier-ink/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
