import { describe, expect, it } from "vitest";
import {
  GOODBYE_MAX_MS,
  GOODBYE_QUIET_MS,
  goodbyeSaid,
  isReply,
  LiveTalk,
  MAX_TALK_LINES,
  parseLiveContext,
  parseTalk,
  sayBrainGoodbye,
  talkMessages,
} from "./live-talk";

// A line said from `at` ms on the call's timeline, word by word (250 ms
// each) like GPT-Live's transcript deltas.
function person(t: LiveTalk, text: string, at: number) {
  text.split(/(?<= )/).forEach((w, i) => t.heard(w, at + i * 250, at + (i + 1) * 250));
}
function her(t: LiveTalk, text: string, at: number) {
  text.split(/(?<= )/).forEach((w, i) => t.said(w, at + i * 250, at + (i + 1) * 250));
}

describe("isReply", () => {
  it("tells a listening sound from a reply", () => {
    for (const s of ["Mm.", "Uh-h", "uh.", "Uh-huh, yeah", "Okay."]) expect(isReply(s)).toBe(false);
    for (const s of ["Great, what's up?", "Sure, let me check.", "Yesterday you made two videos."]) expect(isReply(s)).toBe(true);
  });
});

describe("LiveTalk", () => {
  it("hands over the question and saves the chat before it, in order", () => {
    const t = new LiveTalk();
    person(t, "Hi Aly, how are you?", 0);
    her(t, "Great! What are we making today?", 2500);
    person(t, "What did I render yesterday?", 5000);
    const h = t.handOver(7400);
    expect(h.words).toBe("What did I render yesterday?");
    expect(h.before).toEqual([
      { who: "person", text: "Hi Aly, how are you?" },
      { who: "her", text: "Great! What are we making today?" },
    ]);
    expect(h.context).toBe(
      "Them: Hi Aly, how are you?\nYou (the voice): Great! What are we making today?\nThem: What did I render yesterday?",
    );
    // Her "checking", then the answer retold: neither is small talk, and
    // what they said while waiting got no real reply of its own.
    her(t, "Sure, checking.", 7500);
    person(t, "Take your time.", 8800);
    her(t, "No rush on my end.", 10500);
    t.answered();
    her(t, "Yesterday you made two videos of Eva.", 13000);
    person(t, "Cool, thanks!", 16000);
    her(t, "Anytime, enjoy them!", 17500);
    expect(t.flush()).toEqual([
      { who: "person", text: "Cool, thanks!" },
      { who: "her", text: "Anytime, enjoy them!" },
    ]);
  });

  it("a question said in two goes is one request", () => {
    const t = new LiveTalk();
    person(t, "Can you check my renders", 0);
    person(t, "from yesterday?", 2800);
    const h = t.handOver(4200);
    expect(h.words).toBe("Can you check my renders … from yesterday?");
    expect(h.before).toEqual([]);
  });

  it("her 'checking' that began before the hand-over arrived isn't taken for a reply", () => {
    const t = new LiveTalk();
    person(t, "What did I render yesterday?", 0);
    her(t, "Let me check on that.", 2300);
    // Arrives 1.5 s after she began: her line looks like a reply, and
    // nothing came after it, so the request is the line before it.
    const h = t.handOver(3800);
    expect(h.words).toBe("What did I render yesterday?");
    expect(t.flush()).toEqual([]);
  });

  it("her line begun just before the hand-over is its 'checking'", () => {
    const t = new LiveTalk();
    person(t, "Open my last render", 0);
    her(t, "On it, one sec.", 2600);
    const h = t.handOver(2900);
    expect(h.words).toBe("Open my last render");
    expect(t.flush()).toEqual([]);
  });

  it("each speaker's line runs until they pause, even while the other talks", () => {
    const t = new LiveTalk();
    // She retells an answer while a TV keeps talking underneath.
    person(t, "What did I make yesterday?", 0);
    t.handOver(1600);
    t.answered();
    her(t, "Yesterday you made two videos of Eva, a rooftop at sunset and a close-up.", 4000);
    person(t, "the city council has approved", 4300);
    person(t, "the new tram line which will", 6000);
    t.finish();
    const lines = t.lines.map((l) => `${l.who}: ${l.text}`);
    expect(lines).toContain("her: Yesterday you made two videos of Eva, a rooftop at sunset and a close-up.");
    // Nothing she didn't really answer is saved: the retelling, the TV.
    expect(t.flush()).toEqual([]);
  });

  it("an answer retold in two goes, with a TV heard in the pause, is still the answer", () => {
    const t = new LiveTalk();
    person(t, "Can you check what I rendered yesterday", 0);
    t.handOver(2200);
    her(t, "Sure, I'll take a look.", 2300);
    t.answered("Yesterday you made two videos of Eva: a rooftop at sunset, and a close-up of her eyes in the rain. Both finished, and the rooftop one scored 88.");
    her(t, "Yesterday you made two videos of Eva, one at sunset, and a close-up in the rain.", 4500);
    person(t, "and the home side won", 8200);
    her(t, "Both finished fine, and the rooftop one scored 88.", 10000);
    person(t, "Great, thanks a lot", 16000);
    her(t, "No problem at all.", 17500);
    // The TV's words in her pause got the rest of the answer, not a reply: left out.
    expect(t.flush()).toEqual([
      { who: "person", text: "Great, thanks a lot" },
      { who: "her", text: "No problem at all." },
    ]);
  });

  it("a TV under the question: her listening sounds aren't replies, so the question is still handed over", () => {
    const t = new LiveTalk();
    person(t, "with flood warnings in place for several rivers, in other news the city council has", 0);
    person(t, "can you check what I rendered yesterday", 4600);
    her(t, "Uh-huh.", 7000);
    person(t, "which will connect the airport to the centre by 2028", 7400);
    her(t, "Mm.", 21000);
    person(t, "expected across the north with", 22000);
    const h = t.handOver(24000);
    expect(h.words).toContain("can you check what I rendered yesterday");
    expect(h.context).toContain("can you check what I rendered yesterday");
    expect(t.flush()).toEqual([]);
  });

  it("mid-call saves stop at her last reply; the end leaves out what she never answered", () => {
    const t = new LiveTalk();
    person(t, "Morning!", 0);
    her(t, "Morning! Coffee first, or straight to work?", 1500);
    person(t, "Always coffee.", 5000);
    expect(t.flush(7000)).toEqual([
      { who: "person", text: "Morning!" },
      { who: "her", text: "Morning! Coffee first, or straight to work?" },
    ]);
    her(t, "Smart, same here.", 7200);
    expect(t.flush(10000)).toEqual([
      { who: "person", text: "Always coffee." },
      { who: "her", text: "Smart, same here." },
    ]);
    person(t, "Hmm, so", 12000);
    expect(t.flush()).toEqual([]);
  });

  it("nothing is saved twice", () => {
    const t = new LiveTalk();
    person(t, "Hi there Aly", 0);
    her(t, "Hey! Good to hear you.", 1200);
    person(t, "Show my characters", 3500);
    expect(t.handOver(5000).before).toEqual([
      { who: "person", text: "Hi there Aly" },
      { who: "her", text: "Hey! Good to hear you." },
    ]);
    her(t, "Checking now.", 5100);
    t.answered();
    her(t, "You have three of them.", 7500);
    expect(t.flush()).toEqual([]);
  });
});

