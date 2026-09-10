import type { SupabaseClient } from "@supabase/supabase-js";

// Sets' kill switch (2026-09-10) — the agent/enabled.ts pattern, three
// levels, every one defaulting to OFF:
//
//   1. ASTRA_DISABLED=1 in the environment. Checked FIRST, before any
//      database read, so it still works when the database is what is wrong.
//      An instant off from the Vercel dashboard, and it also stops any poll
//      from collecting a build that is already running.
//   2. feature_flags.astra_sets. One toggle in Admin > Feature flags.
//      Inserted disabled by supabase/applied/2026-09-10/astra-sets.sql.
//   3. A missing OPENAI_API_KEY.
//
// Who may use it once it is on is set-config.ts's setsEligible: admins
// only in Phase 1.
export async function isSetsEnabled(supabase: SupabaseClient): Promise<boolean> {
  if (process.env.ASTRA_DISABLED === "1") return false;
  if (!process.env.OPENAI_API_KEY) return false;
  try {
    const { data } = await supabase
      .from("feature_flags")
      .select("enabled")
      .eq("key", "astra_sets")
      .maybeSingle<{ enabled: boolean }>();
    return data?.enabled === true;
  } catch {
    return false;
  }
}
