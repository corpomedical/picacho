import type { createClient } from "@/lib/supabase/server";
import { NO_DEFAULTS, defaultsFromRow, type GenerationDefaults } from "@/lib/generations/generation-defaults";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * This account's composer defaults (Settings → Generation). A separate,
 * fail-open read on purpose: callers also read plan and credits from
 * profiles, and those selects must never fail over a column the pending SQL
 * has not added yet. No column, no preference.
 */
export async function readGenerationDefaults(supabase: SupabaseServerClient, userId: string): Promise<GenerationDefaults> {
  if (!userId) return NO_DEFAULTS;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("default_video_model, default_aspect_ratio, default_video_duration, video_sound")
      .eq("id", userId)
      .maybeSingle();
    if (error) return NO_DEFAULTS;
    return defaultsFromRow(data as Record<string, unknown> | null);
  } catch {
    return NO_DEFAULTS;
  }
}

/** The two render switches from Settings → Notifications. Fail open: no column, both on. */
export async function readRenderNotifyPrefs(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<{ ready: boolean; failed: boolean }> {
  if (!userId) return { ready: true, failed: true };
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("notify_render_ready, notify_render_failed")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) return { ready: true, failed: true };
    const row = data as { notify_render_ready?: boolean; notify_render_failed?: boolean };
    return { ready: row.notify_render_ready !== false, failed: row.notify_render_failed !== false };
  } catch {
    return { ready: true, failed: true };
  }
}

