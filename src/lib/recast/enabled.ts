import type { SupabaseClient } from "@supabase/supabase-js";

// Whether the recast lane is on. Default OFF at three levels, the shape
// lib/sets/enabled.ts uses: an env kill switch, the provider key the lane
// cannot run without, and its own feature_flags row (`recast`, inserted
// disabled by supabase/pending/recast.sql). Who may use it is decided in
// the actions — admins only while it is proved, then every paid plan (the
// operator's call, 2026-09-17); this switch only says whether it exists.
export async function isRecastEnabled(supabase: SupabaseClient): Promise<boolean> {
  if (process.env.RECAST_DISABLED === "1") return false;
  if (!process.env.FAL_KEY) return false;
  try {
    const { data, error } = await supabase
      .from("feature_flags")
      .select("enabled")
      .eq("key", "recast")
      .maybeSingle<{ enabled: boolean }>();
    if (error || !data) return false;
    return data.enabled === true;
  } catch {
    return false;
  }
}
