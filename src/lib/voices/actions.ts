"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { generateSpeech } from "@/lib/generations/providers/fal";

// A voice preview is a real, paid TTS call (see providers/fal.ts). The
// paid-plan gate below stops free signups from scripting it, but a single
// paid account — or an admin — could still loop this endpoint and run up the
// FAL bill. Bound it the same way the public API is bounded: an atomic,
// advisory-lock per-user limiter (public.api_rate_check) that only records a
// hit while under the cap, so a burst of concurrent clicks can't all pass a
// stale count. Generous enough that no human clicking through the picker will
// ever hit it.
const PREVIEW_RATE_WINDOW_SECONDS = 60;
const PREVIEW_RATE_MAX_PER_WINDOW = 20;

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

  // Per-user rate limit — api_rate_check's EXECUTE is revoked from
  // `authenticated`, so it runs through the service-role client. A limiter
  // error fails closed: better to make the user retry than to leave the paid
  // endpoint unbounded when the limiter itself is unavailable.
  const admin = createAdminClient();
  const { data: rateAllowed, error: rateError } = await admin.rpc("api_rate_check", {
    p_user_id: userData.user.id,
    p_window_seconds: PREVIEW_RATE_WINDOW_SECONDS,
    p_max: PREVIEW_RATE_MAX_PER_WINDOW,
  });
  if (rateError || rateAllowed !== true) {
    return { error: "You're previewing voices a bit fast — wait a moment and try again." };
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
