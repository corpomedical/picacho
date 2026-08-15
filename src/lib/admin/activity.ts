import { createAdminClient } from "@/lib/supabase/server";

// Sign-in / session facts for the admin area.
//
// auth.users and auth.sessions aren't exposed through PostgREST, so this
// reads them through public.admin_user_auth_activity() — SECURITY DEFINER,
// executable only by service_role, called here with the service-role client.
// Nothing about it is reachable from the browser.

// How recently someone must have been seen to count as online. Matches the
// window Admin > Stats already uses for its "online now" figure, so the two
// screens can never disagree about who is on the site.
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export type UserActivity = {
  lastSignInAt: string | null;
  lastSeenAt: string | null;
  // Sessions still valid right now — effectively "signed-in devices".
  activeSessions: number;
  sessionStartedAt: string | null;
  // Time actually spent on the site during the current (or most recent)
  // visit — accumulated from heartbeats, so time signed in but away is not
  // counted. Null when nothing has been measured yet.
  sessionSeconds: number | null;
  // Lifetime time on site, accumulated the same way.
  totalActiveSeconds: number | null;
  // How long the session has been VALID (sign-in to last activity). Kept
  // separate because it answers a different question to sessionSeconds and
  // is what the sign-in/security view wants.
  signedInForSeconds: number | null;
  online: boolean;
};

type Row = {
  user_id: string;
  last_sign_in_at: string | null;
  active_sessions: number | null;
  last_session_started_at: string | null;
  last_session_active_at: string | null;
};

export async function getUserActivity(
  users: {
    id: string;
    last_seen_at?: string | null;
    session_started_at?: string | null;
    session_seconds?: number | null;
    total_active_seconds?: number | null;
  }[],
): Promise<Map<string, UserActivity>> {
  const result = new Map<string, UserActivity>();
  if (users.length === 0) return result;

  let rows: Row[] = [];
  try {
    const admin = createAdminClient();
    const { data } = await admin.rpc("admin_user_auth_activity", {
      p_user_ids: users.map((u) => u.id),
    });
    rows = (data ?? []) as Row[];
  } catch {
    // Never let a missing service-role key or a lookup hiccup take down the
    // Users page — it degrades to blank activity columns instead.
    rows = [];
  }

  const byId = new Map(rows.map((r) => [r.user_id, r]));
  const now = Date.now();

  for (const user of users) {
    const row = byId.get(user.id);
    const lastSeenAt = user.last_seen_at ?? null;
    const lastSignInAt = row?.last_sign_in_at ?? null;

    // The later of the two activity signals: last_seen_at is stamped by the
    // app on real page views, while the session's own timestamp only moves
    // when the token refreshes. Whichever happened last is the truth.
    const endCandidates = [lastSeenAt, row?.last_session_active_at ?? null]
      .filter((v): v is string => Boolean(v))
      .map((v) => new Date(v).getTime())
      .filter((n) => Number.isFinite(n));
    const endMs = endCandidates.length ? Math.max(...endCandidates) : null;
    const startMs = lastSignInAt ? new Date(lastSignInAt).getTime() : null;

    const signedInForSeconds =
      startMs !== null && endMs !== null && endMs > startMs
        ? Math.floor((endMs - startMs) / 1000)
        : null;

    // Measured time on site. Explicitly null (not 0) when nothing has ever
    // been recorded, so the UI can say "not measured yet" for accounts that
    // predate heartbeat tracking instead of claiming a truthful-looking 0m.
    const measured = user.session_seconds ?? 0;
    const total = user.total_active_seconds ?? 0;
    const everMeasured = measured > 0 || total > 0;

    result.set(user.id, {
      lastSignInAt,
      lastSeenAt,
      activeSessions: row?.active_sessions ?? 0,
      sessionStartedAt: user.session_started_at ?? row?.last_session_started_at ?? null,
      sessionSeconds: everMeasured ? measured : null,
      totalActiveSeconds: everMeasured ? total : null,
      signedInForSeconds,
      online: endMs !== null && now - endMs < ONLINE_WINDOW_MS,
    });
  }

  return result;
}

// "2d 4h", "3h 12m", "8m", "45s" — two units at most, so a column of these
// stays scannable.
export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "—";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 ? `${hours}h ${mins % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}
