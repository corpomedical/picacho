// Sets' shape, in one client-safe module (Astra Sets, 2026-09-10).
//
// The pricing precedent is the Angle Stage's (angle-stage-config.ts): a
// build's own provider spend is bounded by a monthly CAP per plan, and every
// still shot in a Set is an ordinary image take — quoted, charged, scored
// and refunded by the image lane untouched. A credit price per build waits
// for a ledger that can hold charges that are not renders (design Phase 2).
//
// The cost being bounded, from lib/astra/prices.ts and eight builds on the
// current instructions (2026-09-11): input 1,837–1,843 tokens with short
// briefs (1,822 of them usually read from cache), output 4,727–6,535,
// $0.24–$0.33 a build.
//
//   first attempt, worst case = 2,400 input tokens (the ~1,850-token prefix
//     plus a 500-character brief in any script), all billed as cache writes,
//     + output to the 10,000-token cap
//     = 2,400 × $12.50/1M + 10,000 × $50/1M = $0.03 + $0.50 = $0.53
//   the one retry, worst case = the CLOSING retry, which may send the set
//     back (build-retry.ts: at most 16,000 characters ≈ 7,150 tokens at 2.24
//     characters per token, a conservative figure for minified JSON)
//     = 10,000 input tokens: 10,000 × $12.50/1M + $0.50 = $0.625
//   worst case per build = $0.53 + $0.625 = $1.155
//
//   Monthly worst case at the caps below, a worst-case retry on every build:
//     Basic 1 → $1.16 of $9      Starter 2 → $2.31 of $19   Growth 5 → $5.78 of $79
//     Studio 10 → $11.55 of $299  Elite 25 → $28.88 of $499
//   At the measured $0.24–$0.43 with no retry the same caps cost a quarter to a
//   third of that.

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
/**
 * Instructions plus schema (1,837–1,843 measured with short briefs on
 * 2026-09-11, before a ~40-token clarification) plus a full-length brief in
 * any script (500 characters; up to ~500 tokens in CJK).
 */
export const SET_BUILD_INPUT_TOKENS = 2_400;
/** The first try plus one automatic retry at our cost; then the slot comes back. */
export const SET_BUILD_MAX_ATTEMPTS = 2;
// A closing retry sends the set back to be mended (build-retry.ts) — only
// when the mend can fit. A mend re-emits the whole set under the same
// 10,000-token output cap: at 0.52 answer tokens per character sent back
// (a real set: 10,736 characters, 5,546 tokens), 16,000 characters is
// ~8,300 tokens, leaving room for the walls it adds. Real sets measured
// 9,700–16,100 characters (2026-09-11). Past this, or within 40 shapes of
// the 400-shape limit (added walls would be dropped by the normaliser), the
// retry is a fresh build told which sides to close.
export const SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS = 16_000;
export const SET_CLOSE_RETRY_INSTANCE_ROOM = 40;
/** Instructions, brief, feedback and the capped previous set. */
export const SET_CLOSE_RETRY_INPUT_TOKENS = 10_000;
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
//
// The thumbnail's name carries a version: v4 cards are taken with the set's
// own lift, fill light first, measured without the grey figure (exposure.ts,
// set-view.tsx, 2026-09-11). A card at any other path is older — black for a
// night set before any lift (no version), washed out by exposure alone (v2),
// or lifted less where the figure stood near the first mark (v3) — and is
// taken again, once, the next time the set is opened (isCurrentSetThumb;
// saveSetThumbnail removes the old file).
export function setThumbPath(userId: string, setId: string): string {
  return `${userId}/sets/${setId}.v4.jpg`;
}
export function isCurrentSetThumb(thumbPath: unknown, userId: string, setId: string): boolean {
  return thumbPath === setThumbPath(userId, setId);
}
export function setFramePath(userId: string, frameId: string): string {
  return `${userId}/${frameId}-set-frame.jpg`;
}
