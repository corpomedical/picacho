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
// needs something to click. Gated on a paid plan (or admin, for the Admin >
// Voices tool) — signed-in alone made this a free, internet-facing paid-TTS
// endpoint any throwaway account could loop and bill to us.
export async function previewVoice(
  voicePresetId: string,
): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Not signed in." };

  // Voice is a paid-plan feature (admins exempt for the Admin > Voices tool).
  // This is the gate that keeps a free signup from scripting paid TTS calls.
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, role")
    .eq("id", userData.user.id)
    .single();
  if ((profile?.plan ?? "none") === "none" && profile?.role !== "admin") {
    return { error: "Voice previews are part of a paid plan — upgrade to use them." };
  }

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
