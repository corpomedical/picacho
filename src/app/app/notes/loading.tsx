// Warm atelier pulse — same shape as ui/Skeleton, tinted with the rule token
// so the placeholder reads as paper, not gray, and flips with the theme.
function Shimmer({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-control bg-atelier-rule/50 ${className ?? ""}`} />;
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl">
      <Shimmer className="h-6 w-28" />
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[240px_1fr]">
        <Shimmer className="h-64 w-full" />
        <Shimmer className="h-64 w-full" />
      </div>
    </div>
  );
}
