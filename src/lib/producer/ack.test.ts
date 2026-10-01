import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACK_PHRASES, clearAckCache, pickAck, speakAck } from "./ack";
import { PERSONALITIES } from "./personality";

// Said at once while she thinks (2026-09-28, operator: "Make her respond with
// something while she gets an answer").
describe("the acknowledgement", () => {
  const KEY = process.env.ELEVENLABS_API_KEY;
  beforeEach(() => {
    process.env.ELEVENLABS_API_KEY = "test-key";
    clearAckCache();
  });
  afterEach(() => {
    if (KEY === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = KEY;
  });

  it("has short phrases for every personality", () => {
    for (const p of PERSONALITIES) {
      expect(ACK_PHRASES[p].length).toBeGreaterThanOrEqual(4);
      for (const phrase of ACK_PHRASES[p]) expect(phrase.length).toBeLessThanOrEqual(45);
    }
  });

  it("never says the same phrase twice in a row", () => {
    let last: string | null = null;
    for (let i = 0; i < 50; i++) {
      const next = pickAck("default", last, () => (i % 7) / 7);
      expect(next).not.toBe(last);
      last = next;
    }
  });

  // A stand-in for the dialogue socket: answers the close with one chunk of
  // audio and is_final (or with `reply`, for the failures).
  function fakeSocket(reply: "ok" | "error" | "silent" = "ok") {
    const opened: { url: string; sent: Record<string, unknown>[] }[] = [];
    const connect = (url: string) => {
      const rec = { url, sent: [] as Record<string, unknown>[] };
      opened.push(rec);
      const sock = {
        onopen: null as null | (() => void),
        onmessage: null as null | ((e: { data: string }) => void),
        onerror: null as null | (() => void),
        onclose: null as null | (() => void),
        send(t: string) {
          const m = JSON.parse(t);
          rec.sent.push(m);
          if (!m.close_socket || reply === "silent") return;
          if (reply === "error") {
            sock.onmessage?.({ data: JSON.stringify({ error: "bad", message: "nope" }) });
            return;
          }
          sock.onmessage?.({ data: JSON.stringify({ audio: Buffer.alloc(4000, 1).toString("base64"), alignment: { chars: [...String(rec.sent[1]?.inputs ? (rec.sent[1].inputs as { text: string }[])[0].text : "")] } }) });
          sock.onmessage?.({ data: JSON.stringify({ is_final: true }) });
        },
        close() {},
      };
      queueMicrotask(() => sock.onopen?.());
      return sock as unknown as WebSocket;
    };
    return { connect, opened };
  }

  it("speaks it in her voice on the model her answer streams on, then remembers it for that voice", async () => {
    const { connect, opened } = fakeSocket();
    const voice = "AbCdEfGhIjKlMnOpQrSt";
    const first = await speakAck("Okay, on it.", voice, { connect });
    expect(first?.cached).toBe(false);
    expect(Buffer.from(first!.data, "base64").length).toBe(4000);
    expect(opened[0].url).toContain("model_id=eleven_v4_turbo");
    expect(opened[0].sent[0].voices).toEqual([voice]);
    expect(opened[0].sent[1]).toEqual({ inputs: [{ text: "Okay, on it.", voice_id: voice }] });
    const again = await speakAck("Okay, on it.", voice, { connect });
    expect(again?.cached).toBe(true);
    expect(opened.length).toBe(1);
  });

  it("says nothing when it can't: no key, a voice id that isn't ElevenLabs', a failed take, or too slow", async () => {
    expect(await speakAck("Okay.", "Rachel", { connect: fakeSocket().connect })).toBeNull();
    expect(await speakAck("Okay.", "AbCdEfGhIjKlMnOpQrSt", { connect: fakeSocket("error").connect })).toBeNull();
    expect(await speakAck("Okay.", "AbCdEfGhIjKlMnOpQrSt", { connect: fakeSocket("silent").connect, timeoutMs: 20 })).toBeNull();
    delete process.env.ELEVENLABS_API_KEY;
    expect(await speakAck("Okay.", "AbCdEfGhIjKlMnOpQrSt", { connect: fakeSocket().connect })).toBeNull();
  });
});
