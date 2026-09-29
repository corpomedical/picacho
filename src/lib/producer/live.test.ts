import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIVE_VOICE,
  LIVE_VOICES,
  commentaryPieces,
  createLiveSession,
  liveCostUsd,
  liveInstructions,
  liveSeed,
  parseLiveVoice,
} from "./live";

describe("her live voice (GPT-Live)", () => {
  it("offers GPT-Live's voices, marin by default, and nothing else", () => {
    expect(DEFAULT_LIVE_VOICE).toBe("marin");
    expect(LIVE_VOICES.map((v) => v.id)).toContain("willow");
    expect(parseLiveVoice("vesper")).toBe("vesper");
    expect(parseLiveVoice("Rachel")).toBe("marin");
    expect(parseLiveVoice(undefined)).toBe("marin");
  });

  it("costs $0.05 a minute, by the second", () => {
    expect(liveCostUsd(60)).toBeCloseTo(0.05, 6);
    expect(liveCostUsd(31)).toBeCloseTo(0.025833, 5);
    expect(liveCostUsd(-5)).toBe(0);
  });

  it("tells the voice who she is, how to talk, and to hand work to her brain without guessing", () => {
    const text = liveInstructions({ name: "Aly", personality: "sarcastic" });
    expect(text).toContain("You are Aly, the personal assistant inside Picacho");
    expect(text).toContain("Delegate to the backend whenever");
    expect(text).toContain("do not guess the result while waiting");
    expect(text).toContain("Dry, witty");
    expect(text).not.toContain("Blunt, impatient");
    // A custom name carries through; an empty one falls back.
    expect(liveInstructions({ name: "Nova", personality: "default" })).toContain("You are Nova,");
    expect(liveInstructions({ name: "  ", personality: "default" })).toContain("You are Aly,");
  });

  it("starts from the last lines of the conversation, oldest first, within its limits", () => {
    const lines = Array.from({ length: 14 }, (_, i) => ({ who: i % 2 ? ("assistant" as const) : ("person" as const), text: `line ${i}` }));
    const seed = liveSeed(lines) as { role: string; content: { type: string; text: string }[] }[];
    expect(seed).toHaveLength(10);
    expect(seed[0].content[0].text).toBe("line 4");
    expect(seed[9]).toEqual({ type: "message", role: "assistant", content: [{ type: "output_text", text: "line 13" }] });
    expect(seed[8]).toEqual({ type: "message", role: "user", content: [{ type: "input_text", text: "line 12" }] });
    const long = liveSeed(Array.from({ length: 10 }, () => ({ who: "person" as const, text: "x".repeat(2000) })));
    expect(long.length).toBeLessThanOrEqual(5);
  });

  it("hands long answers over in pieces under one append's limit, cut at sentence ends", () => {
    expect(commentaryPieces("  Short answer.  ")).toEqual(["Short answer."]);
    expect(commentaryPieces("")).toEqual([]);
    const long = Array.from({ length: 60 }, (_, i) => `This is sentence number ${i} of the answer.`).join(" ");
    const pieces = commentaryPieces(long, 400);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      expect(p.length).toBeLessThanOrEqual(400);
      expect(p.endsWith(".")).toBe(true);
    }
    expect(pieces.join(" ")).toBe(long);
  });

  it("creates the session the way OpenAI's guide does, with client delegation and nothing stored", async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return new Response(JSON.stringify({ session: { id: "live_1" }, transport: { type: "webrtc", sdp: "answer-sdp" } }), { status: 201 });
    }) as unknown as typeof fetch;
    const r = await createLiveSession({ sdp: "offer-sdp", voice: "willow", instructions: "be Aly", input: [], key: "sk-test", fetchImpl });
    expect(r).toEqual({ id: "live_1", sdp: "answer-sdp" });
    expect(sent!.url).toBe("https://api.openai.com/v1/live/sessions");
    expect((sent!.init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(sent!.init.body));
    expect(body).toEqual({
      session: {
        model: "gpt-live-1",
        instructions: "be Aly",
        audio: { output: { voice: "willow" } },
        delegation: { type: "client" },
        store: false,
        client: { data_channel: { allowed_client_events: ["session.commentary.append", "session.close"] } },
      },
      transport: { type: "webrtc", sdp: "offer-sdp" },
    });
  });

  it("says why when OpenAI refuses", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: "model not available" } }), { status: 403 })) as unknown as typeof fetch;
    await expect(createLiveSession({ sdp: "o", voice: "marin", instructions: "i", input: [], key: "k", fetchImpl })).rejects.toThrow("model not available");
  });
});
