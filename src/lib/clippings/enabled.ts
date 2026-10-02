import type { SupabaseClient } from "@supabase/supabase-js";
import { pressTourEnvReady } from "../press-tour/enabled";

// Whether Clippings exists, and which networks it reads: the three switches
// supabase/pending/press-clippings.sql inserts OFF (pinned by enabled.test.ts).
// Every one fails CLOSED, and none opens anything while press_tour is off.
//
//   press_clippings            the tab, uploads and Press Tour's own ads
//   press_clippings_instagram  connecting asks Instagram for the reading
//                              permission, and reads views and words
//   press_clippings_tiktok     connecting asks TikTok for video.list, and
//                              reads views (TikTok shares no file)
//
// A network switch goes on only after its permission is added to the app at
// Meta / TikTok: before that, asking for it would break connecting.
//
// Alias-free (vitest has no '@/').

export const CLIPPINGS_FLAGS = ["press_clippings", "press_clippings_instagram", "press_clippings_tiktok"] as const;
export type ClippingsFlag = (typeof CLIPPINGS_FLAGS)[number];

export type ClippingsSwitches = { on: boolean; instagram: boolean; tiktok: boolean };
export const CLIPPINGS_OFF: ClippingsSwitches = { on: false, instagram: false, tiktok: false };

/** Pure: the switches from feature_flags rows (press_tour among them). */
export function clippingsFromRows(rows: readonly unknown[]): ClippingsSwitches {
  const on = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { key, enabled } = row as { key?: unknown; enabled?: unknown };
    if (typeof key === "string" && enabled === true) on.add(key);
  }
  if (!on.has("press_tour") || !on.has("press_clippings")) return CLIPPINGS_OFF;
  return { on: true, instagram: on.has("press_clippings_instagram"), tiktok: on.has("press_clippings_tiktok") };
}

export async function readClippingsSwitches(db: SupabaseClient): Promise<ClippingsSwitches> {
  if (!pressTourEnvReady()) return CLIPPINGS_OFF;
  try {
    const { data, error } = await db
      .from("feature_flags")
      .select("key, enabled")
      .in("key", ["press_tour", ...CLIPPINGS_FLAGS]);
    if (error || !Array.isArray(data)) return CLIPPINGS_OFF;
    return clippingsFromRows(data);
  } catch {
    return CLIPPINGS_OFF;
  }
}
