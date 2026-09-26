import { fetchWithTimeout } from "../generations/providers/fetch-with-timeout";
import { HUMAN_SPEECH_ENDPOINT, MAX_SPOKEN_SECONDS, SPEECH_MODEL, TRANSCRIBE_MODEL } from "./prices";

// The Producer's ears and voice (2026-09-25, operator: "OpenAI in + out").
//
// Same provider and key as the composer's mic (lib/voice/actions.ts), but
// metered like the rest of a Producer turn: the route adds each call's cost
// to the turn and settles once. We keep no audio — a recording is transcribed
// and dropped; the OpenAI voice goes straight back to the person's device,
// and the human voice's file is the one fal hosts for every render (privacy
// policy, "Voice and the assistant", names both providers).

// The sheet sends 16 kHz mono WAV (32 KB a second, so 2 MB is ~65 s — it
// keeps merged recordings under ~55 s); a minute of Opus-in-WebM from an
// older sheet is ~240 KB. 2 MB never lets one request carry a podcast.
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = /^audio\/(webm|mp4|mpeg|ogg|wav|x-m4a|m4a|aac)(;.*)?$/;
// The voice (2026-09-25, operator: "must speak and interact like ChatGPT"):
// gpt-4o-mini-tts's "marin", one of the two OpenAI names as best quality,
// steered by VOICE_STYLE — the natural, conversational delivery tts-1's flat
// read could not give.
export const PRODUCER_VOICE = "marin";
export const VOICE_STYLE =
  "Speak like a warm, quick-witted creative producer in a live conversation with a colleague: relaxed, natural pace, friendly and confident, light on emphasis, never robotic or announcer-like.";

export function isVoiceConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export type SpokenInput = { bytes: Buffer; mime: string; seconds: number };

/** Reads the route's `audio` field ({ data: base64, mime, seconds }), or explains why not. */
export function readSpokenInput(raw: unknown): { input: SpokenInput } | { error: string } | null {
  if (raw === null || raw === undefined) return null;
  const a = raw as { data?: unknown; mime?: unknown; seconds?: unknown };
  if (typeof a.data !== "string" || typeof a.mime !== "string") return { error: "That recording didn't arrive whole." };
  const mime = a.mime.toLowerCase();
  if (!ALLOWED_MIME.test(mime)) return { error: "That recording's format isn't supported." };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(a.data, "base64");
  } catch {
    return { error: "That recording didn't arrive whole." };
  }
  if (bytes.length === 0) return { error: "Didn't catch any sound." };
  if (bytes.length > MAX_AUDIO_BYTES) return { error: "That was too long. Keep it under a minute." };
  // A WAV's length is its own (16 kHz mono 16-bit, as the sheet records):
  // the client's figure is only trusted for compressed formats.
  const claimed = mime.includes("wav") ? (bytes.length - 44) / 32000 : Number(a.seconds);
  const seconds = Math.min(MAX_SPOKEN_SECONDS, Math.max(1, Math.ceil(claimed) || MAX_SPOKEN_SECONDS));
  return { input: { bytes, mime, seconds } };
}

function extensionFor(mime: string): string {
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  return "webm";
}

/** Speech → text. Throws on a provider failure; returns "" when nothing was said. */
export async function transcribe(input: SpokenInput): Promise<string> {
  return (await transcribeHeard(input)).text;
}

/**
 * Speech → text, with how sure the transcriber was (the mean log-probability
 * of its tokens; OpenAI returns them for gpt-4o-mini-transcribe at no extra
 * cost) and the words it should expect (2026-09-25: "Picacho" came out as
 * "Pikachu" — the product, the assistant's name and the person's characters
 * are now named up front). Throws on a provider failure; text "" when
 * nothing was said.
 */
