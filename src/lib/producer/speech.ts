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

// The sheet sends 16 kHz mono Ogg Opus where the browser can make it (about
// 3 KB a second, since 2026-09-28) and WAV where it can't (32 KB a second,
// so 2 MB is ~65 s — it keeps merged recordings under ~55 s); a minute of
// Opus-in-WebM from an older sheet is ~240 KB. The length of WAV and Ogg is
// read from the file (readSpokenInput), so a small file can't carry a podcast.
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
  // A WAV's length is its own (16 kHz mono 16-bit, as the sheet records),
  // and so is an Ogg Opus file's (its last page's granule, the sheet's
  // default since 2026-09-28): the client's figure is only trusted for the
  // other compressed formats. Opus is about a tenth of WAV's size, so the
  // byte cap alone would let ten minutes through where WAV fit one.
  const ogg = mime.includes("ogg") ? oggOpusSeconds(bytes) : null;
  if (ogg !== null && ogg > MAX_SPOKEN_SECONDS + 5) return { error: "That was too long. Keep it under a minute." };
  const claimed = mime.includes("wav") ? (bytes.length - 44) / 32000 : (ogg ?? Number(a.seconds));
  const seconds = Math.min(MAX_SPOKEN_SECONDS, Math.max(1, Math.ceil(claimed) || MAX_SPOKEN_SECONDS));
  return { input: { bytes, mime, seconds } };
}

/**
 * An Ogg Opus file's length in seconds, read from the file itself: the last
 * page's granule position less the OpusHead pre-skip, on Opus's 48 kHz clock
 * (RFC 7845). null when it isn't a well-formed Ogg Opus file.
 */
export function oggOpusSeconds(bytes: Uint8Array): number | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < 47 || b.toString("latin1", 0, 4) !== "OggS") return null;
  const bodyAt = 27 + b[26];
  if (b.length < bodyAt + 19 || b.toString("latin1", bodyAt, bodyAt + 8) !== "OpusHead") return null;
  const preSkip = b.readUInt16LE(bodyAt + 10);
  const last = b.lastIndexOf("OggS", b.length - 4, "latin1");
  if (last < 0 || last + 14 > b.length) return null;
  const granule = Number(b.readBigUInt64LE(last + 6));
  if (!Number.isFinite(granule) || granule <= preSkip) return null;
  return (granule - preSkip) / 48000;
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
// sounds ai"): ElevenLabs on fal (Turbo v2.5 until 2026-10-01, now Eleven v4
// Turbo — see below), speaking with one of the
// admin-picked voices in voice_presets (never a named ElevenLabs default —
// those are being retired, see providers/fal.ts generateSpeech).
//
// On Turbo v2.5 each piece was sent with the reply's text so far, so the
// model carried the intonation on, at speed 1.05; Eleven v4 takes neither
// (below).
//
// Returns fal's audio URL. The browser plays it straight from fal.media: the
// site's CSP allows https://*.fal.media for media, and fal serves it with
// access-control-allow-origin: * (checked 2026-09-25), so it can also run
// through the page's audio graph for the bulb's light. No download, no
// re-encoding on our side — the first sound arrives sooner.
// STEADIER (2026-09-26, operator: "Her voice changes tones from sentence to
// sentence. She also sounds ai"): stability 0.5, ElevenLabs' default, for
// pieces that are each their own generation.
//
// ELEVEN V4 TURBO (2026-10-01, operator: "Elevenlabs v4 integration in
// Picacho", then "v4 Turbo" for the phone path): the same model as her
// one-take voice (voice-stream.ts), so a phone and a computer hear one
// voice, and a take that fails part-way goes on in the same voice. fal's
// schema for elevenlabs/tts/eleven-v4-turbo (read 2026-10-01): text, voice,
// stability, similarity_boost, seed, language_code,
// apply_text_normalization, output_format, timestamps — nothing for the text
// before or after a piece, and no style or speed ("Style and Speed sliders are not
// available in Eleven v4", ElevenLabs). Each piece is spoken on its own; he
// was told the joins may be a little less smooth than Turbo v2.5's.
export async function speakHuman(text: string, voiceId: string): Promise<string> {
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
