import { describe, expect, it } from "vitest";
import { parseDialogueCue } from "./dialogue-cue";

describe("parseDialogueCue", () => {
  it("reads the operator's own example: (11-13s) with the end ignored", () => {
    const r = parseDialogueCue('(11-13s) "still me."');
    expect(r.startSeconds).toBe(11);
    expect(r.spokenText).toBe('"still me."');
  });

  it("accepts the simple forms", () => {
    expect(parseDialogueCue("(11s) hello").startSeconds).toBe(11);
    expect(parseDialogueCue("(11) hello").startSeconds).toBe(11);
    expect(parseDialogueCue("(2.5s) hello").startSeconds).toBe(2.5);
    expect(parseDialogueCue("  (3 - 5 s)  hello").spokenText).toBe("hello");
  });

  it("leaves stage directions alone — they are the voice model's vocabulary, not ours", () => {
    expect(parseDialogueCue("(laughs) oh no").startSeconds).toBeNull();
    expect(parseDialogueCue("(2 dogs barking) hello").startSeconds).toBeNull();
    expect(parseDialogueCue("(whispers) (11s) hi").startSeconds).toBeNull();
  });

  it("only reads a cue at the very start", () => {
    expect(parseDialogueCue('hello (11s) there').startSeconds).toBeNull();
  });

  it("rejects zero, negatives and typo-sized cues", () => {
    expect(parseDialogueCue("(0s) hi").startSeconds).toBeNull();
    expect(parseDialogueCue("(500s) hi").startSeconds).toBeNull();
  });
});
