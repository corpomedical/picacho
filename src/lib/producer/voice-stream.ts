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
// voice ($0.05 per 1,000 characters, prices.ts).
//
// Docs (read 2026-09-26): wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input
// — first message: voices (exactly one for eleven_v3_conversational) and
// credentials; then inputs [{ text, voice_id }]; flush; keep_alive (resets a
// 20 s idle timeout); close_socket (flushes, sends is_final, closes). Server
// messages: { audio (base64) }, { is_final_audio_for_turn }, { is_final },
// { message, error, code }.

export const VOICE_STREAM_MODEL = "eleven_v3_conversational";
const URL_BASE = "wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input";
/** mp3_44100_128: 16,000 bytes a second — the sheet times what was heard from it. */
export const VOICE_STREAM_FORMAT = "mp3_44100_128";
export const VOICE_STREAM_BYTES_PER_SECOND = 16_000;
const IDLE_KEEPALIVE_MS = 10_000;

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
  /** No more words: speak the rest and finish. Resolves when the last audio has arrived. */
  end(): Promise<void>;
  /** Cut off: nothing more is spoken. */
  abort(): void;
  /** Characters sent to be spoken (what is billed). */
  readonly chars: number;
  /** Whether any audio has come back yet. */
  readonly started: boolean;
};

type Options = {
  voiceId: string;
  /** Each MP3 chunk, base64, in order, with the words it says (sync_alignment). */
  onAudio: (b64: string, words: string) => void;
  /** The take failed; `started` says whether any audio had come back first. */
  onError: (why: string, started: boolean) => void;
  stability?: number;
  /** For tests: the socket factory. */
  connect?: (url: string) => WebSocket;
};

export function openVoiceStream(o: Options): VoiceStream {
  const key = process.env.ELEVENLABS_API_KEY ?? "";
  const url = `${URL_BASE}?model_id=${VOICE_STREAM_MODEL}&output_format=${VOICE_STREAM_FORMAT}&sync_alignment=true`;
  const ws = (o.connect ?? ((u: string) => new WebSocket(u)))(url);
  let open = false;
  let closed = false;
  let failed = false;
  let started = false;
  let chars = 0;
  let ended = false;
  const outbox: string[] = [];
  let finish: () => void = () => {};
  const finished = new Promise<void>((r) => (finish = r));
  let idle: ReturnType<typeof setInterval> | null = null;

  const send = (msg: Record<string, unknown>) => {
    const text = JSON.stringify(msg);
    if (open && !closed) ws.send(text);
    else if (!closed) outbox.push(text);
  };
  const fail = (why: string) => {
    if (failed || closed) return;
    failed = true;
    o.onError(why, started);
    shut();
  };
  const shut = () => {
    if (idle) clearInterval(idle);
    idle = null;
    if (!closed) {
      closed = true;
      try {
        ws.close();
      } catch {}
    }
    finish();
  };

  ws.onopen = () => {
    open = true;
    ws.send(JSON.stringify({ voices: [o.voiceId], xi_api_key: key, voice_settings: { stability: o.stability ?? 0.5 } }));
    for (const m of outbox.splice(0)) ws.send(m);
    // A lookup can outlast the socket's 20 s idle limit: keep it alive.
    idle = setInterval(() => {
      if (open && !closed) ws.send(JSON.stringify({ keep_alive: true }));
    }, IDLE_KEEPALIVE_MS);
  };
  ws.onmessage = (e: MessageEvent) => {
    let m: { audio?: unknown; alignment?: { chars?: unknown } | null; is_final?: unknown; error?: unknown; message?: unknown } = {};
    try {
      m = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (typeof m.audio === "string" && m.audio) {
      started = true;
      const chars = Array.isArray(m.alignment?.chars) ? (m.alignment.chars as unknown[]).filter((c) => typeof c === "string").join("") : "";
      o.onAudio(m.audio, chars);
    }
    if (m.error) fail(`${String(m.error)}: ${String(m.message ?? "")}`.slice(0, 200));
    if (m.is_final) shut();
  };
  ws.onerror = () => fail("socket error");
  ws.onclose = () => {
    if (!ended && !failed) fail("closed early");
    else shut();
  };

  return {
    push(text: string) {
      if (!text || closed || ended) return;
      chars += text.length;
      send({ inputs: [{ text, voice_id: o.voiceId }] });
    },
    flush() {
      if (!closed && !ended) send({ flush: true });
    },
    end() {
      if (!ended && !closed) {
        ended = true;
        send({ close_socket: true });
      }
      return finished;
    },
    abort() {
      ended = true;
      shut();
    },
    get chars() {
      return chars;
    },
    get started() {
      return started;
    },
  };
}
