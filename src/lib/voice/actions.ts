"use server";

// Voice command / voice mode — transcription and speech synthesis both run
// through OpenAI (Whisper for speech-to-text, the TTS API for text-to-speech),
// reusing the same OPENAI_API_KEY already used for the review step. Same
// cost-conscious gating as everything else real-AI: only runs when the
// 'real_ai_providers' flag is on AND the key is present, otherwise callers
// get a clear message instead of a silent failure or a surprise charge.

import { createClient } from "@/lib/supabase/server";
import { isVoiceModeEnabled } from "@/lib/voice/enabled";
import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";
import { dailyCapReached, rateHitCount, rateLimited } from "@/lib/rate-limit";
import { planInGoodStanding } from "@/lib/plans";

type VoiceResult<T extends object> = { error: string } | ({ error: null } & T);

// Per-user rate limits — same atomic advisory-lock limiter the voice preview
// uses (rateLimited in lib/rate-limit.ts, over api_rate_check). The plan
// gate below keeps throwaway accounts out, but a single paid account could
// still loop these actions and run up the OpenAI bill: Whisper is billed per
// audio-minute and TTS per character, so both need a per-minute ceiling.
// Sized like the preview's 20/min: generous for a human actually talking to
// the app, binding for a script. Transcription is tighter because each call
// can carry up to 20MB of billable audio — and each action gets its own
// scope so a burst of TTS replies can't eat the transcription budget (or
// vice versa), which is exactly what the old shared bucket allowed.
const TRANSCRIBE_RATE_WINDOW_SECONDS = 60;
const TRANSCRIBE_RATE_MAX_PER_WINDOW = 10;
const SYNTHESIZE_RATE_WINDOW_SECONDS = 60;
const SYNTHESIZE_RATE_MAX_PER_WINDOW = 20;

// Dictation's day (2026-09-30, operator: "fix the remaining small ones").
// Whisper bills per minute of audio ($0.006, editor/prices.ts), and the only
// bound on a clip's length was its size: the browser stops at 30 s
// (voice-recorder-button.tsx MAX_RECORDING_MS), but 20 MB of low-bitrate
// audio sent straight to this action is hours of billable speech, ten times
// a minute. Now: 2 MB a clip (30 s of browser audio is well under 1 MB), a
// daily count of clips, and a clip Whisper reports longer than a recording
// can be is a strike; two strikes stop dictation for the day, so a crafted
// long clip is paid for at most twice.
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const TRANSCRIBES_PER_DAY = 100;
const LONGEST_REAL_CLIP_SECONDS = 45;
const LONG_CLIPS_PER_DAY = 2;
const DAY_SECONDS = 24 * 60 * 60;
const DICTATION_DAY_USED = "You've used today's voice typing — it comes back tomorrow. Typing works as always.";

// SECURITY: both actions below spend real OpenAI money on every call, and
// until 2026-08-10 neither checked who was calling — only that the feature
// flag was on and a key was present. A Next.js server action is a POST
// endpoint whose id is discoverable in the client bundle, so that made
// Whisper transcription and TTS into a free, internet-facing API billed to
// this account. Found during the full-project audit; there is no evidence
// it was abused, but it needed closing before launch.
//
// Signed-in is the minimum bar. The plan check on top of it means a
// throwaway free signup can't run up a bill either — voice is a paid-plan
// feature, matching how generations already work.
// Returns the caller's user id on success so the actions can rate-limit
// per user without a second auth round trip.
async function checkVoiceAvailable(): Promise<{ error: string } | { error: null; userId: string }> {
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, plan_status, role")
    .eq("id", userData.user.id)
    .single();

  // A plan whose payments aren't in good standing counts as none (2026-09-30,
  // plans.ts planInGoodStanding): its credits pause, and so does its voice.
  const onPaidPlan = (profile?.plan ?? "none") !== "none" && planInGoodStanding(profile?.plan_status);
  if (!onPaidPlan && profile?.role !== "admin") {
    return { error: "Voice features are part of a paid plan — upgrade to use them." };
  }

  const { data: flag } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("key", "real_ai_providers")
    .single();

  if (flag?.enabled !== true) {
    return { error: "Real AI providers are off, so voice isn't live yet. Turn them on in Admin > Feature flags." };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { error: "OPENAI_API_KEY is missing — add it to .env.local first." };
  }
  return { error: null, userId: userData.user.id };
}

