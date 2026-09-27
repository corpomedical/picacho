import { createClient } from "@/lib/supabase/server";

// Keyed by href, matching AdminCommandBar's NAV_ITEMS. Shared by
// admin/layout.tsx (the first paint, server-rendered so there's no flash of
// zero badges) and the getAdminBadgeCounts server action in
// lib/admin/actions.ts (polled from the client so the red dots update live)
// -- kept in one place so the two never drift into counting "new" two
// different ways.
/**
 * When the admin last pressed Clear on Moderation's failed renders
 * (app_settings key; 2026-09-27, operator: "Clear whatever is resolved").
 * The badge and the list count only failures after it.
 */
export const MODERATION_CLEARED_KEY = "admin_moderation_cleared_at";

export type AdminBadgeCounts = {
  "/admin/users": number;
  "/admin/moderation": number;
  "/admin/reports": number;
  "/admin/feedback": number;
};

export async function computeAdminBadgeCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<AdminBadgeCounts> {
  // Reports and Feedback already have a real open/resolved workflow, so
  // their count is genuinely "still needs handling" and shrinks as items get
  // resolved, same as an iOS Mail unread badge. Moderation's is renders
  // that FAILED -- not content anyone flagged, whatever the notice used to
  // call it (2026-09-18) -- and has no such state to hook into, so it's
  // "new in the last 24h", stops left out: a real, non-fabricated number
  // that still behaves like a notification. Users instead reads
  // app_settings.admin_users_last_viewed_at, the same timestamp
  // admin/users/page.tsx updates on every visit -- so opening that page
  // clears its own badge, rather than the badge just fading out on a fixed
  // timer whether or not anyone actually looked.
  const last24hDate = new Date();
  last24hDate.setDate(last24hDate.getDate() - 1);
  const last24h = last24hDate.toISOString();
  const { data: clearedSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", MODERATION_CLEARED_KEY)
    .maybeSingle();
  const cleared = typeof clearedSetting?.value === "string" ? clearedSetting.value : null;
  // Whichever is later: 24 hours ago, or the last Clear.
  const failedSince = cleared && cleared > last24h ? cleared : last24h;

  const [
    { data: usersLastViewedSetting },
    { count: newFailed },
    { count: openReports },
    { count: openFeedback },
  ] = await Promise.all([
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "admin_users_last_viewed_at")
      .single(),
    supabase
      .from("generations")
      .select("*", { count: "exact", head: true })
      .eq("status", "failed")
      // Not a render someone stopped on purpose: Stop saves the row as
      // failed with cancel_requested set, and a stop is nobody's problem
      // (autoReportFailedGeneration files no report for one either).
      .not("cancel_requested", "is", true)
      .gt("created_at", failedSince),
    supabase
      .from("generation_reports")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),
    supabase
      .from("feedback")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),
  ]);
  const usersLastViewedAt = usersLastViewedSetting?.value ?? new Date(0).toISOString();
  const { count: newUsers } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .gt("created_at", usersLastViewedAt);

  return {
    "/admin/users": newUsers ?? 0,
    "/admin/moderation": newFailed ?? 0,
    "/admin/reports": openReports ?? 0,
    "/admin/feedback": openFeedback ?? 0,
  };
}
