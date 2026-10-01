import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isStreamableVoiceId, openVoiceStream, resumeAt } from "./voice-stream";

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
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
  open() {
    this.onopen?.();
  }
  server(msg: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  /** The server hangs up (a close frame, no error message). */
  hangUp() {
    this.closed = true;
    this.onclose?.();
  }
}

const KEY = process.env.ELEVENLABS_API_KEY;
let clock = 0;
beforeEach(() => {
  process.env.ELEVENLABS_API_KEY = "test-key";
  vi.useFakeTimers();
  clock = 0;
});
afterEach(() => {
  vi.useRealTimers();
  if (KEY === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = KEY;
});
const tick = (ms: number) => {
  clock += ms;
  vi.advanceTimersByTime(ms);
};

function setup() {
  let sock!: FakeSocket;
  const audio: { data: string; words: string }[] = [];
  const errors: { why: string; voiced: number }[] = [];
  const vs = openVoiceStream({
    voiceId: "aj0fZfXTBc7E3By4X8L2",
    onAudio: (data, words) => audio.push({ data, words }),
    onError: (why, voiced) => errors.push({ why, voiced }),
    connect: (url) => (sock = new FakeSocket(url)) as unknown as WebSocket,
    now: () => clock,
  });
  return { vs, sock: () => sock, audio, errors };
}

describe("one take per answer (ElevenLabs Text-to-Dialogue)", () => {
  it("asks for Eleven v4 Turbo, MP3 and the words of each chunk", () => {
    const { sock } = setup();
    expect(sock().url).toBe(
      "wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=eleven_v4_turbo&output_format=mp3_44100_128&sync_alignment=true",
    );
  });

  it("registers the one voice first, then sends the words in order — even ones written before it opened", () => {
    const { vs, sock } = setup();
    vs.push("Sure, let me ");
    vs.push("check that.");
    // Nothing has gone out yet, so nothing is counted as sent.
    expect(vs.sent).toBe(0);
    sock().open();
    vs.push(" Two came back low.");
    expect(sock().sent[0]).toEqual({ voices: ["aj0fZfXTBc7E3By4X8L2"], xi_api_key: "test-key", voice_settings: { stability: 0.5 } });
    expect(sock().sent.slice(1)).toEqual([
      { inputs: [{ text: "Sure, let me ", voice_id: "aj0fZfXTBc7E3By4X8L2" }] },
      { inputs: [{ text: "check that.", voice_id: "aj0fZfXTBc7E3By4X8L2" }] },
      { inputs: [{ text: " Two came back low.", voice_id: "aj0fZfXTBc7E3By4X8L2" }] },
    ]);
    expect(vs.sent).toBe("Sure, let me check that. Two came back low.".length);
  });

  it("passes each chunk on with its words, counts what was voiced, and finishes on is_final", async () => {
    const { vs, sock, audio, errors } = setup();
    sock().open();
    vs.push("Sure, let me check.");
    sock().server({ audio: "AAAA", alignment: { chars: ["S", "u", "r", "e", ","] } });
    sock().server({ audio: "BBBB", alignment: null });
    expect(vs.started).toBe(true);
    expect(vs.voiced).toBe(5);
    const done = vs.end();
    expect(sock().sent.at(-1)).toEqual({ close_socket: true });
    sock().server({ is_final: true });
    await done;
    expect(audio).toEqual([
      { data: "AAAA", words: "Sure," },
      { data: "BBBB", words: "" },
    ]);
    expect(errors).toEqual([]);
    expect(sock().closed).toBe(true);
  });

  it("only is_final is success: a hang-up after the end is a failure, with how much was voiced", async () => {
    const { vs, sock, errors } = setup();
    sock().open();
    vs.push("Two came back low. Want me to try again?");
    sock().server({ audio: "AAAA", alignment: { chars: [..."Two came back low."] } });
    const done = vs.end();
    sock().hangUp();
    await done;
    expect(errors).toEqual([{ why: "closed before it finished", voiced: "Two came back low.".length }]);
  });

  it("keeps the socket alive through a lookup, and stops once the words are done", () => {
    const { vs, sock } = setup();
    sock().open();
    vs.push("Let me look at that render.");
    vs.flush();
    sock().server({ audio: "AAAA", alignment: { chars: [..."Let me look at that render."] } });
    for (let i = 0; i < 25; i++) tick(1_000);
    expect(sock().sent.filter((m) => m.keep_alive === true).length).toBe(2);
    void vs.end();
    const before = sock().sent.length;
    for (let i = 0; i < 12; i++) {
      tick(1_000);
      sock().server({ audio: "BBBB" }); // still speaking the rest: not stalled
    }
    expect(sock().sent.slice(before).filter((m) => m.keep_alive === true)).toEqual([]);
  });

  it("gives up on a take that never speaks — after a cold start's worth of waiting, not before", () => {
    const { vs, sock, errors } = setup();
    sock().open();
    vs.push("Sure.");
    void vs.end();
    for (let i = 0; i < 20; i++) tick(1_000);
    expect(errors).toEqual([]); // a cold voice took up to 10.6 s in the samples
    for (let i = 0; i < 6; i++) tick(1_000);
    expect(errors).toEqual([{ why: "no audio", voiced: 0 }]);
  });

  it("gives up on a take that stalls part-way", () => {
    const { vs, sock, errors } = setup();
    sock().open();
    vs.push("Two came back low. Want me to try again?");
    sock().server({ audio: "AAAA", alignment: { chars: [..."Two came back low."] } });
    void vs.end();
    for (let i = 0; i < 16; i++) tick(1_000);
    expect(errors).toEqual([{ why: "stalled", voiced: 18 }]);
  });

  it("says when the take fails, and cut off on purpose is not a failure", () => {
    const early = setup();
    early.sock().open();
    early.sock().server({ error: "voice_not_found", message: "no such voice" });
    expect(early.errors).toEqual([{ why: "voice_not_found: no such voice", voiced: 0 }]);

    const cut = setup();
    cut.sock().open();
    cut.vs.push("Two came back low.");
    cut.vs.abort();
    const n = cut.sock().sent.length;
    cut.vs.push("more words");
    cut.vs.flush();
    expect(cut.sock().sent.length).toBe(n);
    expect(cut.errors).toEqual([]);
  });

  it("picks the fallback up at the start of the sentence it stopped in", () => {
    const fed = "Two came back low. Both are on Kling. Want me to try the market again?";
    expect(resumeAt(fed, 0)).toBe(0);
    expect(resumeAt(fed, 10)).toBe(0); // mid first sentence: from the top
    expect(fed.slice(resumeAt(fed, 25))).toBe("Both are on Kling. Want me to try the market again?");
    expect(fed.slice(resumeAt(fed, fed.length))).toBe("");
  });

  it("streams only a real voice id (a legacy name like Rachel works only through fal)", () => {
    expect(isStreamableVoiceId("aj0fZfXTBc7E3By4X8L2")).toBe(true);
    expect(isStreamableVoiceId("Rachel")).toBe(false);
    expect(isStreamableVoiceId(null)).toBe(false);
  });
});
