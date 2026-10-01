import type { Personality } from "./personality";
import { isStreamableVoiceId, isVoiceStreamConfigured, openVoiceStream } from "./voice-stream";

// Something said at once (2026-09-28, operator: "when I talk to her it takes
// a while for her to respond. If the chatbox is closed and the mic is on it
// feels like she didnt get the msg. Which it happens a lot. Make her respond
// with something while she gets an answer").
//
// A spoken message is acknowledged out loud as soon as it's known to be for
// her: a short phrase in her own voice, in her personality, made on the
// model her answer streams on (Eleven v4 Turbo since 2026-10-01, over the
// same dialogue socket, voice-stream.ts — it was Flash v2.5 over HTTP, a
// different model from the answer's) and remembered per voice, so a phrase
// said before plays with no wait. It is
// only sent if her real answer hasn't started speaking by then (route.ts).
// Never throws: an acknowledgement that can't be made is simply not said.

export const ACK_PHRASES: Record<Personality, readonly string[]> = {
  default: [
    "Mm-hm, one sec.",
    "Okay, let me see.",
    "Got it. One moment.",
    "Sure, give me a second.",
    "Right, let me think.",
    "Okay, on it.",
    "Good one. Let me check.",
    "Mm, let me look.",
  ],
  sarcastic: [
    "Oh, a question. How thrilling. One sec.",
    "Sure, let me drop everything.",
    "Fine, fine. Thinking.",
    "Ooh, a real brain-teaser. Hold on.",
    "Right away, your majesty.",
    "Let me consult my crystal ball.",
  ],
  rude: [
    "Ugh. Fine. Hang on.",
    "Yeah, yeah. Give me a second.",
    "Hold your horses.",
    "Patience. I'm thinking.",
    "Seriously? Okay, one sec.",
    "Wow. Fine. Hold on.",
  ],
};

/** A phrase for this personality, never the same as the last one said (when there's a choice). */
export function pickAck(personality: Personality, last: string | null, random: () => number = Math.random): string {
  const list = ACK_PHRASES[personality] ?? ACK_PHRASES.default;
  const choices = list.length > 1 && last ? list.filter((p) => p !== last) : list;
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}

// Phrases already made, per voice: a warm server says them with no wait.
const CACHE_MAX = 200;
const made = new Map<string, string>();
let lastSaid: string | null = null;

export function lastAck(): string | null {
  return lastSaid;
}

/**
 * The phrase in her voice as MP3 (base64), from ElevenLabs directly, or null
 * (no key, a voice id that isn't an ElevenLabs one, slower than `timeoutMs`,
 * or any failure).
 */
export async function speakAck(
  text: string,
  voiceId: string,
  opts: { timeoutMs?: number; signal?: AbortSignal; connect?: (url: string) => WebSocket } = {},
): Promise<{ data: string; cached: boolean } | null> {
  if (!isStreamableVoiceId(voiceId)) return null;
  if (!opts.connect && !isVoiceStreamConfigured()) return null;
  if (!process.env.ELEVENLABS_API_KEY) return null;
  const id = `${voiceId}|${text}`;
  const hit = made.get(id);
  lastSaid = text;
  if (hit) return { data: hit, cached: true };
  if (opts.signal?.aborted) return null;
  const chunks: Buffer[] = [];
  let failed = false;
  let stopped = false;
  try {
    const take = openVoiceStream({
      voiceId,
      onAudio: (b64) => chunks.push(Buffer.from(b64, "base64")),
      onError: () => {
        failed = true;
      },
      connect: opts.connect,
    });
    const stop = () => {
      stopped = true;
      take.abort();
    };
    const timer = setTimeout(stop, opts.timeoutMs ?? 2500);
    opts.signal?.addEventListener("abort", stop, { once: true });
    try {
      take.push(text);
      await take.end();
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", stop);
    }
    if (failed || stopped) return null;
    const bytes = Buffer.concat(chunks);
    if (bytes.length < 200) return null;
    const data = bytes.toString("base64");
    if (made.size >= CACHE_MAX) made.delete(made.keys().next().value as string);
    made.set(id, data);
    return { data, cached: false };
  } catch {
    return null;
  }
}

/** Exposed for tests. */
export function clearAckCache() {
  made.clear();
  lastSaid = null;
}