describe("parseTalk", () => {
  it("keeps well-formed lines, joins a speaker's lines in a row, and caps", () => {
    expect(
      parseTalk([
        { who: "person", text: "  Hi  there " },
        { who: "person", text: "Aly" },
        { who: "her", text: "Hey!\u0000" },
        { who: "robot", text: "no" },
        { who: "her", text: 5 },
        null,
        { who: "her", text: "   " },
      ]),
    ).toEqual([
      { who: "person", text: "Hi there Aly" },
      { who: "her", text: "Hey!" },
    ]);
    expect(parseTalk("nope")).toEqual([]);
    const many = Array.from({ length: 40 }, (_, i) => ({ who: i % 2 ? "her" : "person", text: `line ${i}` }));
    expect(parseTalk(many)).toHaveLength(MAX_TALK_LINES);
    const long = Array.from({ length: 10 }, (_, i) => ({ who: i % 2 ? "her" : "person", text: "x".repeat(1500) }));
    expect(parseTalk(long).length).toBe(5); // 1,200 each, 6,000 in all
  });
});

describe("parseLiveContext", () => {
  it("keeps lines, drops control characters, and caps from the end", () => {
    expect(parseLiveContext("Them: hi\u0007 there\n\n  You (the voice): hey  ")).toBe("Them: hi there\nYou (the voice): hey");
    expect(parseLiveContext(5)).toBeNull();
    expect(parseLiveContext("  \n ")).toBeNull();
    expect(parseLiveContext("x".repeat(5000))!.length).toBe(3000);
  });
});

describe("talkMessages", () => {
  it("stores the person's lines as theirs and hers as her answers, marked live", () => {
    expect(talkMessages([{ who: "person", text: "Hi" }, { who: "her", text: "Hey!" }])).toEqual([
      { role: "user", content: [{ type: "text", text: "Hi" }], display: { text: "Hi", live: true } },
      { role: "assistant", content: [{ type: "text", text: "Hey!" }], display: { text: "Hey!", cards: [], live: true } },
    ]);
  });
});

describe("a goodbye ends the call (2026-09-30, \"she keeps the mic on\")", () => {
  const told = 10_000;
  it("waits while she is still saying goodbye", () => {
    // She spoke 400 ms ago.
    expect(goodbyeSaid({ now: told + 500, told, herAt: told + 100, callMs: 60_000, herUntil: 59_000 })).toBe(false);
    // Quiet long enough, but the call's clock hasn't reached the end of her words yet.
    expect(goodbyeSaid({ now: told + 3000, told, herAt: told, callMs: 60_000, herUntil: 60_500 })).toBe(false);
  });

  it("closes once she has been quiet and her words have played", () => {
    expect(goodbyeSaid({ now: told + GOODBYE_QUIET_MS, told, herAt: told, callMs: 61_000, herUntil: 60_500 })).toBe(true);
  });

  it("closes after the longest wait whatever she's doing", () => {
    expect(goodbyeSaid({ now: told + GOODBYE_MAX_MS, told, herAt: told + GOODBYE_MAX_MS, callMs: 0, herUntil: 99_000 })).toBe(true);
  });

  it("says the brain's goodbye only when the voice said nothing since the hand-over", () => {
    expect(sayBrainGoodbye("Bye for now!", 900, 1000)).toBe(true);
    expect(sayBrainGoodbye("Bye for now!", 1200, 1000)).toBe(false);
    expect(sayBrainGoodbye("  ", 0, 1000)).toBe(false);
  });
});
