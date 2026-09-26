import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isStreamableVoiceId, openVoiceStream } from "./voice-stream";

// A stand-in for ElevenLabs' Text-to-Dialogue socket: records what was sent,
// and lets a test play the server's side.
class FakeSocket {
  sent: Record<string, unknown>[] = [];
  closed = false;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
  open() {
    this.onopen?.();
  }
  server(msg: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const KEY = process.env.ELEVENLABS_API_KEY;
beforeEach(() => {
  process.env.ELEVENLABS_API_KEY = "test-key";
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  if (KEY === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = KEY;
});

function setup() {
  let sock!: FakeSocket;
  const audio: { data: string; words: string }[] = [];
  const errors: { why: string; started: boolean }[] = [];
  const vs = openVoiceStream({
    voiceId: "aj0fZfXTBc7E3By4X8L2",
    onAudio: (data, words) => audio.push({ data, words }),
    onError: (why, started) => errors.push({ why, started }),
    connect: (url) => (sock = new FakeSocket(url)) as unknown as WebSocket,
  });
  return { vs, sock: () => sock, audio, errors };
}

describe("one take per answer (ElevenLabs Text-to-Dialogue)", () => {
  it("asks for the conversational model, MP3 and the words of each chunk", () => {
    const { sock } = setup();
    expect(sock().url).toBe(
      "wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=eleven_v3_conversational&output_format=mp3_44100_128&sync_alignment=true",
    );
  });

  it("registers the one voice first, then sends the words in order — even ones written before it opened", () => {
    const { vs, sock } = setup();
    vs.push("Sure, let me ");
    vs.push("check that.");
    sock().open();
    vs.push(" Two came back low.");
    expect(sock().sent[0]).toEqual({ voices: ["aj0fZfXTBc7E3By4X8L2"], xi_api_key: "test-key", voice_settings: { stability: 0.5 } });
    expect(sock().sent.slice(1)).toEqual([
      { inputs: [{ text: "Sure, let me ", voice_id: "aj0fZfXTBc7E3By4X8L2" }] },
      { inputs: [{ text: "check that.", voice_id: "aj0fZfXTBc7E3By4X8L2" }] },
      { inputs: [{ text: " Two came back low.", voice_id: "aj0fZfXTBc7E3By4X8L2" }] },
    ]);
    expect(vs.chars).toBe("Sure, let me check that. Two came back low.".length);
  });

  it("passes each chunk on with its words, and finishes on is_final", async () => {
    const { vs, sock, audio } = setup();
    sock().open();
    vs.push("Sure, let me check.");
    sock().server({ audio: "AAAA", alignment: { chars: ["S", "u", "r", "e", ","] } });
    sock().server({ audio: "BBBB", alignment: null });
    expect(vs.started).toBe(true);
    const done = vs.end();
    expect(sock().sent.at(-1)).toEqual({ close_socket: true });
    sock().server({ is_final: true });
    await done;
    expect(audio).toEqual([
      { data: "AAAA", words: "Sure," },
      { data: "BBBB", words: "" },
    ]);
    expect(sock().closed).toBe(true);
  });

  it("keeps the socket alive through a lookup longer than its 20 s idle limit", () => {
    const { sock } = setup();
    sock().open();
    vi.advanceTimersByTime(25_000);
    expect(sock().sent.filter((m) => m.keep_alive === true).length).toBe(2);
  });

  it("says when the take fails, and whether any audio had come back", () => {
    const early = setup();
    early.sock().open();
    early.sock().server({ error: "voice_not_found", message: "no such voice" });
    expect(early.errors).toEqual([{ why: "voice_not_found: no such voice", started: false }]);

    const late = setup();
    late.sock().open();
    late.sock().server({ audio: "AAAA" });
    late.sock().close();
    expect(late.errors).toEqual([{ why: "closed early", started: true }]);
  });

  it("sends nothing more once cut off", () => {
    const { vs, sock } = setup();
    sock().open();
    vs.abort();
    const n = sock().sent.length;
    vs.push("more words");
    vs.flush();
    expect(sock().sent.length).toBe(n);
  });

  it("streams only a real voice id (a legacy name like Rachel works only through fal)", () => {
    expect(isStreamableVoiceId("aj0fZfXTBc7E3By4X8L2")).toBe(true);
    expect(isStreamableVoiceId("Rachel")).toBe(false);
    expect(isStreamableVoiceId(null)).toBe(false);
  });
});
