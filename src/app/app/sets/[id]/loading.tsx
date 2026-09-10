// A set answers the click at once, like every detail route: the masthead,
// the stage, the controls row — the page's real geometry.
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="h-3 w-16 skeleton-shimmer rounded-control bg-atelier-ink/10" />
      <div className="mt-4 h-3 w-40 skeleton-shimmer rounded-control bg-atelier-ink/10" />
      <div className="mt-2 h-8 w-64 skeleton-shimmer rounded-control bg-atelier-ink/10" />
      <div className="skeleton-shimmer mt-5 h-[58vh] min-h-[320px] w-full rounded-media border border-atelier-rule bg-atelier-stage" />
      <div className="mt-5 flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer h-7 w-20 rounded-full bg-atelier-ink/5" />
        ))}
      </div>
    </div>
  );
}
