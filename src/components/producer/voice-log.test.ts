import { describe as group, expect, it } from "vitest";
import { VOICE_LOG_MAX, appendEntry, describe, formatVoiceLog, type VoiceLogEntry } from "./voice-log";

group("the voice log", () => {
  it("keeps the newest entries only", () => {
    let list: VoiceLogEntry[] = [];
    for (let i = 0; i < VOICE_LOG_MAX + 25; i++) list = appendEntry(list, { t: i, kind: "k", detail: "" });
    expect(list.length).toBe(VOICE_LOG_MAX);
    expect(list[0].t).toBe(25);
    expect(list[list.length - 1].t).toBe(VOICE_LOG_MAX + 24);
  });

  it("writes an entry's numbers plainly and leaves out empty ones", () => {
    expect(describe({ s: 2.123456, level: 0.04, why: "far away", nothing: undefined, none: null, blank: "" })).toBe("s 2.123, level 0.04, why far away");
    expect(describe("mic denied")).toBe("mic denied");
    expect(describe()).toBe("");
  });

  it("reads as a list of steps with times", () => {
    const t = new Date(2026, 8, 27, 14, 3, 7, 412).getTime();
    const text = formatVoiceLog([
      { t, kind: "speech.end", detail: "s 2.1, level 0.04" },
      { t: t + 1500, kind: "send.failed", detail: "" },
    ]);
    expect(text).toBe("14:03:07.412  speech.end  s 2.1, level 0.04\n14:03:08.912  send.failed");
  });
});
