// Who may connect and post where, how often, and when (spec §2.1 quotas,
// §2.3 launch states; v2 #24 the X ceiling, #36 TikTok test mode; the
// operator's rule: admins first, every switch inserted OFF and read
// fail-closed).
//
//   press_tour_posting        the master switch: off = nobody posts anywhere
//   press_post_x              X for everyone with Press Tour (admins and
//                             listed testers without it)
//   press_post_tiktok_direct  TikTok straight from Picacho: admins and
//                             listed TikTok testers only (private test mode
//                             until TikTok's audit passes)
//   press_post_meta           Instagram and Threads: admins and listed
//                             testers only (until Meta's App Review passes)
// Testers are rows in press_social_testers (the operator adds them).
//
// Pure. Alias-free (vitest has no '@/').

import type { PressTourSwitches } from "../press-tour/enabled";
import type { ConnectionStatus, ConnectionView, Network } from "../press-tour/publish-types";
import {
  COMING_SOON,
  CONNECT_ON_COMPUTER,
  CONNECT_UNAVAILABLE,
  RECONNECT_NEEDED,
  SCHEDULE_INVALID,
  SCHEDULE_TIKTOK,
  SCHEDULE_TOO_FAR,
  SCHEDULE_TOO_SOON,
  TIKTOK_SAVE_INSTEAD,
  TIKTOK_TEST_MODE_NOTE,
  TRIAL_X_ONCE,
} from "./messages";

/** TikTok's Content Posting audit. Until it passes (v1), every TikTok post is "Only me" from a private account. */
export const TIKTOK_AUDITED = false;

/** Picacho's own per-person caps a day, below every platform's (spec §2.1): they protect the app's standing at each network. */
export const DAILY_POSTS_PER_PERSON: Readonly<Record<Network, number>> = {
  x: 20,
  tiktok: 5,
  instagram: 10,
  threads: 10,
};

/** Before the audit TikTok lets at most 5 people post through an app in 24 h; we count ours. */
export const TIKTOK_TEST_PEOPLE_PER_DAY = 5;

/** A schedule is at least this far ahead, and at most this far. */
export const SCHEDULE_MIN_MS = 5 * 60 * 1000;
export const SCHEDULE_MAX_MS = 30 * 24 * 60 * 60 * 1000;

export type Caller = { userId: string; via: "admin" | "plan" | "trial" };

export type PostingSwitches = Pick<
  PressTourSwitches,
  "press_tour_posting" | "press_post_x" | "press_post_tiktok_direct" | "press_post_meta"
>;

/** Is posting to this network open to this person? */
export function networkOpen(
  network: Network,
  switches: PostingSwitches,
  who: { isAdmin: boolean; testerNetworks: readonly string[] },
): boolean {
  if (!switches.press_tour_posting) return false;
  const tester = who.isAdmin || who.testerNetworks.includes(network);
  switch (network) {
    case "x":
      return switches.press_post_x || tester;
    case "tiktok":
      return switches.press_post_tiktok_direct && tester;
    case "instagram":
    case "threads":
      return switches.press_post_meta && tester;
  }
}

/** One network's row on the sheet. */
export function connectionView(input: {
  network: Network;
  open: boolean;
  configured: boolean;
  native: boolean;
  connection: { handle: string | null; displayName: string | null; status: "connected" | "needs_reconnect" } | null;
  tiktokAudited?: boolean;
}): ConnectionView {
  const testMode = input.network === "tiktok" && !(input.tiktokAudited ?? TIKTOK_AUDITED);
  const handle = input.connection?.handle ?? null;
  const displayName = input.connection?.displayName ?? null;
  if (!input.open) {
    return {
      network: input.network,
      handle,
      displayName,
      status: "coming_soon",
      canConnect: false,
      webOnly: input.native,
      testMode,
      note: input.network === "tiktok" ? TIKTOK_SAVE_INSTEAD : COMING_SOON,
    };
  }
  let status: ConnectionStatus;
  let note: string | null = null;
  if (!input.connection) status = "not_connected";
  else if (input.connection.status === "needs_reconnect") {
    status = "needs_reconnect";
    note = RECONNECT_NEEDED;
  } else status = testMode ? "test_mode" : "connected";
  if (testMode && note === null) note = TIKTOK_TEST_MODE_NOTE;
  const canConnect = input.configured && !input.native;
  if (!input.configured && status !== "connected" && status !== "test_mode") note = CONNECT_UNAVAILABLE;
  else if (input.native && (status === "not_connected" || status === "needs_reconnect")) note = CONNECT_ON_COMPUTER;
  return { network: input.network, handle, displayName, status, canConnect, webOnly: input.native, testMode, note };
}

/** When a post goes: "now", or a checked time. TikTok is never scheduled. */
export function checkWhen(
  network: Network,
  when: unknown,
  now: Date,
): { ok: true; isNow: true; at: Date } | { ok: true; isNow: false; at: Date } | { ok: false; error: string } {
  if (when === undefined || when === null || when === "now") return { ok: true, isNow: true, at: now };
  if (network === "tiktok") return { ok: false, error: SCHEDULE_TIKTOK };
  if (typeof when !== "string" || when.length > 40) return { ok: false, error: SCHEDULE_INVALID };
  const t = Date.parse(when);
  if (!Number.isFinite(t)) return { ok: false, error: SCHEDULE_INVALID };
  const at = new Date(Math.floor(t / 60_000) * 60_000);
  const ahead = at.getTime() - now.getTime();
  if (ahead < SCHEDULE_MIN_MS) return { ok: false, error: SCHEDULE_TOO_SOON };
  if (ahead > SCHEDULE_MAX_MS) return { ok: false, error: SCHEDULE_TOO_FAR };
  return { ok: true, isNow: false, at };
}

/**
 * The free trial ad (D7, a later cut): an account on the trial posts once,
 * to X. `priorPosts` counts the account's posts that went or are going
 * out (not cancelled, not failed).
 */
export function trialPostError(caller: Caller, network: Network, priorPosts: number): string | null {
  if (caller.via !== "trial") return null;
  return network === "x" && priorPosts === 0 ? null : TRIAL_X_ONCE;
}

/** The app-wide X ceiling a day (press_x_daily_cap; '0' = no posts to X). */
export function xCapOpen(cap: number): boolean {
  return Number.isFinite(cap) && cap > 0;
}

/** Backoff before an upload step is tried again: 1, 5, then 15 minutes. */
export function retryDelayMs(uploadAttempts: number): number {
  return [60_000, 5 * 60_000, 15 * 60_000][Math.min(Math.max(uploadAttempts - 1, 0), 2)];
}
