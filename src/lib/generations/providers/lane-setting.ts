// The operator's Seedance provider choice, stored in app_settings.
//
// WHY THIS EXISTS (2026-09-06, operator: "How can I pick fal's seedance from
// Byteplus"). Until now the only control over the lane was an environment
// variable, which meant every change — including a rollback — cost a redeploy
// and was invisible until it landed. That is the wrong shape for a switch
// whose whole purpose is to be reversible the moment a render looks wrong.
//
// The env flag stays the ENABLER and this setting is the PICKER. Both must
// agree before a render leaves fal (see videoProviderFor), so a row written
// here can only ever move traffic back to the proven provider, never onto an
// unproven one. Storing the safe direction in the database and the dangerous
// one in the environment is deliberate.
import { createAdminClient } from "@/lib/supabase/server";
import type { VideoProvider } from "./video-provider";

export const SEEDANCE_LANE_KEY = "seedance_provider";

/**
 * Which provider the operator has picked for Seedance, or null when they have
 * never picked one (in which case the environment decides, exactly as before).
 *
 * Best-effort by design. This sits on the paid submit path, so a database
 * blip must not fail a render that is otherwise ready to send: an unreadable
 * setting reads as "no choice recorded" and the environment answers, which is
 * the same behaviour every render had before the picker existed.
 *
 * Service client because app_settings' only SELECT policy is for
 * authenticated users, and renders are also submitted from the job runner and
 * the webhook collectors, where there is no user session in scope.
 */
export async function seedanceLaneChoice(): Promise<VideoProvider | null> {
  try {
    const { data } = await createAdminClient()
      .from("app_settings")
      .select("value")
      .eq("key", SEEDANCE_LANE_KEY)
      .maybeSingle<{ value: string | null }>();
    const value = data?.value;
    return value === "fal" || value === "byteplus" ? value : null;
  } catch {
    return null;
  }
}
