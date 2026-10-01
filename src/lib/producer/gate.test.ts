import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gatePromptFor, gateRequestFor, judgeSpoken, letBe } from "./gate";
import { answerPending, recentLines, secondsSinceAssistant } from "./history";
import { GATE_MODEL, GATE_USD_PER_M_IN, GATE_USD_PER_M_OUT, gateCostUsd } from "./prices";

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
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
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
      expect(r.verdict).toBe("unjudged");
    } finally {
      if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
    }
  });
});

// GPT-6 Luna judges since 2026-10-01 (Claude Haiku 4.5 before): the same
// instructions and text, an answer in a fixed JSON shape, and a failure that
// never drops what was said.
describe("the judge's call (GPT-6 Luna, Responses API)", () => {
  const heard = {
    name: "Aly",
    recent: [{ who: "assistant" as const, text: "Want the same lighting, or warmer?" }],
    words: "Warmer.",
    confidence: -0.2,
    nearness: 0.9,
    whileAnswering: false,
    sinceAssistant: 4,
  };
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const said = (verdict: string) => ({
    model: "gpt-6-luna",
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ verdict }) }] }],
    usage: { input_tokens: 742, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 17 },
  });
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
  });

  it("asks Luna with no reasoning, nothing stored, no cache writes, and one JSON shape", () => {
    const body = gateRequestFor(heard);
    expect(GATE_MODEL).toBe("gpt-6-luna");
    expect(body).toMatchObject({
      model: "gpt-6-luna",
      reasoning: { effort: "none" },
      max_output_tokens: 40,
      store: false,
      prompt_cache_options: { mode: "explicit" },
      input: gatePromptFor(heard),
    });
    // Explicit mode with no breakpoint is what turns caching off.
    expect(JSON.stringify(body)).not.toContain("prompt_cache_breakpoint");
    expect(body.instructions).toContain("Judge by what the words mean in this conversation, not by particular words.");
    expect(body.text.format).toEqual({
      type: "json_schema",
      name: "verdict",
      description: "Record whether the words were said to the assistant.",
      schema: {
        type: "object",
        properties: { verdict: { type: "string", enum: ["to_producer", "not_for_producer", "unclear"] } },
        required: ["verdict"],
        additionalProperties: false,
      },
      strict: true,
    });
  });

  it("reads the verdict and what it read and wrote", async () => {
    let url = "";
    let auth = "";
    const fetchFn = (async (u: string, init: RequestInit) => {
      url = u;
      auth = String((init.headers as Record<string, string>).authorization);
      return answer(said("not_for_producer"));
    }) as unknown as typeof fetch;
    const r = await judgeSpoken(heard, { fetchFn });
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(auth).toBe("Bearer test-key");
    expect(r).toEqual({ verdict: "not_for_producer", usage: { input: 742, output: 17 } });
    for (const v of ["to_producer", "unclear"]) {
      expect((await judgeSpoken(heard, { fetchFn: (async () => answer(said(v))) as unknown as typeof fetch })).verdict).toBe(v);
    }
  });

  it("gives no verdict, and drops nothing, when the answer holds none", async () => {
    const replies = [
      answer({ error: { message: "overloaded" } }, 500),
      answer({ output: [{ type: "message", content: [{ type: "refusal", refusal: "I can't help with that." }] }], usage: { input_tokens: 742, output_tokens: 9 } }),
      answer({ status: "incomplete", output: [{ type: "message", content: [{ type: "output_text", text: '{"verdict":"not_for' }] }] }),
      answer(said("maybe")),
      new Response("not json", { status: 200 }),
    ];
    for (const reply of replies) {
      const r = await judgeSpoken(heard, { fetchFn: (async () => reply) as unknown as typeof fetch });
      expect(r.verdict).toBe("unjudged");
      expect(letBe(r.verdict, { nearness: 0.2, confidence: -1.5 })).toBe(false);
    }
    // What a refusal read and wrote is still counted: those tokens were billed.
    const refused = await judgeSpoken(heard, {
      fetchFn: (async () =>
        answer({ output: [{ type: "message", content: [{ type: "refusal", refusal: "No." }] }], usage: { input_tokens: 742, output_tokens: 9 } })) as unknown as typeof fetch,
    });
    expect(refused.usage).toEqual({ input: 742, output: 9 });
  });

  it("gives up after the timeout, or when the request is withdrawn, with no verdict", async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    const t0 = Date.now();
    expect((await judgeSpoken(heard, { fetchFn: hang, timeoutMs: 30 })).verdict).toBe("unjudged");
    expect(Date.now() - t0).toBeLessThan(1000);

    const withdrawn = new AbortController();
    const pending = judgeSpoken(heard, { fetchFn: hang, signal: withdrawn.signal, timeoutMs: 60_000 });
    withdrawn.abort();
    expect((await pending).verdict).toBe("unjudged");

    let called = false;
    const already = new AbortController();
    already.abort();
    const r = await judgeSpoken(heard, {
      fetchFn: (async () => {
        called = true;
        return answer(said("to_producer"));
      }) as unknown as typeof fetch,
      signal: already.signal,
    });
    expect([r.verdict, called]).toEqual(["unjudged", false]);
  });

  it("costs Luna's price: $0.10 per 1M in, $0.50 per 1M out", () => {
    expect([GATE_USD_PER_M_IN, GATE_USD_PER_M_OUT]).toEqual([0.1, 0.5]);
    expect(gateCostUsd(742, 17)).toBeCloseTo((742 * 0.1 + 17 * 0.5) / 1_000_000, 12);
    expect(gateCostUsd(-5, -1)).toBe(0);
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

describe("what is let be (2026-09-28 evening: background voices)", () => {
  it("lets be a clear no, and an unclear one that also sounds like the room", () => {
    expect(letBe("not_for_producer", { nearness: 1, confidence: -0.1 })).toBe(true);
    // Unclear, and noticeably quieter than the person, or words the transcriber wasn't sure of.
    expect(letBe("unclear", { nearness: 0.35, confidence: -0.1 })).toBe(true);
    expect(letBe("unclear", { nearness: 0.9, confidence: -1.2 })).toBe(true);
  });

  it("keeps an unclear one as loud as the person, or before their level is known", () => {
    expect(letBe("unclear", { nearness: 0.8, confidence: -0.2 })).toBe(false);
    expect(letBe("unclear", { nearness: null, confidence: null })).toBe(false);
    expect(letBe("to_producer", { nearness: 0.2, confidence: -1.5 })).toBe(false);
  });

  // Until 2026-10-01 a failed judgement came back "unclear", so a quiet
  // message whose judgement failed or ran out of time was let be.
  it("keeps every message the judge couldn't judge, however quiet", () => {
    expect(letBe("unjudged", { nearness: 0.1, confidence: -2 })).toBe(false);
    expect(letBe("unjudged", { nearness: null, confidence: null })).toBe(false);
  });

  it("no longer tells the judge that loud and clear leans towards the assistant", () => {
    const gate = readFileSync(join(__dirname, "gate.ts"), "utf8");
    expect(gate).not.toContain("lean towards said to the assistant");
    expect(gate).toContain("Loudness is only a clue");
  });
});
