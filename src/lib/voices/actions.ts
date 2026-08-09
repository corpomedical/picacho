"use server";

import { createClient } from "@/lib/supabase/server";
import { generateSpeech } from "@/lib/generations/providers/fal";

// Fixed sample line, same for every voice — the point is to hear the
// voice's tone/accent/pace, not to preview specific dialogue. Kept short to
// keep generation fast and cheap (this runs on the same FAL_KEY as real
// dialogue generation, see providers/fal.ts).
const PREVIEW_TEXT = "Hi, this is a quick preview of this voice.";

// Called from both Admin > Voices (previewing before/after adding one) and
// the character form's voice picker (a real user deciding which voice to
// assign). Takes the voice_presets row id rather than a raw ElevenLabs
// voice_id — the client never needs to see the provider's own id, it just
// needs something to click. Gated on being signed in only (not admin-only)
// since regular users need this in the character form; still enough to
// keep it out of reach of anonymous scripts hammering paid TTS calls.
export async function previewVoice(
  voicePresetId: string,
): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Not signed in." };

  const { data: preset } = await supabase
    .from("voice_presets")
    .select("elevenlabs_voice_id")
    .eq("id", voicePresetId)
    .single();

  if (!preset?.elevenlabs_voice_id) {
    return { error: "Voice not found." };
  }

  try {
    const url = await generateSpeech(PREVIEW_TEXT, preset.elevenlabs_voice_id);
    return { url };
  } catch (err) {
    console.error("Voice preview generation failed:", err);
    return { error: "Couldn't generate a preview right now — try again." };
  }
}
