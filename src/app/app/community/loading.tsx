// Community skeleton — the feed's real anatomy as ghosts: title, the
// New/Top pill group, then the 3-column tile mosaic with its featured
// double-size lead tile, each sweeping with the scanning shimmer so a slow
// connection shows the page taking shape instead of a dead screen.
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="skeleton-shimmer h-7 w-44 rounded-control bg-atelier-ink/10" />
          <div className="skeleton-shimmer mt-2 h-4 w-64 rounded-control bg-atelier-ink/5" />
        </div>
        <div className="skeleton-shimmer h-8 w-28 rounded-full border border-atelier-rule bg-atelier-surface" />
      </div>
      <div className="mt-6 grid grid-cols-3 gap-[2px] overflow-hidden rounded-media">
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className={
              i === 0
                ? "skeleton-shimmer col-span-2 row-span-2 bg-atelier-stage/90"
                : "skeleton-shimmer aspect-square bg-atelier-stage/80"
            }
          />
        ))}
      </div>
    </div>
  );
}
