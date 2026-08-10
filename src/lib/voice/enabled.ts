import type { SupabaseClient } from "@supabase/supabase-js";

// Voice mode is behind its own feature flag, separate from
// 'real_ai_providers'. Turned off 2026-08-10: the conversational agent
// needs more work, and while it's unfinished it's also an unmetered cost
// (Whisper on every utterance, TTS on every reply, no credit charge).
//
// The code is deliberately left in place rather than deleted — re-enabling
// is one toggle in Admin > Feature flags, with no deploy, so it can be
// picked back up and built on later.
//
// Note this gates the hands-free CONVERSATIONAL agent and the sidebar's
// global voice command. The plain microphone button beside the composer —
// record, transcribe, drop the text in the box for you to review before
// sending — is a separate, finished feature and stays available.
export async function isVoiceModeEnabled(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("key", "voice_mode")
    .single();

  // Defaults to OFF when the row is missing, rather than on. A feature that
  // spends money on every use should never switch itself on because a
  // lookup failed.
  return data?.enabled === true;
}