export async function transcribeVoice(formData: FormData): Promise<VoiceResult<{ text: string }>> {
  const available = await checkVoiceAvailable();
  if (available.error !== null) return { error: available.error };

  const audio = formData.get("audio") as File | null;
  if (!audio || audio.size === 0) return { error: "Didn't catch any audio — try again." };
  // Cap the upload — Whisper is billed per audio-minute, so an uncapped file
  // POSTed in a loop is an unbounded cost. A spoken prompt is well under this
  // (MAX_AUDIO_BYTES above).
  if (audio.size > MAX_AUDIO_BYTES) {
    return { error: "That audio clip is too large — keep voice prompts short." };
  }

  // After the cheap input checks, before the paid Whisper call.
  if (
    await rateLimited(
      available.userId,
      "voice-transcribe",
      TRANSCRIBE_RATE_WINDOW_SECONDS,
      TRANSCRIBE_RATE_MAX_PER_WINDOW,
    )
  ) {
    return { error: "You're sending voice clips a bit fast — wait a moment and try again." };
  }
  // The day: too many long clips already, or too many clips.
  if ((await rateHitCount(available.userId, "voice-long", DAY_SECONDS)) >= LONG_CLIPS_PER_DAY) {
    return { error: DICTATION_DAY_USED };
  }
  if (await dailyCapReached(available.userId, "voice-transcribe", TRANSCRIBES_PER_DAY)) {
    return { error: DICTATION_DAY_USED };
  }

  const apiKey = process.env.OPENAI_API_KEY!;
  const form = new FormData();
  form.set("model", "whisper-1");
  form.set("file", audio, "voice.webm");
  // verbose_json carries the clip's length, which is what Whisper bills.
  form.set("response_format", "verbose_json");

  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/audio/transcriptions",
    { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: form },
    30_000,
  );

  if (!res.ok) {
    // Log provider detail server-side; never surface a raw upstream error body.
    console.error("Whisper transcription failed", res.status, (await res.text()).slice(0, 300));
    return { error: "Couldn't process the audio — try again." };
  }

  const data = await res.json();
  // A clip longer than any recording the page can make is a strike (the
  // rate limiter's bucket, counted here and read above). Its max is only
  // there so the hit is always written.
  const seconds = Number(data?.duration);
  if (Number.isFinite(seconds) && seconds > LONGEST_REAL_CLIP_SECONDS) {
    await rateLimited(available.userId, "voice-long", DAY_SECONDS, 1_000);
  }
  const text = (data?.text as string | undefined)?.trim();
  if (!text) return { error: "Didn't catch that — try again." };

  return { error: null, text };
}

export async function synthesizeVoice(text: string): Promise<VoiceResult<{ audioBase64: string }>> {
  const available = await checkVoiceAvailable();
  if (available.error !== null) return { error: available.error };

  // Spoken replies belong to the conversational agent, which is flagged off
  // (see lib/voice/enabled.ts). Enforced server-side, not just by hiding the
  // button — otherwise the action stays callable and billable.
  const supabase = await createClient();
  if (!(await isVoiceModeEnabled(supabase))) {
    return { error: "Voice mode is currently turned off." };
  }

  const trimmed = text.trim();
  if (!trimmed) return { error: "Nothing to say." };

  // After the cheap input checks, before the paid TTS call.
  if (
    await rateLimited(
      available.userId,
      "voice-synthesize",
      SYNTHESIZE_RATE_WINDOW_SECONDS,
      SYNTHESIZE_RATE_MAX_PER_WINDOW,
    )
  ) {
    return { error: "Voice replies are coming a bit fast — wait a moment and try again." };
  }

  const apiKey = process.env.OPENAI_API_KEY!;
  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/audio/speech",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "tts-1", voice: "alloy", input: trimmed.slice(0, 800) }),
    },
    30_000,
  );

  if (!res.ok) {
    console.error("OpenAI speech failed", res.status, (await res.text()).slice(0, 300));
    return { error: "Couldn't generate audio — try again." };
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  return { error: null, audioBase64: bytes.toString("base64") };
}
