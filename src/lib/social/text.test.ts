import { describe, expect, it } from "vitest";
import { HASHTAG_INVALID, TEXT_TOO_LONG, THREADS_AI_TAG, TOO_MANY_HASHTAGS, X_NO_LINKS } from "./messages";
import { composeText, hasLink, textLength, textProblems, tidyCaption, tidyHashtags } from "./text";

describe("the words that post", () => {
  it("are the caption, the hashtags, and on Threads only a visible Made with AI line", () => {
    expect(composeText("x", "Morning ritual.", ["coffee", "ad"])).toBe("Morning ritual.\n\n#coffee #ad");
    expect(composeText("instagram", "Morning ritual.", [])).toBe("Morning ritual.");
    expect(composeText("tiktok", "", ["coffee"])).toBe("#coffee");
    expect(composeText("threads", "Morning ritual.", ["coffee"])).toBe(`Morning ritual.\n\n#coffee\n\n${THREADS_AI_TAG}`);
    expect(composeText("threads", "", [])).toBe(THREADS_AI_TAG);
  });

  it("never change the person's words: only line endings and outer blank lines are tidied", () => {
    expect(tidyCaption("  Hello  \r\nworld\t\n\n")).toBe("  Hello\nworld");
    expect(tidyCaption("Best coffee, #1!")).toBe("Best coffee, #1!");
  });

  it("hashtags: '#' dropped, repeats dropped, an invalid one is an error (never silently fixed)", () => {
    expect(tidyHashtags(["#Coffee", "coffee", " #ad ", ""])).toEqual({ ok: true, tags: ["Coffee", "ad"] });
    expect(tidyHashtags(["café_2026"])).toEqual({ ok: true, tags: ["café_2026"] });
    expect(tidyHashtags(["two words"])).toEqual({ ok: false, error: HASHTAG_INVALID });
    expect(tidyHashtags(["shop.com"])).toEqual({ ok: false, error: HASHTAG_INVALID });
  });
});

describe("lengths, counted each network's way", () => {
  it("X weighs most non-Latin characters double", () => {
    expect(textLength("x", "a".repeat(280))).toBe(280);
    expect(textLength("x", "日".repeat(140))).toBe(280);
    expect(textProblems("x", "a".repeat(281), [])).toContain(TEXT_TOO_LONG);
    expect(textProblems("x", "日".repeat(141), [])).toContain(TEXT_TOO_LONG);
  });

  it("Threads' 500 includes the Made with AI line", () => {
    const room = 500 - `\n\n${THREADS_AI_TAG}`.length;
    expect(textProblems("threads", "a".repeat(room), [])).toEqual([]);
    expect(textProblems("threads", "a".repeat(room + 1), [])).toEqual([TEXT_TOO_LONG]);
  });

  it("too many hashtags for the network", () => {
    const tags = Array.from({ length: 31 }, (_, i) => `t${i}`);
    expect(textProblems("instagram", "", tags)).toContain(TOO_MANY_HASHTAGS);
    expect(textProblems("threads", "", ["a", "b"])).toContain(TOO_MANY_HASHTAGS);
  });
});

describe("X refuses links in v1 (a link makes a post $0.200 instead of $0.015)", () => {
  it.each([
    "Shop now https://shop.example.com/p/1",
    "see www.acme.com",
    "Order at acme.com today",
    "picacho.ai",
    "Visit ACME.CO.UK!",
    "ftp://files.acme.io",
  ])("finds the link in %j", (text) => {
    expect(hasLink(text)).toBe(true);
    expect(textProblems("x", text, [])).toContain(X_NO_LINKS);
  });

  it.each(["Link in bio", "3.5 stars from us", "e.g. mornings", "hello@acme.com", "v2.0 is here", "Mr.Smith says hi"])(
    "leaves %j alone",
    (text) => {
      expect(hasLink(text)).toBe(false);
    },
  );

  it("other networks may carry a link", () => {
    expect(textProblems("instagram", "acme.com", [])).toEqual([]);
  });
});
