"use server";

import { createClient } from "@/lib/supabase/server";
import { generateSpeech } from "@/lib/generations/providers/fal";
import { speechSeedFor } from "@/lib/generations/voice-lock";
import { speechEngineForCharacter } from "@/lib/generations/speech-engine";
import { dailyCapReached, rateLimited } from "@/lib/rate-limit";
import { planInGoodStanding } from "@/lib/plans";

// Previews one account may play in a rolling day (2026-09-30, operator: "fix
// the remaining small ones"). Each is a paid TTS call of PREVIEW_TEXT, about
// 42 characters at fal's $0.10 per 1,000; the per-minute brake above bounded
// a script's pace but not its day (20 a minute is 28,800 a day).
const PREVIEWS_PER_DAY = 40;

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
  characterId: string | null = null,
): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Not signed in." };

  // Voice is a paid-plan feature (admins exempt for the Admin > Voices tool).
  // This is the gate that keeps a free signup from scripting paid TTS calls.
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, plan_status, role, status")
    .eq("id", userData.user.id)
    .single();
  // The one paid lane the suspension matrix missed (round-two audit): this
  // action is reachable via /admin/voices, outside the middleware's /app
  // gate, so a suspended paid account could keep scripting paid TTS calls.
  // Same check, same message as every other money lane.
  if (profile?.status === "suspended") {
    return { error: "Your account is suspended. Contact support if you think this is a mistake." };
  }
  if ((profile?.plan ?? "none") === "none" && profile?.role !== "admin") {
    return { error: "Voice previews are part of a paid plan — upgrade to use them." };
  }
  // A plan whose payments aren't in good standing is paused here too (2026-09-30).
  if (!planInGoodStanding(profile?.plan_status) && profile?.role !== "admin") {
    return { error: "Voice previews are paused while your plan's last payment is sorted out — update it in Settings → Plan & billing." };
  }

  // Per-user rate limit — the shared scoped limiter (lib/rate-limit.ts,
  // service-role only, fails closed): better to make the user retry than to
  // leave the paid endpoint unbounded when the limiter itself is unavailable.
  // Own scope, so API calls / uploads / voice-mode traffic in the same minute
  // can't eat the preview budget.
  if (
    await rateLimited(
      userData.user.id,
      "voice-preview",
      PREVIEW_RATE_WINDOW_SECONDS,
      PREVIEW_RATE_MAX_PER_WINDOW,
    )
  ) {
    return { error: "You're previewing voices a bit fast — wait a moment and try again." };
  }
  if (profile?.role !== "admin" && (await dailyCapReached(userData.user.id, "voice-preview", PREVIEWS_PER_DAY))) {
    return { error: "You've played a lot of voice previews today — more tomorrow." };
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
    // Seeded on the PRESET, so auditioning a voice twice gives the same
    // reading of the sample line — the picker was previously a fresh roll
    // every click, which is a poor way to choose between voices. A delivered
    // take is seeded on the CHARACTER instead (voice-lock.ts speechSeedFor),
    // so this is a consistent audition of the voice, not a preview of one
    // character's exact performance.
    //
    // On the engine the character would speak on (voice-lock.ts): a saved
    // character who has spoken keeps v3, so the sample is what their next
    // line will sound like; a new character, or Admin > Voices, hears v4.
    // The lookup reads through this user's own client, so another person's
    // character id finds no takes and is simply v4.
    const engine = typeof characterId === "string" && characterId
      ? await speechEngineForCharacter(supabase, characterId)
      : "v4";
    const url = await generateSpeech(
      PREVIEW_TEXT,
      preset.elevenlabs_voice_id,
      speechSeedFor(voicePresetId),
      engine,
    );
    return { url };
  } catch (err) {
    console.error("Voice preview generation failed:", err);
    return { error: "Couldn't generate a preview right now — try again." };
  }
}
