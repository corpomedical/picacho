import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHOT_READER_MAX_COMPLETION } from "../../../src/lib/sets/shot-reading.ts";
import { SHOT_WORDS_MODEL } from "../../../src/lib/sets/shot-words.ts";
import { parseCli } from "./cli.mts";
import { blindProblems, CHECK_DIR, loadCorpus, type BlindCorpus } from "./corpus.mts";
import { garbageRun, load, perfectRun } from "./dry.mts";
import { fenceFor, READER_URL } from "./fence.mts";
import { actualUsd, priceProblems, worstUsd, type Prices } from "./money.mts";

// The phrase check around its grader (Helios Cut 2, step 13, 2026-09-25 —
// operator: "Run, keep going."): the command line never goes live by
// accident, a call's money is reserved and settled by the arithmetic the
// plan prints, the per-call fence sends only what was reserved, and the two
// free dry runs hold — the perfect reader passes all 105 phrases, and every
// wrong answer fails with every hard gate it owes.

describe("the command line: dry unless --live, and --live only with a cap", () => {
  it("is a dry run by default", () => {
    expect(parseCli([])).toEqual({ ok: true, cli: { mode: "dry", maxUsd: null, only: null, verbose: false, v1: true, envFile: null, help: false } });
    expect(parseCli(["--dry-garbage"])).toMatchObject({ ok: true, cli: { mode: "garbage" } });
    expect(parseCli(["--only", "A1,X54"])).toMatchObject({ ok: true, cli: { mode: "dry", only: ["A1", "X54"] } });
  });

  it("goes live only with --live and a --max-usd, never above $2", () => {
    expect(parseCli(["--live", "--max-usd", "0.50"])).toMatchObject({ ok: true, cli: { mode: "live", maxUsd: 0.5 } });
    expect(parseCli(["--live"]).ok).toBe(false);
    expect(parseCli(["--max-usd", "0.50"]).ok).toBe(false);
    expect(parseCli(["--live", "--max-usd", "50"]).ok).toBe(false);
    expect(parseCli(["--live", "--max-usd", "0"]).ok).toBe(false);
    expect(parseCli(["--live", "--max-usd", "abc"]).ok).toBe(false);
    expect(parseCli(["--live", "--dry-garbage", "--max-usd", "0.5"]).ok).toBe(false);
  });

  it("refuses the spec's old word for it, and anything it doesn't know", () => {
    const spend = parseCli(["--spend", "--max-usd", "0.50"]);
    expect(spend.ok).toBe(false);
    expect(!spend.ok && spend.error).toContain("--live");
    expect(parseCli(["--liv"]).ok).toBe(false);
    expect(parseCli(["--env-file", ".env.local"]).ok).toBe(false);
  });
});

describe("the money: reserved at the worst, settled from the usage", () => {
  const prices: Prices = { model: SHOT_WORDS_MODEL, inputPer1M: 0.75, cachedInputPer1M: 0.075, outputPer1M: 4.5, read: "2026-09-25", source: "x" };

  it("a call's worst: its characters at 2.5 a token, uncached, plus its whole cap", () => {
    // 7,000 characters = 2,800 tokens × $0.75/1M = $0.0021; 600 × $4.50/1M = $0.0027.
    expect(worstUsd(7000, 600, prices)).toBeCloseTo(0.0048, 10);
  });

  it("settles uncached, cached and output tokens at their own prices", () => {
    // 1,000 uncached × 0.75 + 800 cached × 0.075 + 60 out × 4.50, per 1M.
    const u = { model: SHOT_WORDS_MODEL, prompt: 1800, cached: 800, completion: 60, reasoning: 0, finish: "stop" };
    expect(actualUsd(u, prices)).toBeCloseTo((1000 * 0.75 + 800 * 0.075 + 60 * 4.5) / 1_000_000, 12);
    expect(actualUsd({ ...u, prompt: null }, prices)).toBeNull();
    expect(actualUsd(null, prices)).toBeNull();
  });

  it("a live run needs a price read within 7 days, for this model", () => {
    expect(priceProblems(prices, SHOT_WORDS_MODEL, new Date("2026-10-02T12:00:00Z"))).toEqual([]);
    expect(priceProblems(prices, SHOT_WORDS_MODEL, new Date("2026-10-03T12:00:00Z"))).toHaveLength(1);
    expect(priceProblems({ ...prices, model: "gpt-9" }, SHOT_WORDS_MODEL, new Date("2026-09-25T12:00:00Z"))).toHaveLength(1);
    expect(priceProblems({ ...prices, outputPer1M: 0 }, SHOT_WORDS_MODEL, new Date("2026-09-25T12:00:00Z"))).toHaveLength(1);
  });

  it("prices.json is the model's, with the date it was read", () => {
    const p = JSON.parse(readFileSync(`${CHECK_DIR}prices.json`, "utf8")) as Prices;
    expect(p.model).toBe(SHOT_WORDS_MODEL);
    expect(p.read).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(priceProblems(p, SHOT_WORDS_MODEL, new Date(`${p.read}T12:00:00Z`))).toEqual([]);
  });
});

