"use server";

import { createClient } from "@/lib/supabase/server";

// Registering and forgetting a device for push notifications.
//
// Called from the mobile shell once the person has granted permission. On the
// web these are never invoked — there's no Capacitor runtime to produce a
// token — so nothing here needs a browser fallback.

export async function registerPushToken(
  token: string,
  platform: "ios" | "android",
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Not signed in." };

  if (!token || token.length > 512) return { error: "Invalid token." };

  // Upsert on the token, so re-registering the same device updates its owner
  // and timestamp rather than adding a row. Without this, every app launch
  // would add another copy and the person would get one notification per
  // launch they'd ever made.
  const { error } = await supabase.from("push_tokens").upsert(
    {
      token,
      user_id: userData.user.id,
      platform,
      last_seen_at: new Date().toISOString(),
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
