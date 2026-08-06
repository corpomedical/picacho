"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Periodically re-runs the server component on the current page so numbers
// (online now, recent visits, etc.) stay roughly live without any
// websocket/realtime infrastructure — just a plain refetch on an interval.
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
