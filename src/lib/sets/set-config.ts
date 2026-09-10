// Sets' shape, in one client-safe module (Astra Sets, 2026-09-10).
//
// The pricing precedent is the Angle Stage's (angle-stage-config.ts): a
// build's own provider spend is bounded by a monthly CAP per plan, and every
// still shot in a Set is an ordinary image take — quoted, charged, scored
// and refunded by the image lane untouched. A credit price per build waits
// for a ledger that can hold charges that are not renders (design Phase 2).
//
// The cost being bounded, from lib/astra/prices.ts and the 2026-09-10
// measurement (1,626 input and 5,593 output tokens, $0.296):
//
//   worst case per attempt = 1,800 input tokens all billed as cache writes
//     + output to the 10,000-token cap
//     = 1,800 × $12.50/1M + 10,000 × $50/1M = $0.0225 + $0.50 = $0.5225
//   worst case per build   = 2 attempts (one automatic retry) = $1.045
//
//   Monthly worst case at the caps below, one retry on every build:
//     Basic 1 → $1.05 of $9      Starter 2 → $2.09 of $19   Growth 5 → $5.23 of $79
//     Studio 10 → $10.45 of $299  Elite 25 → $26.13 of $499
//   At the measured $0.30 with no retries the same caps cost under a third of that.

import type { PlanId } from "../plans";

// PHASE 1: ADMINS ONLY. The flag (astra_sets) turns the feature on; this
// decides who sees it once on. It opens to paid plans only after the
// operator's eval parts A–D pass (docs/ASTRA_SETS.md, section 4) —
// a code change on purpose, so widening is a reviewed commit and not a
// toggle flipped on a hunch.
export const SETS_OPEN_TO_PLANS = false;

export const SET_BUILDS_MONTHLY_LIMITS = {
  none: 0,
  basic: 1,
  starter: 2,
  growth: 5,
  studio: 10,
  elite: 25,
} as const satisfies Record<PlanId, number>;

export function setsEligible(plan: string | null | undefined, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  if (!SETS_OPEN_TO_PLANS) return false;
  const limit = SET_BUILDS_MONTHLY_LIMITS[(plan ?? "none") as PlanId] ?? 0;
  return limit > 0;
}

/** -1 = unlimited (admin). Infinity would arrive at the client as null. */
export function setBuildsMonthlyLimit(plan: string | null | undefined, isAdmin: boolean): number {
  if (isAdmin) return -1;
  return SET_BUILDS_MONTHLY_LIMITS[(plan ?? "none") as PlanId] ?? 0;
}

export const SET_BRIEF_MIN_CHARS = 8;
export const SET_BRIEF_MAX_CHARS = 500;
/** What the person says is happening in one frame. */
export const SET_DIRECTION_MAX_CHARS = 300;

export const SET_BUILD_EFFORT = "low" as const;
export const SET_BUILD_MAX_OUTPUT_TOKENS = 10_000;
/** Instructions plus schema (1,626 measured) plus a full-length brief. */
export const SET_BUILD_INPUT_TOKENS = 1_800;
/** The first try plus one automatic retry at our cost; then the slot comes back. */
export const SET_BUILD_MAX_ATTEMPTS = 2;
// A build answers in ~90 s, and background mode keeps an uncollected answer
// for about ten minutes after it finishes. Past this, a build still marked
// "building" is lost, and is closed as failed so it stops holding a slot.
export const SET_BUILD_STALE_MS = 15 * 60 * 1000;

// Image takes render square (openai-images.ts pins 1024×1024), so the set
// is framed and snapshotted square: what the person frames is what the
// image model is asked to match.
export const SET_FRAME_PX = 1024;
export const MAX_SET_FRAME_BYTES = 3 * 1024 * 1024;
export const SET_THUMB_PX = 480;
export const MAX_SET_THUMB_BYTES = 400 * 1024;
export const SETS_LIST_LIMIT = 60;
export const SET_SHOTS_LIMIT = 48;

// Where the files live. Both buckets are swept whole, recursively, by
// account deletion (profile/storage-buckets.ts), so neither needs a line
// there. The frame rides a take as an ordinary chat attachment — recorded
// on the generation, cleaned up when that take is deleted.
export function setThumbPath(userId: string, setId: string): string {
  return `${userId}/sets/${setId}.jpg`;
}
export function setFramePath(userId: string, frameId: string): string {
  return `${userId}/${frameId}-set-frame.jpg`;
}
