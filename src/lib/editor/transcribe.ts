// The words, with their times — what lets the editor cut on speech.
//
// OpenAI's Whisper (`whisper-1`), word AND segment timestamps: $0.006 per
// audio minute on OpenAI's pricing page, read 2026-09-24 (see prices.ts).
//
// THE GUARD (operator's first real edit, 2026-09-25): on six clips of music
// and effects with no talking, Whisper "heard" "Thanks for watching", "Bye
// bye", "♪♪♪" and a Japanese sign-off. A speech recogniser fed no speech
// invents the most common closing lines of its training videos. So words are
// kept only inside segments Whisper itself scores as likely speech, using the
// same three signals and thresholds OpenAI's reference decoder uses to spot
// silence and hallucination — no list of phrases:
//   - no_speech_prob  > 0.6  → the model thinks this stretch is not speech;
//   - avg_logprob     < -1.0 → it was guessing;
//   - compression_ratio > 2.4 → the text repeats itself (a loop, not speech).
// A clip left with too little speech is reported as "no-speech", and the
// editor is told to trust the footage over any words.

export const TRANSCRIBE_MODEL = "whisper-1";
const TIMEOUT_MS = 120_000;
export const NO_SPEECH_PROB_MAX = 0.6;
export const AVG_LOGPROB_MIN = -1.0;
export const COMPRESSION_RATIO_MAX = 2.4;
/** Fewer kept words than this (or under a second of them) is not speech worth cutting on. */
const MIN_WORDS = 3;

export type Word = { text: string; start: number; end: number };
export type Transcript = { language: string | null; words: Word[]; speech: boolean; droppedSegments: number };

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
  form.append("timestamp_granularities[]", "segment");
  if (opts.language) form.append("language", opts.language);
  let res: Response;
  try {
    res = await (opts.fetchFn ?? fetch)("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
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

type Segment = { start: number; end: number; noSpeech: number; logprob: number; compression: number };

/** The verbose_json reply → the words Whisper itself stands behind. */
export function parseTranscript(body: unknown): Transcript {
  const b = (body && typeof body === "object" ? body : {}) as { language?: unknown; words?: unknown; segments?: unknown };
  const words: Word[] = [];
  if (Array.isArray(b.words)) {
    for (const w of b.words) {
      const word = (w && typeof w === "object" ? w : {}) as { word?: unknown; start?: unknown; end?: unknown };
      const text = typeof word.word === "string" ? word.word.trim() : "";
      const start = Number(word.start);
      const end = Number(word.end);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      words.push({ text, start: round3(start), end: round3(end) });
    }
  }
  const segments: Segment[] = Array.isArray(b.segments)
    ? b.segments
        .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
        .map((s) => ({
          start: Number(s.start),
          end: Number(s.end),
          noSpeech: Number(s.no_speech_prob ?? 0),
          logprob: Number(s.avg_logprob ?? 0),
          compression: Number(s.compression_ratio ?? 0),
        }))
        .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end))
    : [];
  const trusted = segments.filter(
    (s) => !(s.noSpeech > NO_SPEECH_PROB_MAX) && !(s.logprob < AVG_LOGPROB_MIN) && !(s.compression > COMPRESSION_RATIO_MAX),
  );
  // Without segment scores (an older reply shape) nothing can be vouched for.
  const kept = segments.length === 0 ? [] : words.filter((w) => trusted.some((s) => w.start >= s.start - 0.05 && w.end <= s.end + 0.05));
  const spoken = kept.reduce((sum, w) => sum + (w.end - w.start), 0);
  const speech = kept.length >= MIN_WORDS && spoken >= 1;
  return {
    language: typeof b.language === "string" ? b.language : null,
    words: speech ? kept : [],
    speech,
    droppedSegments: segments.length - trusted.length,
  };
}

/**
 * THE SECOND OPINION (v2 real test, 2026-09-25): the same music-only clip came
 * back "Bye bye" once, nine confident words the next time, and nothing the
 * third — a recogniser inventing speech invents something different each
 * time, while real speech comes back the same. So each clip is heard twice
 * and only words both hearings agree on (same word, overlapping time) are
 * kept. Costs a second $0.006/min; worth it, since a phantom line in a
 * caption is the one mistake a viewer reads.
 */
export function agreeingWords(a: Word[], b: Word[]): Word[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return a.filter((w) => {
    const key = norm(w.text);
    return key !== "" && b.some((x) => norm(x.text) === key && x.start < w.end + 0.3 && x.end > w.start - 0.3);
  });
}

/** Hear a clip twice; keep what both hearings agree on. */
export async function transcribeTwice(audio: Uint8Array, opts: Parameters<typeof transcribeSpeech>[1] = {}): Promise<Transcript> {
  const [first, second] = await Promise.all([transcribeSpeech(audio, opts), transcribeSpeech(audio, opts)]);
  const words = agreeingWords(first.words, second.words);
  const spoken = words.reduce((sum, w) => sum + (w.end - w.start), 0);
  const speech = first.speech && second.speech && words.length >= MIN_WORDS && spoken >= 1;
  return {
    language: first.language ?? second.language,
    words: speech ? words : [],
    speech,
    droppedSegments: first.droppedSegments + second.droppedSegments,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
