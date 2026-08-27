// Warm atelier pulse — the same layout ui/SkeletonGrid draws (title row +
// four square tiles), tinted with the rule token so the placeholder reads as
// paper, not gray, and flips with the theme.
function Shimmer({ className }: { className?: string }) {
  return <div className={`skeleton-shimmer rounded-control bg-atelier-rule/50 ${className ?? ""}`} />;
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <Shimmer className="h-6 w-40" />
        <Shimmer className="h-9 w-28" />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Shimmer key={i} className="aspect-square w-full" />
        ))}
      </div>
    </div>
  );
}
