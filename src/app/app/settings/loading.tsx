// Warm atelier pulse — same shape as ui/Skeleton, tinted with the rule token
// so the placeholder reads as paper, not gray, and flips with the theme.
function Shimmer({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-control bg-atelier-rule/50 ${className ?? ""}`} />;
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl">
      <Shimmer className="h-6 w-32" />
      <div className="mt-6 space-y-4">
        <Shimmer className="h-32 w-full" />
        <Shimmer className="h-32 w-full" />
        <Shimmer className="h-32 w-full" />
      </div>
    </div>
  );
}
