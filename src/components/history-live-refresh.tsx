"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { pollUntilSettled } from "@/lib/generations/poll-client";

// History is the designated waiting room — the StillRendering card literally
// says "will appear here and in History when it's ready" — but both history
// surfaces were pure server components that never re-read a row: the user
// watched an elapsed counter tick past a render that had finished minutes
// ago, and the page's own promise was false without a manual reload
// (2026-09-05 audit). This is the LayersProgress pattern, mounted invisibly:
// one shared poll loop per in-flight row, and a router.refresh() whenever one
// settles, so the finished result replaces the pulsing chip on its own. The
// polling also means the user staring at History is now DRIVING
// advanceGeneration — closing the "nobody polls while they wait here" gap
// the reaper otherwise had to cover.
export function HistoryLiveRefresh({ generationIds }: { generationIds: string[] }) {
  const router = useRouter();
  // Stable dependency for an array prop a server component rebuilds every
  // render — the ids themselves are what matters, not the array identity.
  const key = generationIds.join(",");

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    for (const id of key.split(",")) {
      void pollUntilSettled(id, { signal: controller.signal }).then(() => {
        if (controller.signal.aborted) return;
        router.refresh();
      });
    }
    return () => controller.abort();
  }, [key, router]);

  return null;
}
