// What the person did with a render, after we handed it to them.
//
// Its own alias-free module so it can be unit-tested — same reasoning as
// refund-rules.ts and scorer-version.ts.
//
// WHY THIS EXISTS (2026-09-07). Every algorithm worth building on top of this
// product — a prompt compiler that learns, a router that picks the model most
// likely to please, a ranking of which decompositions survive editing — needs
// a label saying whether an output was any good. Today the only such label is
// the identity score, which is a MODEL'S opinion, and a competitor with a
// budget can buy ten thousand of those in a week.
//
// What they cannot buy is what a real customer DID. Downloading a render,
// continuing a scene from it, publishing it, or deleting it unopened are
// judgements no amount of compute manufactures. That is the one label supply
// that is genuinely not purchasable, and until now none of it was written
// down.
//
// Deliberately NOT a score. A signal is an event that happened, at a time.
// Turning events into a preference is analysis, and analysis changes its mind;
// the record should not have to be rewritten when it does.

/**
 * The vocabulary. Additive only — a name here ends up in stored rows, so
 * renaming one silently splits a dataset in half.
 *
 * Ordered by how strongly each one implies the person wanted the result,
 * which is a comment, not a weight: the weighting belongs in whatever analysis
 * reads these, and different questions will weigh them differently.
 */
export const SIGNAL_KINDS = [
  /** Saved the file to their own device. The plainest "I want this". */
  "downloaded",
  /** Started a new render FROM this one — continuation, angle, layer edit. */
  "continued",
  /** Published it to the community feed, attaching their name to it. */
  "shared",
  /** Opened it full-size. Weak on its own; useful as a denominator. */
  "opened",
  /** Removed it. The only unambiguous negative the product collects. */
  "deleted",
] as const;

export type SignalKind = (typeof SIGNAL_KINDS)[number];

export function isSignalKind(value: string): value is SignalKind {
  return (SIGNAL_KINDS as readonly string[]).includes(value);
}

/**
 * Signals that mean the person acted to KEEP the result, as opposed to merely
 * looking at it.
 *
 * "opened" is excluded on purpose: someone opens a render to find out whether
 * it worked, which happens just as often when it did not. Counting a look as
 * approval would label every bad render positive, which is worse than having
 * no label at all.
 */
const KEEPING: readonly SignalKind[] = ["downloaded", "continued", "shared"];

export function isKeepingSignal(kind: SignalKind): boolean {
  return KEEPING.includes(kind);
}

export type SignalRow = { kind: SignalKind };

/**
 * The verdict for one render, from everything recorded about it.
 *
 * "unknown" is a first-class answer and by far the most common one: most
 * renders are looked at and nothing else. An analysis that treats silence as
 * rejection would be measuring how often people bother to click, not how good
 * the renders were.
 *
 * A delete does NOT override a keep. Downloading a render and later clearing
 * it out of the grid is housekeeping, not a retraction — the person took the
 * file. Only a delete with no keeping signal at all reads as rejection.
 */
export function verdictFor(signals: SignalRow[]): "kept" | "rejected" | "unknown" {
  let kept = false;
  let deleted = false;
  for (const s of signals) {
    if (isKeepingSignal(s.kind)) kept = true;
    else if (s.kind === "deleted") deleted = true;
  }
  if (kept) return "kept";
  if (deleted) return "rejected";
  return "unknown";
}
