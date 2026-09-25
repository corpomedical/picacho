// The set the Sets home's Set chip starts on (Helios Cut 3, step 6b,
// 2026-09-26): the person's latest set, so a returning person's message goes
// to the place they were last shooting in, not to a new build. Only a READY
// set can be picked (the chip lists only those): the ready set with the
// newest still, otherwise the newest ready set, otherwise none — "A new
// place". The home's list is newest first (data.ts getSetsHome), so the
// first ready set is the newest. Pure and relative-import only.

import type { SetSummary } from "./types";

/** When a still was last shot here, as a number; -1 for none or a date that doesn't read. */
function shotAt(set: Pick<SetSummary, "lastShotAt">): number {
  if (!set.lastShotAt) return -1;
  const at = Date.parse(set.lastShotAt);
  return Number.isFinite(at) ? at : -1;
}

/** The id of the set the Set chip starts on, or null for "A new place". */
export function latestSetId(sets: readonly Pick<SetSummary, "id" | "status" | "lastShotAt">[]): string | null {
  const ready = sets.filter((x) => x.status === "ready");
  let best: { id: string; at: number } | null = null;
  for (const x of ready) {
    const at = shotAt(x);
    if (at >= 0 && (best === null || at > best.at)) best = { id: x.id, at };
  }
  return best?.id ?? ready[0]?.id ?? null;
}
