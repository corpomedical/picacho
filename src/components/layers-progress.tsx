"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { pollUntilSettled } from "@/lib/generations/poll-client";
import { useLocale } from "@/lib/i18n/provider";

// While a split is in flight the stack page shows this and polls through
// the shared loop — the same advanceGeneration tick the webhook and the
// reaper drive, so all three move the one job the same way. Whatever
// terminal state arrives (including "gone", when the webhook got there
// first), the server component is re-read and shows the stored layers or
// the failure.
export function LayersProgress({ generationId }: { generationId: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void pollUntilSettled(generationId, { signal: controller.signal }).then((outcome) => {
      if (controller.signal.aborted) return;
      if (outcome.state === "error") setError(outcome.message);
      router.refresh();
    });
    return () => controller.abort();
  }, [generationId, router]);

  return (
    <div className="rounded-control border border-atelier-rule bg-atelier-surface p-6 text-center shadow-[0_1px_2px_rgba(33,29,22,0.04)]">
      {error ? (
        <p className="text-sm text-atelier-ink">{error}</p>
      ) : (
        <>
          <div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-atelier-rule border-t-atelier-accent" aria-hidden />
          <p className="mt-3 text-sm text-atelier-muted">{t.layers.working}</p>
        </>
      )}
    </div>
  );
}
