import { cn } from "@/lib/cn";

// Shared building block for every route's loading.tsx. Previously there was
// no loading state anywhere in the app — clicking into a page did nothing
// visible until the data arrived, which reads as "broken" on a slow
// connection. These are intentionally plain (no copy to translate, no data
// dependency) so they can render instantly, before anything else loads.
export function Skeleton({ className }: { className?: string }) {
  // Warm rule-toned pulse, not gray — a skeleton is unprinted paper.
  return <div className={cn("skeleton-shimmer rounded-control bg-atelier-rule/50", className)} />;
}

export function SkeletonPage({
  cards = 3,
  title = true,
}: {
  cards?: number;
  title?: boolean;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      {title && (
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-9 w-28" />
        </div>
      )}
      <div className="mt-6 space-y-3">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}

export function SkeletonGrid({ items = 6 }: { items?: number }) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {Array.from({ length: items }).map((_, i) => (
          <Skeleton key={i} className="aspect-square w-full" />
        ))}
      </div>
    </div>
  );
}
