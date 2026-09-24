import type { SupabaseClient } from "@supabase/supabase-js";
import { thumbUrl, toMediaUrl } from "@/lib/media/url";
import {
  DEFAULT_IDENTITY_THRESHOLD,
  resolveIdentityThresholdSetting,
} from "@/lib/generations/identity-gate";

// The watch list (2026-09-24): finished renders that came back scoring low
// since the person last opened the Producer. They light a dot on the lamp and
// show as cards in the sheet; nothing is spent until the person asks the
// Producer to look.
//
// LOW is the identity gate's own bar — the live Admin setting, or its default
// while the gate is off — the same line Helios's contact sheet flags stills
// against (sets/data.ts). One number for "this face drifted" across the app,
// rather than a second threshold to explain when the dot lights or doesn't.
export const WATCH_DAYS = 7;

/** The score below which a render goes on the watch list. */
export async function loadWatchBar(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "identity_gate_threshold")
    .maybeSingle();
  const threshold = resolveIdentityThresholdSetting(data);
  return threshold > 0 ? threshold : DEFAULT_IDENTITY_THRESHOLD;
}
export const WATCH_MAX = 5;

export type WatchItem = {
  id: string;
  createdAt: string;
  kind: "image" | "video";
  score: number;
  notes: string | null;
  prompt: string;
  thumb: string | null;
};

function windowStart(seenAt: string | null | undefined): string {
  const floor = Date.now() - WATCH_DAYS * 24 * 60 * 60 * 1000;
  const seen = seenAt ? new Date(seenAt).getTime() : 0;
  return new Date(Math.max(floor, Number.isFinite(seen) ? seen : 0)).toISOString();
}

/** Low-scoring finished renders since `seenAt` (and within the last week). */
export async function loadWatchList(
  supabase: SupabaseClient,
  userId: string,
  seenAt: string | null | undefined,
  bar: number,
): Promise<WatchItem[]> {
  const { data, error } = await supabase
    .from("generations")
    .select("id, created_at, content_type, match_score, match_notes, prompt_input, result_url, poster_url")
    .eq("user_id", userId)
    .eq("status", "succeeded")
    .is("deleted_at", null)
    .not("match_score", "is", null)
    .lt("match_score", bar)
    .gt("created_at", windowStart(seenAt))
    .order("created_at", { ascending: false })
    .limit(WATCH_MAX);
  if (error) {
    console.error("producer-watch: unavailable —", error.message);
    return [];
  }
  return (data ?? []).map((g) => {
    const kind = g.content_type === "image" ? "image" : "video";
    const still = kind === "image" ? g.result_url : g.poster_url;
    return {
      id: g.id as string,
      createdAt: g.created_at as string,
      kind,
      score: g.match_score as number,
      notes: (g.match_notes as string | null) ?? null,
      prompt: String(g.prompt_input ?? ""),
      thumb: thumbUrl(toMediaUrl(still as string | null), 320),
    };
  });
}

/** Just the count, for the lamp's dot. Head-only: no rows are pulled. */
export async function countWatch(
  supabase: SupabaseClient,
  userId: string,
  seenAt: string | null | undefined,
  bar: number,
): Promise<number> {
  const { count, error } = await supabase
    .from("generations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "succeeded")
    .is("deleted_at", null)
    .not("match_score", "is", null)
    .lt("match_score", bar)
    .gt("created_at", windowStart(seenAt));
  if (error) return 0;
  return Math.min(count ?? 0, WATCH_MAX);
}
