import { describe, expect, it } from "vitest";
import { PUSH_MAX_SECONDS, PUSH_MIN_SECONDS, PUSH_SILENCE, pushWorthSending } from "./voice-engine";

// Push to talk (2026-09-27): a hold of the lamp records until it is let go;
// an accidental hold, or one with nothing said, isn't sent.
const RATE = 16000;
const tone = (seconds: number, amp: number) =>
  Float32Array.from({ length: Math.round(RATE * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / RATE));

describe("push to talk", () => {
  it("sends a hold with speech in it", () => {
    expect(pushWorthSending(tone(1.2, 0.2))).toBe(true);
    expect(pushWorthSending(tone(PUSH_MIN_SECONDS + 0.05, 0.1))).toBe(true);
  });

  it("drops a hold too short to be a sentence (a tap that became a hold)", () => {
    expect(pushWorthSending(tone(0.2, 0.3))).toBe(false);
    expect(pushWorthSending(new Float32Array(0))).toBe(false);
  });

  it("drops a hold with nothing said: only the mic's own noise", () => {
    expect(pushWorthSending(tone(2, PUSH_SILENCE / 4))).toBe(false);
    expect(pushWorthSending(new Float32Array(RATE * 2))).toBe(false);
  });

  it("keeps a quiet voice that is still a voice", () => {
    expect(pushWorthSending(tone(1, PUSH_SILENCE * 3))).toBe(true);
  });

  it("caps a hold at a minute", () => {
    expect(PUSH_MAX_SECONDS).toBe(60);
  });
});
