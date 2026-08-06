import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-10 w-32" />
      </div>
      <Skeleton className="mt-6 h-96 w-full" />
      <Skeleton className="mt-4 h-14 w-full" />
    </div>
  );
}
