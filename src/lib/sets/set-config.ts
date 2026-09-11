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
/**
 * What a reserved build row's brief holds until the person's words have
 * passed the gate (a refused brief is never written), and what a photo
 * build keeps there when the photographer adds no notes (the column's CHECK
 * wants 1–500 characters). Never sent to Astra, never shown.
 */
export const SET_RESERVED_BRIEF = "-";
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
// The same for photo builds: at the measured 48.6 output tokens a second,
// a full 16,000-token answer takes ~329 s (5.5 minutes), and the clock runs
// from each attempt's own write, so a live photo attempt is never stale.
export const SET_BUILD_STALE_MS = 15 * 60 * 1000;

// PHOTO BUILDS (docs 3.2, 2026-09-11). One measured run: 1,992 input / 12,834 output tokens
// (4,007 reasoning), 264 s, $0.667. The text cap of 10,000 would have cut it off.
//
//   first attempt, worst case = 4,800 input tokens, all billed as cache writes:
//     ~1,850 prefix (instructions + schema) + SET_PHOTO_RULES (≤ 2,000 chars ≈ ≤ 500)
//     + notes (≤ 300 chars, ≤ ~300 tokens in any script) + the photo (≤ 2,048 px, budget ≈ 2,150;
//     Astra's image-token count is UNMEASURED — every photo build logs its usage)
//     + output to the 16,000 cap
//     = 4,800 × $12.50/1M + 16,000 × $50/1M = $0.06 + $0.80 = $0.86
//   the one retry, worst case = the CLOSING retry: photo again + the set sent back
//     (16,000 chars ≈ ceil(16,000 / 2.24) = 7,143 tokens) + feedback (200)
//     = 4,800 + 7,143 + 200 = 12,143 ≤ 12,500 input tokens
//     = 12,500 × $12.50/1M + 16,000 × $50/1M = $0.15625 + $0.80 = $0.95625
//   (a failure retry resends the photo without a set: $0.86; two of those = $1.72)
//   worst case per photo build = $0.86 + $0.95625 = $1.81625   (from words: $1.155)
//   A 2× miss on the image's tokens (+2,150) adds 2,150 × $12.50/1M ≈ $0.027 an attempt.
//   A mend under the 16,000 cap: ceil(16,000 × 0.52) = 8,320 + 1,500 added walls
//     + 4,007 reasoning (measured) = 13,827 ≤ 16,000.
// Photo builds use the same monthly slot as text builds. Admins are unlimited; re-derive
// the plan caps before widening.
/** Its own knob, so the eval can move it without moving text builds. */
export const SET_PHOTO_BUILD_EFFORT = "low" as const;
export const SET_PHOTO_BUILD_MAX_OUTPUT_TOKENS = 16_000;
export const SET_PHOTO_BUILD_INPUT_TOKENS = 4_800;
export const SET_PHOTO_CLOSE_RETRY_INPUT_TOKENS = 12_500;
export const SET_PHOTO_MAX_SIDE_PX = 2048;
export const SET_PHOTO_MIN_SIDE_PX = 640;
/** A 2.39:1 film frame passes; panoramas do not. */
export const SET_PHOTO_MAX_ASPECT = 2.4;
/** The prepared JPEG: 3 MB decodes from 4 MiB of base64, under Vercel's 4.5 MB request cap. */
export const MAX_SET_PHOTO_BYTES = 3 * 1024 * 1024;
/** What the browser will try to decode at all. */
export const SET_PHOTO_MAX_FILE_BYTES = 40 * 1024 * 1024;
/** What the photographer adds about what the photo cannot show. */
export const SET_PHOTO_NOTES_MAX_CHARS = 300;
/** The long side of the first-camera view drawn beside the photo on the set page. */
export const SET_COMPARE_PX = 1024;

/**
 * Whether a photo of this size can be built from, and the size it is sent at
 * (long side at most SET_PHOTO_MAX_SIDE_PX, never enlarged). Pure: the
 * browser reads it before sending, the server again on what sharp wrote.
 */
export function photoFit(
  width: number,
  height: number,
): { ok: true; width: number; height: number } | { ok: false; reason: "small" | "shape" } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ok: false, reason: "small" };
  }
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short < SET_PHOTO_MIN_SIDE_PX) return { ok: false, reason: "small" };
  // A pixel to spare on the long side. Scaling to 2048 rounds the short side
  // to a whole pixel — here for the browser's canvas, and in sharp on the
  // server, both to the nearest — which can carry a photo at exactly 2.4:1
  // just past the limit (2400 × 1000 → 2048 × 853 = 2.4009:1), and the
  // server re-checks the size it was sent. With the pixel, every size this
  // passes passes again as the size it hands back (set-config.test.ts).
  if (long > SET_PHOTO_MAX_ASPECT * short + 1) return { ok: false, reason: "shape" };
  const scale = Math.min(1, SET_PHOTO_MAX_SIDE_PX / long);
  return { ok: true, width: Math.round(width * scale), height: Math.round(height * scale) };
}

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
// A photo set's source photo (2026-09-11): the person's own data, beside the
// card in their own folder of a bucket account deletion sweeps. Fixed per
// set, so deleting a set removes it without reading anything; the database
// pins a stored path to exactly this (supabase/pending/astra-photo-sets.sql).
// Written once and never rewritten: media URLs are cached as immutable.
export function setPhotoPath(userId: string, setId: string): string {
  return `${userId}/sets/${setId}.photo.jpg`;
}
