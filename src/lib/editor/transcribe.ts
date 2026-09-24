// The words, with their times — what lets the director cut on speech.
//
// OpenAI's Whisper (`whisper-1`) with word-level timestamps: $0.006 per audio
// minute on OpenAI's pricing page, read 2026-09-24 (see prices.ts). The input
// is the mono 16 kHz speech track analyze.ts made, far under the 25 MB limit.
//
// A clip with no speech is not an error — B-roll, a song, a drone shot —
// it simply has no words. A failed call IS an error: an edit that should
// have cut on speech and silently cannot is the worst outcome, so the caller
// decides whether to fail the job or carry on without words.

import type { Word } from "./timeline";

export const TRANSCRIBE_MODEL = "whisper-1";
const TIMEOUT_MS = 120_000;

export type Transcript = { language: string | null; words: Word[] };

export class TranscribeError extends Error {}

export async function transcribeSpeech(
  audio: Uint8Array,
  opts: { filename?: string; language?: string; fetchFn?: typeof fetch; apiKey?: string } = {},
): Promise<Transcript> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new TranscribeError("OPENAI_API_KEY is not set");
  const form = new FormData();
  form.append("file", new Blob([audio as BlobPart], { type: "audio/mpeg" }), opts.filename ?? "speech.mp3");
  form.append("model", TRANSCRIBE_MODEL);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  if (opts.language) form.append("language", opts.language);
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await (opts.fetchFn ?? fetch)("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: deadline,
    });
  } catch (err) {
    throw new TranscribeError(`transcription didn't answer: ${err instanceof Error ? err.name : "error"}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new TranscribeError(`transcription answered ${res.status}: ${detail.slice(0, 200)}`);
  }
  return parseTranscript(await res.json());
}

/** The verbose_json reply → our words. Tolerant of missing fields; drops empty or backwards words. */
export function parseTranscript(body: unknown): Transcript {
  const b = (body && typeof body === "object" ? body : {}) as { language?: unknown; words?: unknown };
  const words: Word[] = [];
  if (Array.isArray(b.words)) {
    for (const w of b.words) {
      const word = (w && typeof w === "object" ? w : {}) as { word?: unknown; start?: unknown; end?: unknown };
      const text = typeof word.word === "string" ? word.word.trim() : "";
      const start = Number(word.start);
      const end = Number(word.end);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      words.push({ text, start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 });
    }
  }
  return { language: typeof b.language === "string" ? b.language : null, words };
}
