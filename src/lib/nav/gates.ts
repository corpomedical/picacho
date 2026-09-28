import type { SupabaseClient } from "@supabase/supabase-js";
import { isRecceEnabled, isSetsEnabled } from "@/lib/sets/enabled";
import { isRecastEnabled } from "@/lib/recast/enabled";
import { isLiveEnabled, isLiveOpenToPlans, liveAllowed } from "@/lib/live/enabled";
import { isEditorEnabled } from "@/lib/editor/enabled";
import { isPressTourEnabled } from "@/lib/press-tour/enabled";
import { setsEligible } from "@/lib/sets/set-config";
import type { ToolGates } from "@/lib/nav/tools";

/**
 * Which gated tools this account may open: the app layout's sidebar, tab bar
 * and lamp, and a take's "Keep going" doors (2026-09-28) all read this one
 * rule, so a door can never offer a tool its menu hides.
 */
export async function readToolGates(
  supabase: SupabaseClient,
  profile: { role?: unknown; plan?: unknown; status?: unknown } | null | undefined,
): Promise<ToolGates> {
  const isAdmin = profile?.role === "admin";
  // Each check reads its plan or role first, so an account that can't open a
  // tool skips that tool's flag read.
  // Sets: admins in Phase 1, then the plans setsEligible names.
  const setsVisible = setsEligible(profile?.plan as string | null | undefined, isAdmin) && (await isSetsEnabled(supabase));
  // The Recce door (board K): admins only while in testing, behind its own
  // flag with both Sets switches under it.
  const recceVisible = isAdmin && (await isRecceEnabled(supabase));
  // Recast: admins only while the lane is proved, behind its own flag.
  const mystiqueVisible = isAdmin && (await isRecastEnabled(supabase));
  // Live (H3 Max Director, 2026-09-24): admins, and every paid plan once
  // `live_paid_plans` is on (lib/live/enabled.ts), behind its own switch.
  const liveVisible =
    !liveAllowed(profile, true).error &&
    (isAdmin || (await isLiveOpenToPlans(supabase))) &&
    (await isLiveEnabled(supabase));
  // Director's Cut (2026-09-24): admins only, behind the video_editor switch.
  const cutVisible = isAdmin && (await isEditorEnabled(supabase));
  // Press Tour (2026-09-26): admins only while it is built, behind the
  // press_tour switch (which also needs its provider keys).
  const pressTourVisible = isAdmin && (await isPressTourEnabled(supabase));
  return { setsVisible, recceVisible, mystiqueVisible, liveVisible, cutVisible, pressTourVisible };
}
