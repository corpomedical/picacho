// Relative imports on purpose: the test loads this module, and vitest has no
// "@/" alias configured (the repo's standing gotcha).
import { createHash } from "node:crypto";
import type { FollowOutcome } from "../generations/repeat-send";

// ONE PRESS, DELIVERED TWICE (audited 2026-09-22, after 5058a4a). Chromium,
// the Android WebView included, silently resends a request, a POST included,
// when a reused connection drops before response headers arrive, and the page
// only sees the second answer (generations/repeat-send.ts has the incident).
//
// A Take press stays open for the whole start: the clip read from storage,
// the words judged, the window cut (a long take's prepared at 24 fps), the
// clip and every added image judged, the reservation, and a submit per take.
// That is tens of seconds on a short clip and minutes on a long one, all of
// it before the action answers. Nothing stopped a second delivery. The rate
// limit allows 30 starts an hour to an admin and 8 to anyone else, there is
// no cooldown and no in-flight check, and the take rows' ids were minted on
// the server, so the resend never met a primary key. It would have reserved,
// charged and rendered a SECOND take, with the page showing only that one.
//
// So the door names each press (a fresh id per press, never per render),
// and every row that press reserves takes its id from that name: the first
// take's id IS the press's id, and each variant's is made from it here. The
// two deliveries therefore reserve the SAME ids. Whichever reserves second
// meets the primary key (the reservation is one transaction, so none of its
// rows are written) and follows the takes the other started instead of
// failing. That holds whichever delivery gets there first, and however far
// apart they arrive.

/** The most takes one press can start: one per character cast, up to four. */
export const RECAST_MAX_TAKES = 4;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The press's own id as the door sent it, or null when there is none to trust as a row id. */
export function parseRecastSendId(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value.toLowerCase() : null;
}

/**
 * The row ids of a press's takes, in take order: the press's own id for the
 * first, and for each later take an id made from it (SHA-256, stamped as a
 * version-8 UUID, RFC 9562's version for ids made by a rule of one's own).
 * The same press always gives the same ids, and a different press never
 * does. Take i's id depends on the press and on i alone, so the ids for fewer
 * takes are always the start of the ids for more.
 */
export function recastTakeIds(sendId: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => (i === 0 ? sendId : variantId(sendId, i)));
}

function variantId(sendId: string, take: number): string {
  const bytes = createHash("sha256").update(`recast-take:${sendId}:${take}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * startRecastTakes' answer for a repeat, or null when this is not one: the
 * takes the other delivery reserved, in take order, which is the answer that
 * delivery gives.
 *
 * Its rows are the truth from here. The door adds a card per id and re-reads
 * each row, so a take that failed to start shows as failed on its own card
 * (its credits already refunded by force). "Still going" when the clock ran
 * out is answered the same way. Those rows exist and are charged, and
 * answering with an error would leave the setup filled in for a second
 * press, which is a second charge.
 */
export function recastRepeatAnswer(
  outcome: FollowOutcome,
  pressIds: string[],
): null | { error: null; ids: string[] } {
  if (outcome.kind === "none") return null;
  const found = new Set(outcome.kind === "settled" ? outcome.takes.map((t) => t.id) : outcome.ids);
  const ids = pressIds.filter((id) => found.has(id));
  return ids.length > 0 ? { error: null, ids } : null;
}