describe("the per-call fence: only what the call was reserved for is sent", () => {
  afterEach(() => vi.unstubAllGlobals());
  const body = (over: Record<string, unknown> = {}) => JSON.stringify({ model: SHOT_WORDS_MODEL, max_completion_tokens: SHOT_READER_MAX_COMPLETION, reasoning_effort: "none", ...over });
  const answer = { choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 1800, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 1536 }, completion_tokens_details: { reasoning_tokens: 0 } } };

  it("sends a pinned v2 reading and reads its usage, never its words", async () => {
    const sent = vi.fn(async () => new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", sent);
    const f = fenceFor({ version: "v2", cap: SHOT_READER_MAX_COMPLETION });
    const res = await f.fetch(READER_URL, { method: "POST", body: body() });
    expect(res.status).toBe(200);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(f.sent).toBe(1);
    expect(f.call).toEqual({ status: 200, finish: "stop", reasoning: 0 });
    expect(f.usage).toEqual({ model: SHOT_WORDS_MODEL, prompt: 1800, cached: 1536, completion: 20, reasoning: 0, finish: "stop" });
  });

  it("refuses the reader's retry without reasoning_effort, a bigger cap, another model or address — before sending", async () => {
    const sent = vi.fn();
    vi.stubGlobal("fetch", sent);
    const retry = fenceFor({ version: "v2", cap: SHOT_READER_MAX_COMPLETION });
    await expect(retry.fetch(READER_URL, { method: "POST", body: body({ reasoning_effort: undefined, max_completion_tokens: 500 }) })).rejects.toThrow("reasoning_effort");
    expect(retry.effortRefused).toBe(true);
    const cases = [
      [READER_URL, body({ max_completion_tokens: 1500 })],
      [READER_URL, body({ model: "gpt-6" })],
      ["https://api.openai.com/v1/responses", body()],
    ] as const;
    for (const [url, b] of cases) {
      const f = fenceFor({ version: "v2", cap: SHOT_READER_MAX_COMPLETION });
      await expect(f.fetch(url, { method: "POST", body: b })).rejects.toThrow("fence");
      expect(f.sent).toBe(0);
      expect(f.effortRefused).toBe(false);
    }
    const v1 = fenceFor({ version: "v1", cap: 400 });
    await expect(v1.fetch(READER_URL, { method: "POST", body: body({ max_completion_tokens: 400 }) })).rejects.toThrow("v1 never sends");
    expect(sent).not.toHaveBeenCalled();
  });

  it("a request that went out with nothing back is -1, so the call is booked at its worst", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("socket hang up"))));
    const f = fenceFor({ version: "v2", cap: SHOT_READER_MAX_COMPLETION });
    await expect(f.fetch(READER_URL, { method: "POST", body: body() })).rejects.toThrow("socket");
    expect(f.sent).toBe(1);
    expect(f.call.status).toBe(-1);
    expect(f.usage).toBeNull();
  });
});

