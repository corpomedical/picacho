import { describe, expect, it } from "vitest";
import { CHAT_STYLES, CHAT_STYLE_LABELS, DEFAULT_CHAT_STYLE, countWords, parseChatStyle, subtitleView } from "./chat-style";

describe("the chat's style", () => {
  it("defaults to the floating card and offers exactly the card and subtitles", () => {
    expect(DEFAULT_CHAT_STYLE).toBe("card");
    expect([...CHAT_STYLES]).toEqual(["card", "subtitles"]);
    expect(CHAT_STYLE_LABELS.subtitles.name).toBe("Subtitles");
  });

  it("reads a stored style, and anything else as the default", () => {
    expect(parseChatStyle("subtitles")).toBe("subtitles");
    expect(parseChatStyle(undefined)).toBe("card");
    expect(parseChatStyle("teleprompter")).toBe("card");
  });

  it("counts the words she has said", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  Love that.  Her eyes ")).toBe(4);
  });
});

describe("a subtitle", () => {
  const answer = "Love that. Her eyes in the mirror, sun flaring across them, road behind her. Shall I set it up?";

  it("shows a short answer whole, all said when she isn't speaking it", () => {
    expect(subtitleView(answer, null)).toEqual({ cut: false, said: answer, rest: "" });
  });

  it("dims what she hasn't said yet", () => {
    const v = subtitleView(answer, 4);
    expect(v.said).toBe("Love that. Her eyes");
    expect(v.rest).toBe("in the mirror, sun flaring across them, road behind her. Shall I set it up?");
    expect(subtitleView(answer, 0).said).toBe("");
    expect(subtitleView(answer, 999).rest).toBe("");
  });

  it("keeps the end of a long answer, starting at a sentence when one is near", () => {
    const long = `${"First part goes on for a while here. ".repeat(8)}The last sentence is the one she says now.`;
    const v = subtitleView(long, null, 80);
    expect(v.cut).toBe(true);
    expect(v.said.endsWith("The last sentence is the one she says now.")).toBe(true);
    expect(v.said.length).toBeLessThanOrEqual(80);
    expect(/^[A-Z]/.test(v.said)).toBe(true);
  });

  it("counts spoken words from the start of the whole answer when the start is cut", () => {
    const words = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
    const v = subtitleView(words, 55, 40);
    const shownFirst = Number(v.said.split(" ")[0].slice(1));
    const saidWords = v.said.split(" ").length;
    expect(shownFirst + saidWords).toBe(55);
  });
});
