import { describe, expect, it } from "vitest";
import { DEFAULT_PTT_KEY, PTT_KEY_DELAY_MS, parsePttKey, pttKeyName, reservedKey, typesCharacter } from "./ptt-key";

describe("the push-to-talk key", () => {
  it("is right Option by default, his pick", () => {
    expect(DEFAULT_PTT_KEY).toBe("AltRight");
    expect(pttKeyName("AltRight", true)).toBe("Right Option ⌥");
    expect(pttKeyName("AltRight", false)).toBe("Right Alt");
  });

  it("reads a stored key, off, or anything else as the default", () => {
    expect(parsePttKey("F8")).toBe("F8");
    expect(parsePttKey("off")).toBe("off");
    expect(parsePttKey(null)).toBe("AltRight");
    expect(parsePttKey("")).toBe("AltRight");
    expect(parsePttKey("<script>")).toBe("AltRight");
  });

  it("names keys as people know them", () => {
    expect(pttKeyName("KeyT", true)).toBe("T");
    expect(pttKeyName("Digit5", false)).toBe("5");
    expect(pttKeyName("F9", false)).toBe("F9");
    expect(pttKeyName("MetaRight", true)).toBe("Right Command ⌘");
    expect(pttKeyName("off", true)).toBe("Off");
  });

  it("knows which keys type into a text box, and which it must never take", () => {
    expect(typesCharacter("KeyA")).toBe(true);
    expect(typesCharacter("Space")).toBe(true);
    expect(typesCharacter("AltRight")).toBe(false);
    expect(typesCharacter("F8")).toBe(false);
    expect(reservedKey("Escape")).toBe(true);
    expect(reservedKey("Enter")).toBe(true);
    expect(reservedKey("AltRight")).toBe(false);
  });

  it("waits a moment before opening the mic, so Option + a letter never does", () => {
    expect(PTT_KEY_DELAY_MS).toBeGreaterThanOrEqual(120);
    expect(PTT_KEY_DELAY_MS).toBeLessThanOrEqual(250);
  });
});
