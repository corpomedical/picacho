// A server-built video request (2026-09-19). Server-only.
//
// Helios's takes and films opened to every paid plan ("Open to all plans"),
// while the composer's own storyboard lane stays Studio-and-up. Both ride
// the same start-and-end-frame fields into runGeneration, so the frames
// gate needs to know which is which — and NOT from a request field:
// runGeneration is a server action any browser can call with any form
// fields, so a flag there would hand every plan the composer's storyboard.
// The mark is held in server memory for the one call that set it
// (AsyncLocalStorage, the refusal-attribution.ts pattern), by the one
// caller that built the frames itself and checked its own plan rule first
// (sets/actions.ts takeInSet, behind setTakesEligible). Nothing a request
// carries can set or change it.

import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage<true>();

/** Runs `fn` marked as a request whose frames the server built and gated itself. */
export function withServerBuiltFrames<T>(fn: () => Promise<T>): Promise<T> {
  return context.run(true, fn);
}

/** Whether the running call's frames are the server's own — seen only inside withServerBuiltFrames. */
export function serverBuiltFrames(): boolean {
  return context.getStore() === true;
}
