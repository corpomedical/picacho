import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="mt-6 h-32 w-full" />
    </div>
  );
}
