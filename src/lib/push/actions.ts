"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import { NOTIFICATION_PREFS, type NotificationPref } from "@/lib/push/prefs";

// Registering and forgetting devices for push notifications, and the
// per-account switches that decide what reaches them.
//
// Two channels: the native shell's FCM token (registerPushToken, called by
// NativePush once the person grants permission) and, since 2026-09-11, a
// browser's Web Push subscription (saveWebPushSubscription, from
// Settings → Notifications). The switches apply to both.

// The TS signature says "ios" | "android", but a server action is a public
// POST endpoint — the wire can carry anything, so the value is re-checked at
// runtime before it's stored.
const PUSH_PLATFORMS = ["ios", "android"] as const;

export async function registerPushToken(
  token: string,
  platform: "ios" | "android",
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Not signed in." };

  if (!token || token.length > 512) return { error: "Invalid token." };
  if (!PUSH_PLATFORMS.includes(platform)) return { error: "Invalid platform." };

  // Upsert on the token, so re-registering the same device updates its owner
  // and timestamp rather than adding a row. Without this, every app launch
  // would add another copy and the person would get one notification per
  // launch they'd ever made.
  //
  // Deliberately through the service-role client. Claiming a token must work
  // ACROSS owners: on a shared or resold device the token persists, and the
  // next account to sign in has to take it over — otherwise the previous
  // owner keeps receiving the new owner's notifications, the exact leak
  // forgetPushToken exists to prevent. Owner-scoped RLS can't express that
  // one write (it would either reject the re-registration or have to let any
  // user rewrite anyone's rows), so RLS stays strict (see
  // supabase/applied/2026-08-19/user-actions.sql: authenticated keeps only
  // owner-scoped SELECT/DELETE) and this single cross-owner write happens
  // server-side, keyed on the exact token string the device itself presented
  // — a caller can only ever claim a device they physically hold the token
  // for, never enumerate or reassign someone else's.
  const { error } = await createAdminClient().from("push_tokens").upsert(
    {
      token,
      user_id: userData.user.id,
      platform,
      last_seen_at: new Date().toISOString(),
      // The language this person is using RIGHT NOW, so the push sender can
      // speak it later — a push arrives with no screen open to translate it.
      // Re-registered every app launch, so a language switch follows within
      // a day.
      locale: await getLocale(),
    },
    { onConflict: "token" },
  );

  if (error) {
    console.error("registerPushToken failed:", error.message);
    return { error: "Couldn't register for notifications." };
  }

  return { error: null };
}

// Called on sign-out. Without it, the next person to sign in on a shared or
// resold device keeps receiving the previous account's notifications — which
// leaks the fact that someone else's generation finished, and is the kind of
// thing that is very hard to explain afterwards.
export async function forgetPushToken(token: string): Promise<void> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user || !token) return;

  await supabase.from("push_tokens").delete().eq("token", token).eq("user_id", userData.user.id);
}

// ---------------------------------------------------------------------------
// Browser (Web Push) devices — Settings → Notifications, 2026-09-11
// ---------------------------------------------------------------------------

const ENDPOINT_MAX = 2048;
const KEY_MAX = 256;
const DEVICES_PER_ACCOUNT = 10;

// The server POSTs to whatever endpoint is stored here, so it must be a real
// browser push service and nothing else (2026-09-11 review: any https URL was
// accepted, which let a signed-in user make the server send requests to a
// host of their choosing). Chrome/Edge/Opera, Firefox, Safari, legacy Edge.
const PUSH_SERVICE_HOST = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)$/i;

/**
 * A browser registered for pushes. Keyed on the endpoint, which the push
 * service mints per browser profile; the same cross-owner reasoning as
 * registerPushToken applies (a shared browser changing hands must move to
 * the new account), so the write goes through the service role and is keyed
 * on the exact endpoint the browser itself produced. Capped per account —
 * the oldest devices yield.
 */
export async function saveWebPushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const endpoint = String(input?.endpoint ?? "");
  const p256dh = String(input?.p256dh ?? "");
  const auth = String(input?.auth ?? "");
  let validUrl = false;
  try {
    const url = new URL(endpoint);
    validUrl = url.protocol === "https:" && PUSH_SERVICE_HOST.test(url.hostname) && !url.port;
  } catch {
    validUrl = false;
  }
  if (!validUrl || endpoint.length > ENDPOINT_MAX || !p256dh || !auth || p256dh.length > KEY_MAX || auth.length > KEY_MAX) {
    return { error: "Couldn't register for notifications." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("user_push_subscriptions").upsert(
    {
      endpoint,
      user_id: userData.user.id,
      p256dh,
      auth,
      locale: await getLocale(),
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    console.error("saveWebPushSubscription failed:", error.message);
    return { error: "Couldn't register for notifications." };
  }

  // Keep the newest few; a person who re-enables in five browsers over a
  // year should not fan every push out to all of them forever.
  const { data: rows } = await admin
    .from("user_push_subscriptions")
    .select("endpoint, last_used_at")
    .eq("user_id", userData.user.id)
    .order("last_used_at", { ascending: false, nullsFirst: false });
  const stale = (rows ?? []).slice(DEVICES_PER_ACCOUNT).map((r) => r.endpoint as string);
  if (stale.length) await admin.from("user_push_subscriptions").delete().in("endpoint", stale);

  return { error: null };
}

/** This browser stops receiving pushes. Owner-scoped: only your own row. */
export async function removeWebPushSubscription(endpoint: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };
  if (!endpoint) return { error: null };
  await createAdminClient()
    .from("user_push_subscriptions")
    .delete()
    .eq("endpoint", String(endpoint))
    .eq("user_id", userData.user.id);
  return { error: null };
}

/**
 * One of the three switches. Written through the service role because the
 * 2026-08-18 profiles lockdown narrowed the UPDATE grant — the same path as
 * setMarketingEmails. The column name is checked against the fixed list, so
 * the wire cannot name any other profiles column.
 */
export async function setNotificationPref(pref: NotificationPref, enabled: boolean): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };
  if (!(NOTIFICATION_PREFS as readonly string[]).includes(pref) || typeof enabled !== "boolean") {
    return { error: "Invalid setting." };
  }
  const { error } = await createAdminClient()
    .from("profiles")
    .update({ [pref]: enabled })
    .eq("id", userData.user.id);
  if (error) {
    console.error("setNotificationPref failed:", error.message);
    return { error: "Couldn't save that — try again." };
  }
  revalidatePath("/app/settings");
  return { error: null };
}
