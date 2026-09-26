import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gatePromptFor, judgeSpoken } from "./gate";
import { answerPending, recentLines, secondsSinceAssistant } from "./history";

const user = (text: string, created_at?: string) => ({ role: "user" as const, content: [], display: { text }, created_at });
const note = { role: "system" as const, content: "note", display: { kind: "state" } };
const answer = (text: string, created_at?: string) => ({
  role: "assistant" as const,
  content: [{ type: "text", text }],
  display: { text, cards: [] },
  created_at,
});

describe("what the judge reads", () => {
  it("is the recent conversation in order, with the signals in words, and no word lists", () => {
    const prompt = gatePromptFor({
      name: "Producer",
      recent: [
        { who: "person", text: "Plan something for Eva" },
        { who: "assistant", text: "Feed posts or Reels?" },
      ],
      words: "Reels, please",
      confidence: -0.1,
      nearness: 0.9,
      whileAnswering: false,
      sinceAssistant: 3.2,
    });
    expect(prompt).toContain("- Person: Plan something for Eva\n- Producer: Feed posts or Reels?");
    expect(prompt).toContain("Producer last spoke 3 seconds ago.");
    expect(prompt).toContain("How sure the transcriber was of the words: high.");
    expect(prompt).toContain("about as loud as the person's own voice");
    expect(prompt).toContain('"Reels, please"');
  });

  it("says plainly when a signal is unknown or weak", () => {
    const prompt = gatePromptFor({
      name: "Concierge",
      recent: [],
      words: "and allowing Israel to take parts of Saudi Arabia",
      confidence: -1.2,
      nearness: 0.2,
      whileAnswering: true,
      sinceAssistant: null,
    });
    expect(prompt).toContain("(nothing yet: this would be the first thing said)");
    expect(prompt).toContain("Concierge was in the middle of answering");
    expect(prompt).toContain("sure the transcriber was of the words: low");
    expect(prompt).toContain("much quieter than the person's own voice");
  });

  it("lets a message through when it can't judge (no key, no network)", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = await judgeSpoken({
        name: "Producer",
        recent: [],
        words: "hello",
        confidence: null,
        nearness: null,
        whileAnswering: false,
        sinceAssistant: null,
      });
      expect(r.verdict).toBe("unclear");
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe("the conversation's shape", () => {
  it("gives the last shown lines, oldest first, skipping notes, tool rounds and silences", () => {
    const rows = [
      user("one"),
      note,
      { role: "assistant" as const, content: [], display: null },
      answer("first answer"),
      user("two"),
      note,
      answer(""),
    ];
    expect(recentLines(rows)).toEqual([
      { who: "person", text: "one" },
      { who: "assistant", text: "first answer" },
      { who: "person", text: "two" },
    ]);
    expect(recentLines(rows, 2)).toEqual([
      { who: "assistant", text: "first answer" },
      { who: "person", text: "two" },
    ]);
  });

  it("knows how long ago the Producer last spoke", () => {
    const rows = [answer("hi", "2026-09-25T18:00:00Z"), user("hey", "2026-09-25T18:00:05Z"), note];
    expect(secondsSinceAssistant(rows, Date.parse("2026-09-25T18:00:30Z"))).toBe(30);
    expect(secondsSinceAssistant([user("hey")], Date.now())).toBeNull();
  });

  it("knows when an answer is still being written", () => {
    expect(answerPending([])).toBe(false);
    expect(answerPending([user("q"), note])).toBe(true);
    expect(answerPending([user("q"), note, answer("a")])).toBe(false);
    expect(
      answerPending([user("q"), note, { role: "assistant" as const, content: [{ type: "tool_use", id: "t" }], display: null }]),
    ).toBe(true);
    expect(answerPending([user("q"), note, { role: "user" as const, content: [], display: null }])).toBe(true);
  });
});

// The assistant is named Aly (2026-09-26). Tested for ~5 cents that day:
// the transcriber writes "Aly" when its prompt names it and "Allie" when it
// doesn't, and a misspelled name ("Ali, pode preparar a primeira") must still
// read as said to it — by meaning, never a list of spellings.
describe("a name the transcriber may misspell", () => {
  const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
  it("tells the judge a name can come out misspelled, and lists no spellings", () => {
    const gate = read("./gate.ts");
    expect(gate).toContain(
      "The transcriber may misspell that name, or write an everyday word that sounds like it as the name, so the name appearing in the words is not by itself a sign they were said to the assistant: judge what the whole sentence means.",
    );
    for (const spelling of ["Ally", "Allie", "Ali ", "Alê"]) expect(gate).not.toContain(spelling);
  });
  it("always gives the transcriber a name: settings, else the sheet's, else Aly", () => {
    const route = read("../../app/api/producer/route.ts");
    expect(route).toContain("soon(loading.then((l) => l.prefs.name), nameHint || DEFAULT_PRODUCER_NAME)");
    expect(read("../../components/producer/producer-lamp.tsx")).toContain("name: spoken ? name : undefined,");
    expect(read("./store.ts")).toContain('export const DEFAULT_PRODUCER_NAME = "Aly";');
  });
});
