import type { SupabaseClient } from "@supabase/supabase-js";

// Whether the recast lane is on. Default OFF at three levels, the shape
// lib/sets/enabled.ts uses: an env kill switch, the provider key the lane
// cannot run without, and its own feature_flags row (`recast`, inserted
// disabled by supabase/applied/2026-09-18/recast.sql). Who may use it is decided in
// the actions — admins only while it is proved, then every paid plan (the
// operator's call, 2026-09-17); this switch only says whether it exists.
export async function isRecastEnabled(supabase: SupabaseClient): Promise<boolean> {
  if (process.env.RECAST_DISABLED === "1") return false;
  if (!process.env.FAL_KEY) return false;
  return flagOn(supabase, "recast");
}

// THE LOCK'S OWN SWITCH, and it costs money.
//
// With it on, a take whose face falls under the bar at the start, the middle
// or the end is delivered and NOT charged for — while the provider bills us
// either way. That is a deliberate exception to the house rule ("charge the
// customer exactly when the provider charged us", operator 2026-09-06) and
// therefore the operator's decision, not a default. Off, the frames are
// still scored and the number is still shown; only the refund and the
// promise on the door go away.
export async function isRecastLockOn(supabase: SupabaseClient): Promise<boolean> {
  return flagOn(supabase, "recast_lock");
}

async function flagOn(supabase: SupabaseClient, key: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("feature_flags")
      .select("enabled")
      .eq("key", key)
      .maybeSingle<{ enabled: boolean }>();
    if (error || !data) return false;
    return data.enabled === true;
  } catch {
    return false;
  }
}
