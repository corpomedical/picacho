"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";

// Registering and forgetting a device for push notifications.
//
// Called from the mobile shell once the person has granted permission. On the
// web these are never invoked — there's no Capacitor runtime to produce a
// token — so nothing here needs a browser fallback.

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
