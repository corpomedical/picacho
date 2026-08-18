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

type VoiceResult<T extends object> = { error: string } | ({ error: null } & T);

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
async function checkVoiceAvailable(): Promise<string | null> {
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return "Your session expired — please log in again.";

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, role")
    .eq("id", userData.user.id)
    .single();

  const onPaidPlan = (profile?.plan ?? "none") !== "none";
  if (!onPaidPlan && profile?.role !== "admin") {
    return "Voice features are part of a paid plan — upgrade to use them.";
  }

  const { data: flag } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("key", "real_ai_providers")
    .single();

  if (flag?.enabled !== true) {
    return "Real AI providers are off, so voice isn't live yet. Turn them on in Admin > Feature flags.";
  }
  if (!process.env.OPENAI_API_KEY) {
    return "OPENAI_API_KEY is missing — add it to .env.local first.";
  }
  return null;
}

export async function transcribeVoice(formData: FormData): Promise<VoiceResult<{ text: string }>> {
  const unavailable = await checkVoiceAvailable();
  if (unavailable) return { error: unavailable };

  const audio = formData.get("audio") as File | null;
  if (!audio || audio.size === 0) return { error: "Didn't catch any audio — try again." };
  // Cap the upload — Whisper is billed per audio-minute, so an uncapped file
  // POSTed in a loop is an unbounded cost. A spoken prompt is well under this.
  const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
  if (audio.size > MAX_AUDIO_BYTES) {
    return { error: "That audio clip is too large — keep voice prompts short." };
  }

  const apiKey = process.env.OPENAI_API_KEY!;
  const form = new FormData();
  form.set("model", "whisper-1");
  form.set("file", audio, "voice.webm");

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
  const text = (data?.text as string | undefined)?.trim();
  if (!text) return { error: "Didn't catch that — try again." };

  return { error: null, text };
}

export async function synthesizeVoice(text: string): Promise<VoiceResult<{ audioBase64: string }>> {
  const unavailable = await checkVoiceAvailable();
  if (unavailable) return { error: unavailable };

  // Spoken replies belong to the conversational agent, which is flagged off
  // (see lib/voice/enabled.ts). Enforced server-side, not just by hiding the
  // button — otherwise the action stays callable and billable.
  const supabase = await createClient();
  if (!(await isVoiceModeEnabled(supabase))) {
    return { error: "Voice mode is currently turned off." };
  }

  const trimmed = text.trim();
  if (!trimmed) return { error: "Nothing to say." };

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
