import { fetchWithTimeout } from "../generations/providers/fetch-with-timeout";
import { MAX_SPOKEN_SECONDS, SPEECH_MODEL, TRANSCRIBE_MODEL } from "./prices";

// The Producer's ears and voice (2026-09-25, operator: "OpenAI in + out").
//
// Same provider and key as the composer's mic (lib/voice/actions.ts), but
// metered like the rest of a Producer turn: the route adds each call's cost
// to the turn and settles once. Neither function keeps the audio — a
// recording is transcribed and dropped, and speech goes straight back to the
// person's device (privacy policy, "Voice and the assistant").

// A minute of Opus-in-WebM at the ~32 kbit/s browsers record speech at is
// ~240 KB; 2 MB leaves room for Safari's larger mp4/AAC without letting one
// request carry a podcast.
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = /^audio\/(webm|mp4|mpeg|ogg|wav|x-m4a|m4a|aac)(;.*)?$/;
// The voice the composer's read-aloud already uses, so Picacho sounds like
// one product.
export const PRODUCER_VOICE = "alloy";

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
  const seconds = Math.min(MAX_SPOKEN_SECONDS, Math.max(1, Number(a.seconds) || MAX_SPOKEN_SECONDS));
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
  const form = new FormData();
  form.set("model", TRANSCRIBE_MODEL);
  form.set(
    "file",
    new Blob([new Uint8Array(input.bytes)], { type: input.mime.split(";")[0] }),
    `speech.${extensionFor(input.mime)}`,
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
  const data = (await res.json()) as { text?: unknown };
  return typeof data.text === "string" ? data.text.trim() : "";
}

/** Text → MP3 bytes as base64. Throws on a provider failure. */
export async function speak(text: string): Promise<string> {
  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/audio/speech",
    {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: SPEECH_MODEL, voice: PRODUCER_VOICE, input: text, response_format: "mp3" }),
    },
    30_000,
  );
  if (!res.ok) {
    console.error("producer: speech failed", res.status, (await res.text()).slice(0, 300));
    throw new Error(`speech ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}
