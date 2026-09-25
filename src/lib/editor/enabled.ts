import type { SupabaseClient } from "@supabase/supabase-js";

// Whether the video editor is on — the recast/enabled.ts shape: an env kill
// switch, what it cannot run without (the Managed Agent that edits, created by
// scripts/directors-cut-setup.mts in the workspace of
// DIRECTORS_CUT_ANTHROPIC_API_KEY, else of ANTHROPIC_API_KEY — see
// agent.ts editorApiKey; Whisper listens on our OpenAI key), and its own
// feature_flags row (`video_editor`,
// supabase/applied/2026-09-25/video-editor.sql). HeyGen is no longer needed:
// the agent renders in its own sandbox (v2, 2026-09-25).
//
// WHO: admins only (operator, 2026-09-24: "Admins only"). There is
// deliberately no "paid plans" switch yet: an edit is not charged in credits
// (no price has been set), so opening it to plans must come WITH the
// pricing, not as a flag someone can flip without it.
export async function isEditorEnabled(supabase: SupabaseClient): Promise<boolean> {
  if (process.env.VIDEO_EDITOR_DISABLED === "1") return false;
  if (!(process.env.DIRECTORS_CUT_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY) || !process.env.OPENAI_API_KEY) return false;
  if (!process.env.DIRECTORS_CUT_AGENT_ID || !process.env.DIRECTORS_CUT_ENVIRONMENT_ID) return false;
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
