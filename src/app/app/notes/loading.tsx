import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl">
      <Skeleton className="h-6 w-28" />
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[240px_1fr]">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