describe("the dry runs (spec §6.4)", () => {
  const loaded = load({ only: null });
  if (!loaded.ok) throw new Error(loaded.problems.join("\n"));
  const l = loaded.l;

  it("the corpus, its three sets and the phrases' aliases agree", () => {
    expect(l.entries).toHaveLength(105);
    expect(new Set(l.entries.map((p) => p.entry.id)).size).toBe(105);
    // corpus.json is the spec's corpus-v2.json, version 3 since Helios Cut 4, step B3: its sets read named, A19 on a named part, X104–X108.
    expect(l.corpus.version).toBe(3);
    expect(l.corpus.defaultForbid).toEqual(["shoot", "set_change", "undo", "who"]);
  });

  it("the perfect reader passes every phrase: expectations, the shot, the cards and the reply's words, in all four languages", () => {
    const run = perfectRun(l);
    expect(run.unsatisfiable).toEqual([]);
    const failing = run.corpus.filter((x) => !x.g.pass || x.g.mentionsMissing.length > 0).map((x) => `${x.p.entry.id}: ${[...x.g.hard, ...x.g.misses, ...x.g.mentionsMissing].join("; ")}`);
    expect(failing).toEqual([]);
    expect(run.corpus).toHaveLength(105);
    expect(new Set(run.corpus.map((x) => x.p.locale))).toEqual(new Set(["en", "es", "pt", "it"]));
  });

  it("reads each set named, as a set the naming pass named, and the old set unnamed (Helios Cut 4, step B3)", () => {
    const race = l.entries.find((p) => p.entry.id === "A19")!;
    const bare = l.entries.find((p) => p.entry.id === "X105")!;
    // The fixture file on disk has no name; the named copy differs from it only by names.
    expect(race.set.bare.objects.some((o) => o.name !== undefined)).toBe(false);
    const nameless = race.spec.objects.map((o) => {
      const copy = { ...o };
      delete copy.name;
      return copy;
    });
    expect(nameless).toEqual(race.set.bare.objects);
    expect(race.parts.map((s) => [s.n, s.name])).toEqual([
      [2, "pit garages"],
      [1, "barriers"],
      [3, "grandstand"],
    ]);
    expect(race.aliases.things).toMatchObject({ s1: "s:barriers", s2: "s:pit garages", s3: "s:grandstand" });
    expect(race.messages[1].content).toContain("THINGS: t1: the car (red sports car), red,");
    expect(race.messages[1].content).toContain("\nPARTS: s2: pit garages, grey, 120 m long, 12 m to their left; s1: barriers,");
    // Unnamed, the grandstand is in neither list, and STAGE has no PARTS line.
    expect(bare.spec).toBe(bare.set.bare);
    expect(bare.parts).toEqual([]);
    expect(bare.messages[1].content).not.toContain("PARTS");
    expect(bare.messages[1].content).toContain("THINGS: t1: the car, red,");
  });

  it("the garbage reader fails every phrase, four ways, with every hard gate it owes", () => {
    const run = garbageRun(l);
    expect(run.rows).toHaveLength(420);
    expect(run.rows.filter((x) => x.g.pass).map((x) => `${x.p.entry.id} ${x.name}`)).toEqual([]);
    expect(run.missing).toEqual([]);
    // Each gate is owed somewhere, so none of them is untested.
    expect([...run.owed.keys()].sort()).toEqual(["dropped", "forbidden-shoot", "forbidden-undo", "forbidden-who", "invented-quote", "lens-stock", "not-json", "shot"]);
    // Where a wrong answer can't shoot — Just talking (A51) — the gate isn't owed, and nothing shoots.
    const talk = run.rows.find((x) => x.p.entry.id === "A51" && x.name === "swap-and-shoot");
    expect(talk?.r.decision.kind).toBe("none");
    expect(talk?.g.hard.some((h) => h.startsWith("shot a "))).toBe(false);
    // In Ask before shooting it shoots a still, and the grader says so.
    const ask = run.rows.find((x) => x.p.entry.id === "A7" && x.name === "swap-and-shoot");
    expect(ask?.r.decision.kind).toBe("still");
    expect(ask?.g.hard).toContain("shot a still where none is expected");
  });
});

describe("the blind phrases' form (spec §7.4 precondition 2)", () => {
  const template = JSON.parse(readFileSync(`${CHECK_DIR}blind-corpus.template.json`, "utf8")) as BlindCorpus & { WRITER: string[] };
  const corpus = loadCorpus();

  it("as it ships, it can't start a live run: no author, no phrases", () => {
    expect(template.phrases).toHaveLength(20);
    expect(blindProblems(template, corpus.fixtures, corpus.blind.required)).toEqual(["the blind phrases have no author", "0 blind phrases are written; 20 are needed"]);
    // Its instructions ask only for things said to a crew: never the reader's rules.
    expect(template.WRITER.join(" ")).not.toMatch(/cant|set_change|who:|JSON key/);
  });

  it("filled by an author, with expectations by someone else, it can", () => {
    const filled = { ...template, author: "A. Writer", expectationsBy: "B. Reader", phrases: template.phrases.map((p, i) => ({ ...p, phrase: `Line ${i + 1}, a bit closer.` })) };
    expect(blindProblems(filled, corpus.fixtures, corpus.blind.required)).toEqual([]);
    expect(blindProblems({ ...filled, expectationsBy: "a. writer" }, corpus.fixtures, corpus.blind.required)).toEqual(["the blind phrases' expectations must be written by someone other than their author"]);
    expect(blindProblems({ ...filled, phrases: filled.phrases.slice(0, 19) }, corpus.fixtures, corpus.blind.required)).toEqual(["19 blind phrases are written; 20 are needed"]);
  });
});
