import { describe, expect, it } from "vitest";
import { timingNote, voicePathNote } from "./diag";
import { onlyOpeningsFrom } from "./history";

const ID = "kdmDKE6EkgrWrrykO9Qt";

describe("the voice log's note on her voice", () => {
  it("says when everything is on", () => {
    expect(voicePathNote({ speaking: true, voiceId: ID, key: true, webSocket: true, asked: true })).toBe("fast voice: on · one-sec: on");
  });

  it("names the missing key first: both are off without it", () => {
    expect(voicePathNote({ speaking: true, voiceId: ID, key: false, webSocket: true, asked: true })).toBe(
      "fast voice: off (no ElevenLabs key on the server) · one-sec: off (no ElevenLabs key on the server)",
    );
  });

  it("names a voice with no ElevenLabs id (a legacy name like Rachel)", () => {
    expect(voicePathNote({ speaking: true, voiceId: "Rachel", key: true, webSocket: true, asked: true })).toContain(
      "the picked voice has no ElevenLabs id",
    );
  });

  it("keeps the one-sec on when only the fast voice can't run", () => {
    expect(voicePathNote({ speaking: true, voiceId: ID, key: true, webSocket: false, asked: true })).toBe(
      "fast voice: off (the server has no WebSocket) · one-sec: on",
    );
    expect(voicePathNote({ speaking: true, voiceId: ID, key: true, webSocket: true, asked: false })).toBe(
      "fast voice: off (this browser can't play it) · one-sec: on",
    );
  });

  it("says so when the answer isn't read aloud", () => {
    expect(voicePathNote({ speaking: false, voiceId: ID, key: true, webSocket: true, asked: true })).toBe("voice: not reading aloud");
  });
});

describe("the voice log's timings", () => {
  it("gives each step's seconds from the request, only the steps that happened", () => {
    expect(timingNote({ start: 1000, transcribed: 2200, judged: 3000, opened: 3100, firstText: 4600, firstSound: 6100 })).toBe(
      "server: transcribed 1.2 s · judged 2.0 s · accepted 2.1 s · first words 3.6 s · first sound 5.1 s",
    );
    expect(timingNote({ start: 0 })).toBe("server: no steps timed");
  });
});

describe("a merged recording's retry (route.ts writeOpening)", () => {
  const row = (seq: number, role: "user" | "assistant" | "system") => ({ seq, role, content: [], display: null });
  it("goes on only when what landed first is someone's opening, never an answer", () => {
    const rows = [row(0, "user"), row(1, "system"), row(2, "assistant"), row(3, "user"), row(4, "system")];
    // The withdrawn recording's words and note landed at 3-4: take the next place.
    expect(onlyOpeningsFrom(rows, 3)).toBe(true);
    // An answer landed: a real turn is under way, so it stays refused.
    expect(onlyOpeningsFrom([...rows, row(5, "assistant")], 3)).toBe(false);
    expect(onlyOpeningsFrom(rows, 9)).toBe(true);
  });
});
