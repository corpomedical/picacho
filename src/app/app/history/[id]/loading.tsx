// The take page's instant answer to a click (2026-09-05, operator: tapping
// a video in History "feels frozen"). This detail route had NO loading
// boundary — the list pages all have one, but navigating INTO a take showed
// nothing at all until the whole server render arrived, which on a slow
// network is many silent seconds of an app that appears dead. The skeleton
// mirrors the real page's geometry: the big darkroom stage first, then the
// caption/title line and the facts row, so nothing repaints as a different
// shape when the content lands.
export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="skeleton-shimmer relative overflow-hidden rounded-[18px] bg-atelier-stage p-2">
        <div className="aspect-video w-full rounded-[6px] bg-atelier-ink/20" />
      </div>
      <div className="mt-5 h-6 w-3/4 skeleton-shimmer rounded-control bg-atelier-ink/10" />
      <div className="mt-3 flex gap-3">
        <div className="h-4 w-24 skeleton-shimmer rounded-control bg-atelier-ink/5" />
        <div className="h-4 w-20 skeleton-shimmer rounded-control bg-atelier-ink/5" />
        <div className="h-4 w-28 skeleton-shimmer rounded-control bg-atelier-ink/5" />
      </div>
      <div className="mt-6 flex gap-2">
        <div className="h-9 w-28 skeleton-shimmer rounded-control border border-atelier-rule bg-atelier-surface" />
        <div className="h-9 w-28 skeleton-shimmer rounded-control border border-atelier-rule bg-atelier-surface" />
        <div className="h-9 w-28 skeleton-shimmer rounded-control border border-atelier-rule bg-atelier-surface" />
      </div>
    </div>
  );
}
