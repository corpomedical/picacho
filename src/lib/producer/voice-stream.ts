// Aly's voice as ONE continuous take per answer (2026-09-26, operator: "Her
// voice changes tones from sentence to sentence. She also sounds ai" → his
// blind test: ElevenLabs' eleven_v3_conversational won 7 of 12 against the
// fal voice, "Best female friend" alone 4 of 12, and it started talking in
// ~0.27 s against 1.2–1.8 s → "Yes, build it").
//
// ElevenLabs' Text-to-Dialogue WebSocket takes the answer's words as Claude
// writes them and sends MP3 back as it goes: one generation, so no seams and
// no tone reset between sentences. The key stays on the server; the audio
// reaches the sheet as `audio_stream` events (route.ts), where one element
// plays it (use-hands-free.ts). It is metered at the same rate as the fal
// voice ($0.05 per 1,000 characters, prices.ts — a ceiling over both).
//
// ELEVEN V4 TURBO (2026-10-01, operator: "Elevenlabs v4 integration in
// Picacho"). ElevenLabs released Eleven v4 on 2026-09-28; its real-time
// variant, eleven_v4_turbo ("purpose-built for real-time use cases like
// conversational agents", ~100 ms median inference against v3
// conversational's ~280 ms), runs on this same socket with the same
// protocol — the dialogue WebSocket takes any model_id starting eleven_v3 or
// eleven_v4, and v4 Turbo, like v3 conversational, registers exactly one
// voice. Price read that day: "$0.04" per 1K characters for both models
// ($0.011 for v4 Turbo while "72% off until Oct 12").
//
// Docs (read 2026-09-26, the v4 pages 2026-10-01): wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input
// — first message: voices (exactly one for eleven_v4_turbo) and
// credentials; then inputs [{ text, voice_id }]; flush; keep_alive (resets a
// 20 s idle timeout); close_socket (flushes, sends is_final, closes). Server
// messages: { audio (base64), alignment { chars } }, { is_final_audio_for_turn },
// { is_final }, { message, error, code }.
//
// A TAKE ONLY SUCCEEDS ON is_final (review of the take, 2026-09-26): a close
// without it, an error, or silence past a deadline is a failure, reported with
// how many characters were voiced, so the route can hand the rest to fal.

export const VOICE_STREAM_MODEL = "eleven_v4_turbo";
const URL_BASE = "wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input";
/** mp3_44100_128: 16,000 bytes a second — the sheet times what was heard from it. */
export const VOICE_STREAM_FORMAT = "mp3_44100_128";
export const VOICE_STREAM_BYTES_PER_SECOND = 16_000;
const TICK_MS = 1_000;
const KEEPALIVE_MS = 10_000;
/** No audio this long after it was asked to speak (a flush or the end): a voice's cold start took up to 10.6 s. */
const FIRST_AUDIO_DEADLINE_MS = 25_000;
/** Once speaking, no message from ElevenLabs this long while it owes audio: stalled. */
const STALL_DEADLINE_MS = 15_000;

/** An ElevenLabs voice id (20 characters). A legacy NAME such as "Rachel" only works through fal. */
export function isStreamableVoiceId(id: string | null | undefined): id is string {
  return typeof id === "string" && /^[A-Za-z0-9]{20}$/.test(id);
}

export function isVoiceStreamConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY) && typeof globalThis.WebSocket === "function";
}

export type VoiceStream = {
  /** Words of the answer, as they arrive. */
  push(text: string): void;
  /** Speak what's buffered now (before a lookup), keeping the take open. */
  flush(): void;
  /** No more words: speak the rest and finish. Resolves when the take has finished or failed. */
  end(): Promise<void>;
  /** Cut off: nothing more is spoken, and no failure is reported. */
  abort(): void;
  /** Characters actually sent to ElevenLabs over the open socket (what it bills). */
  readonly sent: number;
  /** Characters it has voiced so far (from each chunk's words). */
  readonly voiced: number;
  /** Whether any audio has come back yet. */
  readonly started: boolean;
};

type Options = {
  voiceId: string;
  /** Each MP3 chunk, base64, in order, with the words it says (sync_alignment). */
  onAudio: (b64: string, words: string) => void;
  /** The take failed. `voiced` says how much of it was heard (0: nothing). */
  onError: (why: string, voiced: number) => void;
  stability?: number;
  /** For tests: the socket factory and the clock. */
  connect?: (url: string) => WebSocket;
  now?: () => number;
};

