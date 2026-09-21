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

// OPEN TO EVERY PAID PLAN since 2026-09-19: the operator launched ("Lets
// get helios ready for launch" → "Do it") ahead of the §4 eval
// (docs/ASTRA_SETS.md), which remains owed as a post-launch check — parts
// A–E are built and priced but were never run, for want of provider
// balance. The flag (astra_sets) is still the kill switch above this, and
// ASTRA_DISABLED=1 above that (enabled.ts). Every paid plan builds sets,
// shoots stills, takes clips and renders films — takes and films opened
// with the same word ("Open to all plans", setTakesEligible below). The
// composer's own storyboard lane stays Studio-and-up (plans.ts
// advancedVideoPlan): a set take passes its frames check as a
// server-built request, never by plan. Closing again is this one line.
export const SETS_OPEN_TO_PLANS = true;

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

/**
 * Takes and films: every plan that can enter Helios (the operator's
 * 2026-09-19 "Open to all plans"). Its own name, not an alias in callers,
 * so tightening it again is one line here.
 */
export function setTakesEligible(plan: string | null | undefined, isAdmin: boolean): boolean {
  return setsEligible(plan, isAdmin);
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
// the 400-shape limit, the retry is a fresh build told which sides to close.
// (The 40-shape room was set when the normaliser dropped whatever came past
// the limit, added walls included; since 2026-09-11 it trims the smallest
// repeats instead and drops nothing, so a mend's walls would now survive.
// The room is kept, conservatively, until a mend near the limit is measured.)
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

// PHOTO BUILDS (docs 3.2, 2026-09-11). The research probe: 1,992 input / 12,834 output tokens
// (4,007 reasoning), 264 s, $0.667 — the text cap of 10,000 would have cut it off. Three test
// builds through this code (docs 3.2 status): 3,991–4,126 input (1,844 of them the cached prefix),
// 9,078–12,455 output, 123–183 s, $0.49–$0.65.
//
//   first attempt, worst case = 4,800 input tokens, all billed as cache writes:
//     ~1,850 prefix (instructions + schema) + SET_PHOTO_RULES (≤ 2,000 chars ≈ ≤ 500)
//     + notes (≤ 300 chars, ≤ ~300 tokens in any script) + the photo (≤ 2,048 px, budget ≈ 2,150;
//     measured: the rules + a 1536×1024 photo ≈ 2,150–2,280 over the prefix; every photo
//     build still logs its usage)
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
// 4,900 since 2026-09-15: the photo rules gained the human ruler (~100
// tokens) after a build sized a sofa's seat at hip height.
export const SET_PHOTO_BUILD_INPUT_TOKENS = 4_900;
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

// MATCH THIS SHOT (docs 3.2, 2026-09-11; admins only, behind astra_photo_sets). One Astra
// call reads a reference picture's camera; only numbers come back (match-shot.ts). The
// research probe read layout and camera from one photo: 1,821 input / 1,608 output tokens
// (285 reasoning), 41.8 s, $0.103, at the default effort — this asks for less (no layout).
//
//   worst case per match = 3,300 input tokens, all billed as cache writes: the instructions,
//     schema and one line (2,860 characters ≈ 650 tokens at the 4.4 characters a token the set
//     prefix measured, 8,132 → 1,822–1,843; match-shot.test.ts holds them inside this budget)
//     + the picture (≤ 2,048 px, the photo build's image budget of ≈ 2,150) = ~2,800, with
//     ~500 to spare; every match logs its usage
//     + output to the 2,500-token cap
//     = 3,300 × $12.50/1M + 2,500 × $50/1M = $0.04125 + $0.125 = $0.16625
//   The burst brake: 10 an hour → 10 × $0.16625 = $1.6625 an hour per admin at most.
// Nothing is stored and no allowance moves: admins only, bounded by the brake. Every answer's
// usage is logged, and one past its input budget is flagged (match-actions.ts).
export const SET_MATCH_EFFORT = "low" as const;
export const SET_MATCH_MAX_OUTPUT_TOKENS = 2_500;
export const SET_MATCH_INPUT_TOKENS = 3_300;
export const SET_MATCH_PER_HOUR = 10;
// The match waits for its answer inside the server action, which runs under the set page's
// 300 s budget (app/app/sets/[id]/page.tsx maxDuration), after a picture check that can read
// for up to ~100 s. The clock runs from the action's start: no read starts with under 45 s
// left, no poll starts past 270 s, and the last one (15 s timeout) plus the cancel (10 s)
// still ends inside the budget.
export const SET_MATCH_POLL_MS = 2_500;
export const SET_MATCH_DEADLINE_MS = 270_000;
/** A read is not started with less than this left before the deadline: the one measured read took 41.8 s. */
export const SET_MATCH_MIN_READ_MS = 45_000;

// The Set Editor's Astra edits (2026-09-14): the prompt bar sends the working
// spec and one change request, and waits inside the server action like a
// match does — well inside the set page's 300 s budget. The request rides
// the build's own caps (SET_BUILD_EFFORT, SET_BUILD_MAX_OUTPUT_TOKENS): an
// edit writes the same shape of answer a build does.
export const SET_EDIT_MAX_CHARS = 300;
export const SET_EDIT_POLL_MS = 2_500;
export const SET_EDIT_DEADLINE_MS = 180_000;
export const SET_EDIT_PER_10_MIN = 10;

// An Astra edit is a build's call without the retry, and like a build it is
// free to the person, so its spend is bounded the same way: a monthly cap
// per plan, counted from the billing month's start (2026-09-16 — until then
// only SET_EDIT_PER_10_MIN held it, and a working copy of any size was sent,
// up to $1.21 a call at the largest set the normaliser keeps; on the order
// of $70 an hour for one person). From lib/astra/prices.ts:
//
//   worst case = the largest input an edit sends (the instructions, the
//     schema and a working copy at SET_EDIT_MAX_SPEC_CHARS, below, with the
//     longest request: 21,536 characters ≈ 9,615 tokens at 2.24 characters
//     per token — 20,855 until the material words and 21,378 until the
//     area light's size, both 2026-09-17), all billed as cache writes,
//     + output to the 10,000-token cap
//     = 9,615 × $12.50/1M + 10,000 × $50/1M = $0.12 + $0.50 = $0.62
//   the one live edit measured (2026-09-15, a race track): $0.31
//
//   At twice the build cap, a month's edits at worst cost:
//     Basic 2 → $1.24 of $9      Starter 4 → $2.48 of $19   Growth 10 → $6.20 of $79
//     Studio 20 → $12.40 of $299   Elite 50 → $31.01 of $499
//   — the operator's numbers to move before SETS_OPEN_TO_PLANS flips.
export const SET_EDITS_MONTHLY_LIMITS = {
  none: 0,
  basic: 2,
  starter: 4,
  growth: 10,
  studio: 20,
  elite: 50,
} as const satisfies Record<PlanId, number>;

/**
 * The largest working copy Astra is asked to change. An edit answers with the
 * WHOLE revised set under the build's 10,000-token cap, exactly as a closing
 * retry's mend does, so it holds the mend's bound (SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS:
 * ~8,300 answer tokens at 0.52 per character, with room for what the change
 * adds). Past it the answer is cut off, fails, and is paid for all the same —
 * a set the editor's own tools grew past this is changed with those tools.
 */
export const SET_EDIT_MAX_SPEC_CHARS = SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS;

/** The limiter's bucket the month's Astra changes are counted in (editor-actions.ts, data.ts). */
export const SET_EDITS_MONTH_SCOPE = "set-astra-edit-month";

/** -1 = unlimited (admin), as setBuildsMonthlyLimit. */
export function setEditsMonthlyLimit(plan: string | null | undefined, isAdmin: boolean): number {
  if (isAdmin) return -1;
  return SET_EDITS_MONTHLY_LIMITS[(plan ?? "none") as PlanId] ?? 0;
}

// The stage camera's tilt (set-view.tsx). OrbitControls keeps the camera within 0.62π of
// straight down from what it looks at, so a tilt past ~21° up would move the camera; the aim
// arrows and a matched shot stop just short of it.
export const SET_MAX_TILT_UP_DEG = 20;
export const SET_MAX_TILT_DOWN_DEG = 80;

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
// pins a stored path to exactly this (supabase/applied/2026-09-11/astra-photo-sets.sql).
// Written once and never rewritten: media URLs are cached as immutable.
export function setPhotoPath(userId: string, setId: string): string {
  return `${userId}/sets/${setId}.photo.jpg`;
}
// A look's cutout (2026-09-12): the objects cut out of an earlier still of
// the set onto grey (look-cutout.ts), made the first time that still is a
// look and reused by every later shot that takes it. The person's own data,
// beside the card: fixed per set and still, so deleting the set removes
// every cutout by listing its folder for LOOK_CUTOUT_PREFIX, and account
// deletion sweeps the folder. Written once and never rewritten.
const LOOK_CUTOUT_INFIX = ".look-";
export function setLookCutoutPath(userId: string, setId: string, lookGenerationId: string): string {
  return `${userId}/sets/${setId}${LOOK_CUTOUT_INFIX}${lookGenerationId}.jpg`;
}
/** What the name of every cutout of one set starts with, inside `<user>/sets/`. */
export function setLookCutoutPrefix(setId: string): string {
  return `${setId}${LOOK_CUTOUT_INFIX}`;
}
// A look's object sheet (2026-09-14): the cutout's objects drawn four ways on
// grey by the image model (look-sheet.ts), what a shot actually carries as
// its look. Kept beside the cutout it was drawn from, under the same rules:
// made once per still, removed with the set or the still.
const LOOK_SHEET_INFIX = ".sheet-";
export function setLookSheetPath(userId: string, setId: string, lookGenerationId: string): string {
  return `${userId}/sets/${setId}${LOOK_SHEET_INFIX}${lookGenerationId}.jpg`;
}
/** What the name of every object sheet of one set starts with, inside `<user>/sets/`. */
export function setLookSheetPrefix(setId: string): string {
  return `${setId}${LOOK_SHEET_INFIX}`;
}
// A reference photo (2026-09-21, "we need to add an option to upload
// reference images"): a photo of something the set should hold — a car, a
// sofa, a storefront. The first ones (the Look menu's, before R1) were
// named by id alone, with a sheet of their own; since R1 a photo goes on a
// thing and names it (setElementPhotoPath below), and an old one reads as a
// photo on nothing until it is put on one (element-actions.ts). Beside the
// set's other files, under the same rules: removed with the set by listing
// its folder for these prefixes, swept by account deletion.
// ".refsheet-" never starts with ".ref-", so the two prefixes never overlap.
const REF_INFIX = ".ref-";
const REF_SHEET_INFIX = ".refsheet-";
export function setRefPhotoPath(userId: string, setId: string, refId: string): string {
  return `${userId}/sets/${setId}${REF_INFIX}${refId}.jpg`;
}
export function setRefSheetPath(userId: string, setId: string, refId: string): string {
  return `${userId}/sets/${setId}${REF_SHEET_INFIX}${refId}.jpg`;
}
/** What the name of every reference photo of one set starts with, inside `<user>/sets/`. */
export function setRefPrefix(setId: string): string {
  return `${setId}${REF_INFIX}`;
}
/** What the name of every sheet drawn from one set's reference photos starts with. */
export function setRefSheetPrefix(setId: string): string {
  return `${setId}${REF_SHEET_INFIX}`;
}

/**
 * Photos on the set's things (R1, 2026-09-21, elements.ts): each keeps the
 * key of the thing it was put on, its slot (1 the front, then up to 3 more
 * sides), when it came (seconds, base 36: order never rests on storage's
 * own dates) and its id, in its name — no table. They share the
 * references' `.ref-` prefix, so a set's deletion already sweeps them;
 * today's bare `.ref-<id>.jpg` photos read as photos on nothing.
 */
export const ELEMENT_SET_PHOTOS_MAX = 24;
export function setElementPhotoPath(userId: string, setId: string, anchor: string, slot: number, atSeconds: number, refId: string): string {
  return `${userId}/sets/${setId}${REF_INFIX}${anchor}.${slot}.${Math.max(0, Math.floor(atSeconds)).toString(36)}.${refId}.jpg`;
}
/** The name after a set's `.ref-` prefix, without `.jpg`: anchor, slot, time (base 36), id. */
export const ELEMENT_PHOTO_NAME = /^([cvo]_[0-9a-f]{8}_-?\d{1,4}_-?\d{1,4})\.([1-4])\.([0-9a-z]{1,8})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const ELEMENT_SHEET_INFIX = ".elsheet-";
/** A thing's sheet, named by the photos it was drawn from (elements.ts sheetHashOf): a rename never makes it stale. */
export function setElementSheetPath(userId: string, setId: string, hash: string): string {
  return `${userId}/sets/${setId}${ELEMENT_SHEET_INFIX}${hash}.jpg`;
}
export function setElementSheetPrefix(setId: string): string {
  return `${setId}${ELEMENT_SHEET_INFIX}`;
}
