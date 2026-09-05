// Same contract as history/[id]/loading.tsx: a detail route must answer the
// click instantly, whatever the network is doing. Mirrors the stage page's
// real geometry — masthead, the big stage, the angles row.
export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="h-3 w-24 skeleton-shimmer rounded-control bg-atelier-ink/10" />
      <div className="mt-2 h-8 w-56 skeleton-shimmer rounded-control bg-atelier-ink/10" />
      <div className="mt-2 h-4 w-2/3 skeleton-shimmer rounded-control bg-atelier-ink/5" />
      <div className="skeleton-shimmer mt-5 h-[46vh] min-h-[300px] w-full rounded-media border border-atelier-rule bg-atelier-stage" />
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer aspect-video rounded-media border border-atelier-rule bg-atelier-stage" />
        ))}
      </div>
    </div>
  );
}
