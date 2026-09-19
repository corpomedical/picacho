// Warm atelier pulse — same shape as ui/Skeleton, tinted with the rule token
// so the placeholder reads as paper, not gray, and flips with the theme.
function Shimmer({ className }: { className?: string }) {
  return <div className={`skeleton-shimmer rounded-control bg-atelier-rule/50 ${className ?? ""}`} />;
}

// The page's own shape while it loads (2026-09-19): the title, the rail of
// eight tabs on a desktop, and the Overview's first cards.
export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl">
      <Shimmer className="h-3 w-20" />
      <Shimmer className="mt-2 h-7 w-44" />
      <div className="mt-6 flex flex-col gap-6 sm:flex-row">
        <div className="hidden w-52 flex-shrink-0 flex-col gap-2 sm:flex">
          {Array.from({ length: 8 }).map((_, i) => (
            <Shimmer key={i} className="h-8 w-full" />
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <Shimmer className="h-24 w-full" />
          <Shimmer className="h-56 w-full" />
          <Shimmer className="h-32 w-full" />
        </div>
      </div>
    </div>
  );
}
