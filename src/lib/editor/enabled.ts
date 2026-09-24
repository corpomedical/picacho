import type { SupabaseClient } from "@supabase/supabase-js";

// Whether the video editor is on — the recast/enabled.ts shape: an env kill
// switch, the provider keys it cannot run without (Opus 5.5 cuts, Whisper
// listens, HeyGen draws), and its own feature_flags row (`video_editor`,
// supabase/pending/video-editor.sql).
//
// WHO: admins only (operator, 2026-09-24: "Admins only"). There is
// deliberately no "paid plans" switch yet: an edit is not charged in credits
// (no price has been set), so opening it to plans must come WITH the
// pricing, not as a flag someone can flip without it.
export async function isEditorEnabled(supabase: SupabaseClient): Promise<boolean> {
  if (process.env.VIDEO_EDITOR_DISABLED === "1") return false;
  if (!process.env.ANTHROPIC_API_KEY || !process.env.OPENAI_API_KEY || !process.env.HEYGEN_API_KEY) return false;
  try {
    const { data, error } = await supabase
      .from("feature_flags")
      .select("enabled")
      .eq("key", "video_editor")
      .maybeSingle<{ enabled: boolean }>();
    if (error || !data) return false;
    return data.enabled === true;
  } catch {
    return false;
  }
}

export const EDITOR_NOT_OPEN = "The video editor isn't open to your account yet.";
export const EDITOR_UNAVAILABLE = "The video editor is switched off for the moment.";

/** Admins, and nobody else until credit pricing exists. A suspended account never. */
export function editorAllowed(profile: { role?: unknown; status?: unknown } | null | undefined): boolean {
  return profile?.status !== "suspended" && profile?.role === "admin";
}
