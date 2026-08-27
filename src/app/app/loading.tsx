// Warm atelier pulse — same shape as ui/Skeleton, tinted with the rule token
// so the placeholder reads as paper, not gray, and flips with the theme.
function Shimmer({ className }: { className?: string }) {
  return <div className={`skeleton-shimmer rounded-control bg-atelier-rule/50 ${className ?? ""}`} />;
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl">
      <Shimmer className="h-7 w-56" />
      <Shimmer className="mt-6 h-32 w-full" />
    </div>
  );
}