export function openVoiceStream(o: Options): VoiceStream {
  const key = process.env.ELEVENLABS_API_KEY ?? "";
  const now = o.now ?? (() => Date.now());
  const url = `${URL_BASE}?model_id=${VOICE_STREAM_MODEL}&output_format=${VOICE_STREAM_FORMAT}&sync_alignment=true`;
  const ws = (o.connect ?? ((u: string) => new WebSocket(u)))(url);
  let open = false;
  let closed = false;
  let failed = false;
  let aborted = false;
  let gotFinal = false;
  let started = false;
  let ended = false;
  let sent = 0;
  let voiced = 0;
  // Asked to speak (a flush or the end) and still owed audio since then.
  let owedSince: number | null = null;
  let lastHeard = now();
  let lastKeepAlive = now();
  const outbox: { text: string; chars: number }[] = [];
  let finish: () => void = () => {};
  const finished = new Promise<void>((r) => (finish = r));

  const write = (text: string, chars: number) => {
    ws.send(text);
    sent += chars;
  };
  const send = (msg: Record<string, unknown>, chars = 0) => {
    const text = JSON.stringify(msg);
    if (closed) return;
    if (open) write(text, chars);
    else outbox.push({ text, chars });
  };
  const shut = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (!closed) {
      closed = true;
      try {
        ws.close();
      } catch {}
    }
    finish();
  };
  const fail = (why: string) => {
    if (failed || aborted || gotFinal) return;
    failed = true;
    shut();
    o.onError(why, voiced);
  };

  let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
    const t = now();
    // Through a lookup the socket's 20 s idle limit is kept at bay — only
    // while more words may come; after close_socket it is ElevenLabs' turn.
    if (open && !closed && !ended && t - lastKeepAlive >= KEEPALIVE_MS) {
      lastKeepAlive = t;
      ws.send(JSON.stringify({ keep_alive: true }));
    }
    if (owedSince !== null) {
      const limit = started ? STALL_DEADLINE_MS : FIRST_AUDIO_DEADLINE_MS;
      if (t - Math.max(owedSince, lastHeard) > limit) fail(started ? "stalled" : "no audio");
    }
  }, TICK_MS);

  ws.onopen = () => {
    open = true;
    write(JSON.stringify({ voices: [o.voiceId], xi_api_key: key, voice_settings: { stability: o.stability ?? 0.5 } }), 0);
    for (const m of outbox.splice(0)) write(m.text, m.chars);
  };
  ws.onmessage = (e: MessageEvent) => {
    lastHeard = now();
    let m: { audio?: unknown; alignment?: { chars?: unknown } | null; is_final?: unknown; error?: unknown; message?: unknown } = {};
    try {
      m = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (typeof m.audio === "string" && m.audio) {
      started = true;
      const words = Array.isArray(m.alignment?.chars)
        ? (m.alignment.chars as unknown[]).filter((c) => typeof c === "string").join("")
        : "";
      voiced += words.length;
      if (!ended) owedSince = null;
      o.onAudio(m.audio, words);
    }
    if (m.error) fail(`${String(m.error)}: ${String(m.message ?? "")}`.slice(0, 200));
    if (m.is_final) {
      gotFinal = true;
      shut();
    }
  };
  ws.onerror = () => fail("socket error");
  ws.onclose = () => {
    if (!gotFinal && !aborted) fail(ended ? "closed before it finished" : "closed early");
    else shut();
  };

  return {
    push(text: string) {
      if (!text || closed || ended) return;
      send({ inputs: [{ text, voice_id: o.voiceId }] }, text.length);
    },
    flush() {
      if (closed || ended) return;
      send({ flush: true });
      owedSince = owedSince ?? now();
    },
    end() {
      if (!ended && !closed) {
        ended = true;
        send({ close_socket: true });
        owedSince = now();
      }
      return finished;
    },
    abort() {
      aborted = true;
      ended = true;
      shut();
    },
    get sent() {
      return sent;
    },
    get voiced() {
      return voiced;
    },
    get started() {
      return started;
    },
  };
}

/**
 * Where to pick up after a take that failed part-way: the start of the
 * sentence it was in when it stopped, so the fallback voice begins on a
 * whole sentence (a few words may be heard twice; none are lost).
 */
export function resumeAt(fed: string, voiced: number): number {
  if (voiced <= 0) return 0;
  if (voiced >= fed.length) return fed.length;
  const before = fed.slice(0, voiced);
  const re = /[.!?…](?:["')\]]*)\s+|\n+/g;
  let cut = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(before))) cut = m.index + m[0].length;
  return cut;
}
