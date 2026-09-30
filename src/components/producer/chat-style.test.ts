import { describe, expect, it } from "vitest";
import { CHAT_STYLES, CHAT_STYLE_LABELS, DEFAULT_CHAT_STYLE, countWords, parseChatStyle, phoneSubtitle, subtitleView } from "./chat-style";

describe("the chat's style", () => {
  it("defaults to subtitles (2026-09-28) and offers exactly the card and subtitles", () => {
    expect(DEFAULT_CHAT_STYLE).toBe("subtitles");
    expect([...CHAT_STYLES]).toEqual(["card", "subtitles"]);
    expect(CHAT_STYLE_LABELS.subtitles.name).toBe("Subtitles");
  });

  it("reads a stored style, and anything else as the default", () => {
    expect(parseChatStyle("card")).toBe("card");
    expect(parseChatStyle("subtitles")).toBe("subtitles");
    expect(parseChatStyle(undefined)).toBe("subtitles");
    expect(parseChatStyle(null)).toBe("subtitles");
    expect(parseChatStyle("teleprompter")).toBe("subtitles");
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

describe("a phone's subtitle (2026-09-30, two lines at a time)", () => {
  const plan =
    'Here\'s a plan for a 15-second Instagram promo. Open on Eva walking into the night market, lanterns swinging overhead, with a slow push-in on her face for the first three seconds. Cut to her turning toward the stall as the steam catches the light, then a quick whip to the product in her hand. End on the Picacho logo over the crowd with the line "Made in one prompt." Want me to prepare it so you can send it?';
  const words = plan.split(" ");
  const pieces = () => {
    const seen: string[] = [];
    for (let k = 1; k <= words.length; k++) {
      const v = phoneSubtitle(plan, k);
      const whole = [v.said, v.rest].filter(Boolean).join(" ");
      if (seen[seen.length - 1] !== whole) seen.push(whole);
    }
    return seen;
  };

  it("follows her voice a piece at a time, each one short enough for two lines", () => {
    expect(pieces()).toEqual([
      "Here's a plan for a 15-second Instagram promo.",
      "Open on Eva walking into the night market, lanterns swinging overhead,",
      "with a slow push-in on her face for the first three seconds.",
      "Cut to her turning toward the stall as the steam catches the light,",
      "then a quick whip to the product in her hand.",
      'End on the Picacho logo over the crowd with the line "Made in one prompt."',
      "Want me to prepare it so you can send it?",
    ]);
    for (const p of pieces()) expect(p.length).toBeLessThanOrEqual(84);
    // Every word is in exactly one piece.
    expect(pieces().join(" ")).toBe(plan);
  });

  it("dims what she hasn't said yet inside the piece, and never marks it cut while she speaks", () => {
    const at = words.indexOf("crowd") + 1;
    const v = phoneSubtitle(plan, at);
    expect(v).toEqual({ cut: false, said: "End on the Picacho logo over the crowd", rest: 'with the line "Made in one prompt."' });
    expect(phoneSubtitle(plan, 0)).toEqual({ cut: false, said: "", rest: "Here's a plan for a 15-second Instagram promo." });
    expect(phoneSubtitle(plan, 999).said).toBe("Want me to prepare it so you can send it?");
  });

  it("shows the last piece, all said, when she isn't speaking; a short answer whole", () => {
    expect(phoneSubtitle(plan, null)).toEqual({ cut: true, said: "Want me to prepare it so you can send it?", rest: "" });
    expect(phoneSubtitle("Love that. Shall I set it up?", null)).toEqual({ cut: false, said: "Love that. Shall I set it up?", rest: "" });
    expect(phoneSubtitle("", null)).toEqual({ cut: false, said: "", rest: "" });
  });

  it("breaks a sentence with no commas at a word, within the limit", () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const v = phoneSubtitle(long, null, 50);
    expect(v.cut).toBe(true);
    for (let k = 1; k <= 40; k++) {
      const p = phoneSubtitle(long, k, 50);
      expect([p.said, p.rest].filter(Boolean).join(" ").length).toBeLessThanOrEqual(50);
    }
  });

  it("halves a sentence that doesn't fit instead of leaving a word or two on their own", () => {
    const line = 'End on the Picacho logo over the crowd with the line "Made in one prompt."';
    const shown: string[] = [];
    for (let k = 1; k <= line.split(" ").length; k++) {
      const p = phoneSubtitle(line, k, 69);
      const whole = [p.said, p.rest].filter(Boolean).join(" ");
      if (shown[shown.length - 1] !== whole) shown.push(whole);
    }
    expect(shown).toEqual(["End on the Picacho logo over the crowd", 'with the line "Made in one prompt."']);
  });

  it("keeps a single word longer than the limit rather than losing it", () => {
    const url = "https://example.com/" + "x".repeat(120);
    expect(phoneSubtitle(url, null, 60)).toEqual({ cut: false, said: url, rest: "" });
  });
});
