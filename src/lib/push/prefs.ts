// Which per-account preference governs each push message — pure and
// alias-free so the mapping is unit-testable (the vitest "@/" gotcha).
//
// Three toggles, not one per key: a person thinks in outcomes ("tell me
// when it's done", "tell me when something went wrong", "warn me before I
// run out"), and every key belongs to exactly one of them. A key that maps
// to nothing would ship silently un-toggleable, so the map is total by
// type and pinned by test.
import type { PushMessage } from "./send";

export const NOTIFICATION_PREFS = ["notify_render_ready", "notify_render_failed", "notify_low_credits"] as const;
export type NotificationPref = (typeof NOTIFICATION_PREFS)[number];

export const PREF_FOR_KEY: Record<PushMessage["key"], NotificationPref> = {
  videoReady: "notify_render_ready",
  layersReady: "notify_render_ready",
  videoFailed: "notify_render_failed",
  videoFailedRefunded: "notify_render_failed",
  lowCredits: "notify_low_credits",
  // A set finishing or failing (the Sets finisher, 2026-09-11) is the same
  // outcome as a render doing so: "tell me when it's done", "tell me when
  // something went wrong".
  setReady: "notify_render_ready",
  setFailed: "notify_render_failed",
  // Press Tour (2026-09-26): a finished ad and a post that went out are
  // "tell me when it's done"; an ad that couldn't be finished, a post that
  // didn't go out and an account to connect again are "tell me when
  // something went wrong".
  adReady: "notify_render_ready",
  adFailed: "notify_render_failed",
  adFailedRefunded: "notify_render_failed",
  postPublished: "notify_render_ready",
  postFailed: "notify_render_failed",
  reconnectNeeded: "notify_render_failed",
};
