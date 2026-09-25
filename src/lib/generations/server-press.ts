// A Helios press, as runGeneration needs to know it (2026-09-25). Server-only.
//
// Operator, 2026-09-25: "GO ahead" on Cut 1 of the Helios audit ("never
// charge twice, and films that behave"). A Helios shot or take calls
// runGeneration after work of its own — the look's cutout and sheet can take
// up to ~150 s — so two things runGeneration decides by itself were wrong
// for it:
//
// - Its clock. The platform stops the whole request at 300 s, counted from
//   the press's first line, not from runGeneration's. The identity gate's
//   second render, the opening frame and the repeat follower all read
//   runGeneration's start, so they started renders that could be cut off
//   after they were reserved and charged.
// - The 3-second cooldown. A film's beats are one Render's own renders, a
//   few seconds apart by design; a film stopped between its beats on "You're
//   generating a bit fast" (admins are exempt, so the operator never saw
//   it). A Render is bounded by the take limiter. A single take keeps it: its
//   clip comes a whole still's render after its end still (review,
//   2026-09-25).
//
// Neither may come from a request field: runGeneration is a server action
// any browser can call with any form fields. So, as server-built.ts holds
// its mark, this is held in server memory (AsyncLocalStorage) for the one
// call that set it, by the Helios actions themselves around their own work
// (sets/actions.ts shootInSet and takeInSet). No form field can set it.

import { AsyncLocalStorage } from "node:async_hooks";

export type ServerPress = {
  /** The press's first line (epoch ms): the start of the request's 300 s. */
  startedAt: number;
  /** The press's renders skip runGeneration's 3-second cooldown (a film beat's, bounded by the take limiter). */
  skipCooldown: boolean;
};

const context = new AsyncLocalStorage<ServerPress>();

/** Runs `fn` as a Helios press started at `press.startedAt`. */
export function withServerPress<T>(press: ServerPress, fn: () => Promise<T>): Promise<T> {
  return context.run(press, fn);
}

/** The running call's Helios press — seen only inside withServerPress. */
export function serverPress(): ServerPress | null {
  return context.getStore() ?? null;
}
