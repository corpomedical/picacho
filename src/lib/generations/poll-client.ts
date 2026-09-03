"use client";

import { pollGeneration } from "@/lib/generations/actions";

// One client-side poll loop for any page that waits on a queued generation.
//
// The composer has carried its own copy of this since the queue landed
// (generate-form.tsx, awaitQueuedGeneration); the Layers stack page is the
// second consumer, and the semantics it must share are the ones that bit
// once already: "gone" (the job row was already collected by the webhook or
// another tab) is SETTLED, not pending — treating it as pending polls a
// finished job forever; an action-level error is terminal, not retried; and
// transport failures back off rather than hammering. Moving the composer
// onto this is a follow-up; its loop and this one now agree on every state.
export type PollOutcome = { state: "settled" } | { state: "error"; message: string };

export async function pollUntilSettled(
  generationId: string,
  opts: { signal?: AbortSignal; onPending?: (progress: string) => void } = {},
): Promise<PollOutcome> {
  let delay = 2_000;
  let consecutiveFailures = 0;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      opts.signal?.addEventListener("abort", () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });
  for (;;) {
    if (opts.signal?.aborted) return { state: "settled" };
    let result: Awaited<ReturnType<typeof pollGeneration>> | null = null;
    try {
      result = await pollGeneration(generationId);
    } catch {
      result = null;
    }
    if (opts.signal?.aborted) return { state: "settled" };
    if (result === null) {
      if (++consecutiveFailures >= 60) return { state: "error", message: "Lost contact with the server." };
      await sleep(Math.min(8_000, delay));
      delay = Math.min(8_000, delay * 1.35);
      continue;
    }
    consecutiveFailures = 0;
    if (result.error !== null) return { state: "error", message: result.error };
    if (result.state === "pending") {
      opts.onPending?.(result.progress);
      await sleep(delay);
      delay = Math.min(8_000, delay * 1.35);
      continue;
    }
    // succeeded, failed, cancelled, gone — all mean "re-read the row".
    return { state: "settled" };
  }
}