export async function transcribeHeard(
  input: SpokenInput,
  expect: { assistant?: string; names?: string[] } = {},
): Promise<{ text: string; confidence: number | null }> {
  const form = new FormData();
  form.set("model", TRANSCRIBE_MODEL);
  form.set(
    "file",
    new Blob([new Uint8Array(input.bytes)], { type: input.mime.split(";")[0] }),
    `speech.${extensionFor(input.mime)}`,
  );
  form.append("include[]", "logprobs");
  const names = [...new Set((expect.names ?? []).map((n) => n.trim()).filter(Boolean))].slice(0, 20);
  form.set(
    "prompt",
    `Someone talking to ${expect.assistant?.trim() || "their assistant"} in Picacho, an AI studio for images and videos of their characters.${
      names.length ? ` Names that may come up: ${names.join(", ")}.` : ""
    }`,
  );
  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/audio/transcriptions",
    { method: "POST", headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form },
    30_000,
  );
  if (!res.ok) {
    console.error("producer: transcription failed", res.status, (await res.text()).slice(0, 300));
    throw new Error(`transcription ${res.status}`);
  }
  const data = (await res.json()) as { text?: unknown; logprobs?: { logprob?: unknown }[] };
  const text = typeof data.text === "string" ? data.text.trim() : "";
  const lps = Array.isArray(data.logprobs)
    ? data.logprobs.map((l) => l.logprob).filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    : [];
  return { text, confidence: lps.length ? lps.reduce((a, b) => a + b, 0) / lps.length : null };
}

// THE HUMAN VOICE (2026-09-25, operator: "make it sound more human … its
// sounds ai"): ElevenLabs Turbo v2.5 on fal, speaking with one of the
// admin-picked voices in voice_presets (never a named ElevenLabs default —
// those are being retired, see providers/fal.ts generateSpeech).
//
// What makes it sound like one person talking rather than sentences read one
// by one: every piece is sent with `previous_text`, so the model knows where
// the reply has come from and carries the intonation on. Stability 0.4 lets
// the delivery move (ElevenLabs' own guidance: lower is more expressive,
// higher more monotone); speed 1.05 is conversational rather than read-aloud.
//
// Returns fal's audio URL. The browser plays it straight from fal.media: the
// site's CSP allows https://*.fal.media for media, and fal serves it with
// access-control-allow-origin: * (checked 2026-09-25), so it can also run
// through the page's audio graph for the bulb's light. No download, no
// re-encoding on our side — the first sound arrives sooner.
// STEADIER, AND TOLD WHAT COMES NEXT (2026-09-26, operator: "Her voice
// changes tones from sentence to sentence. She also sounds ai"). Each piece
// is its own generation; ElevenLabs: lower stability means "a wider range of
// variability between generations", so 0.4 let every seam land on a new tone
// — 0.5 is their default. A piece without next_text is read as the END of
// what's being said (the falling tone at each seam); fal's turbo endpoint
// takes next_text, so every piece now carries the words after it. style 0,
// as ElevenLabs recommends, sent rather than assumed.
export async function speakHuman(text: string, voiceId: string, previousText: string, nextText = ""): Promise<string> {
  const res = await fetchWithTimeout(
    `https://fal.run/${HUMAN_SPEECH_ENDPOINT}`,
    {
      method: "POST",
      headers: { authorization: `Key ${process.env.FAL_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        voice: voiceId,
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        speed: 1.05,
        ...(previousText ? { previous_text: previousText.slice(-600) } : {}),
        ...(nextText.trim() ? { next_text: nextText.trim().slice(0, 300) } : {}),
      }),
    },
    20_000,
  );
  if (!res.ok) {
    console.error("producer: human speech failed", res.status, (await res.text()).slice(0, 300));
    throw new Error(`human speech ${res.status}`);
  }
  const data = (await res.json()) as { audio?: { url?: unknown } };
  const url = data.audio?.url;
  if (typeof url !== "string" || !/^https:\/\/[a-z0-9.-]*fal\.media\//i.test(url)) {
    throw new Error("human speech: no audio url");
  }
  return url;
}

export function isHumanVoiceConfigured(): boolean {
  return Boolean(process.env.FAL_KEY);
}

/** Text → MP3 bytes as base64 (the OpenAI fallback voice). Throws on a provider failure. */
export async function speak(text: string): Promise<string> {
  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/audio/speech",
    {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: SPEECH_MODEL,
        voice: PRODUCER_VOICE,
        instructions: VOICE_STYLE,
        input: text,
        response_format: "mp3",
      }),
    },
    30_000,
  );
  if (!res.ok) {
    console.error("producer: speech failed", res.status, (await res.text()).slice(0, 300));
    throw new Error(`speech ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}
