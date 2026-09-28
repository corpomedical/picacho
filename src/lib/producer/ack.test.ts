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

  it("speaks it in her voice with ElevenLabs Flash, then remembers it for that voice", async () => {
    const calls: { url: string; body: string }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(new Uint8Array(4000), { status: 200 });
    }) as unknown as typeof fetch;
    const voice = "AbCdEfGhIjKlMnOpQrSt";
    const first = await speakAck("Okay, on it.", voice, { fetchImpl: fakeFetch });
    expect(first?.cached).toBe(false);
    expect(calls[0].url).toContain(`/v1/text-to-speech/${voice}`);
    expect(JSON.parse(calls[0].body).model_id).toBe("eleven_flash_v2_5");
    const again = await speakAck("Okay, on it.", voice, { fetchImpl: fakeFetch });
    expect(again?.cached).toBe(true);
    expect(calls.length).toBe(1);
  });

  it("says nothing when it can't: no key, a voice id that isn't ElevenLabs', or a failed call", async () => {
    const ok = (async () => new Response(new Uint8Array(4000), { status: 200 })) as unknown as typeof fetch;
    expect(await speakAck("Okay.", "Rachel", { fetchImpl: ok })).toBeNull();
    const failing = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(await speakAck("Okay.", "AbCdEfGhIjKlMnOpQrSt", { fetchImpl: failing })).toBeNull();
    delete process.env.ELEVENLABS_API_KEY;
    expect(await speakAck("Okay.", "AbCdEfGhIjKlMnOpQrSt", { fetchImpl: ok })).toBeNull();
  });
});
