import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import raceTrack from "./fixtures-race-track.json";
import { setElements } from "./elements";
import { SET_NOT_FOUND, SETS_SESSION_EXPIRED } from "./messages";
import { READER_BUILD_LINE } from "./reader-context";
import { normaliseSetSpec, type SetSpec } from "./set-spec";
import { SHOT_READER_MAX_COMPLETION, SHOT_READER_STATIC } from "./shot-reading";
import { SHOT_READER_FALLBACK_MAX_COMPLETION, SHOT_WORDS_MAX_CHARS, SHOT_WORDS_PER_10_MIN } from "./shot-words";

// Reader v2's server action (Helios Cut 2, step 6, 2026-09-25 — operator:
// "Run, keep going."). words-actions.ts imports through "@/", which this
// suite does not resolve: the session, the database and the limiter are
// stood in for; the Sets modules are the real ones, and the reader's call
// goes to a fake fetch — no network, no paid call.

const USER = "11111111-1111-4111-8111-111111111111";
const SET = "22222222-2222-4222-8222-222222222222";
const EVA = "0b0f7c1e-3a44-4c2a-9d1e-6a1f2b3c4d5e";
const MARCO = "7d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";
const LENA = "2c3d4e5f-6a7b-4c8d-9e0f-a1b2c3d4e5f6";
const STRANGER = "99999999-9999-4999-8999-999999999999";

const n = normaliseSetSpec(raceTrack);
if (!n.ok) throw new Error("fixture");
const SPEC: SetSpec = n.spec;
const CAR = setElements(SPEC).find((e) => e.kind === "car");
if (!CAR) throw new Error("the race set has its car");

type Access = { error: null; userId: string; isAdmin: boolean; plan: string; monthlyLimit: number; periodStart: string | null } | { error: string };
let access: Access;
let limited: boolean;
const limits: { scope: string; windowSeconds: number; max: number }[] = [];
let characterRows: { id: string; name: string; reference_image_urls: string[] | null }[];

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let cols = "";
      const builder = {
        select: (c: string) => ((cols = c), builder),
        eq: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () =>
          cols === "edited_spec" ? { data: { edited_spec: null }, error: null } : { data: { status: "ready", spec: SPEC }, error: null },
        // The character list is awaited on the builder itself.
        then: (resolve: (v: unknown) => void) => resolve({ data: table === "character_profiles" ? characterRows : [], error: null }),
      };
      return builder;
    },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimited: async (_user: string, scope: string, windowSeconds: number, max: number) => {
    limits.push({ scope, windowSeconds, max });
    return limited;
  },
}));
vi.mock("@/lib/sets/access", () => ({
  setsAccess: async () => access,
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
}));
vi.mock("@/lib/sets/data", () => ({ countSetBuildsThisMonth: async () => 0 }));
vi.mock("@/lib/sets/messages", async () => await import("./messages"));
vi.mock("@/lib/sets/set-spec", async () => await import("./set-spec"));
vi.mock("@/lib/sets/shot-words", async () => await import("./shot-words"));
vi.mock("@/lib/sets/shot-reading", async () => await import("./shot-reading"));
vi.mock("@/lib/sets/reader-context", async () => await import("./reader-context"));

import { readShotTurn } from "./words-actions";

type Sent = { model: string; messages: { role: string; content: string }[]; [k: string]: unknown };
let sent: Sent[];
const logged: unknown[][] = [];

/** A fake reader: answers `content` (or the status) and keeps every request body it was sent. */
function reader(content: unknown, opts: { status?: number; body?: string; usage?: Record<string, unknown> } = {}) {
  const fn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as Sent);
    if (opts.status && opts.status !== 200) return new Response(opts.body ?? "no", { status: opts.status });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content }, finish_reason: "stop" }],
        usage: opts.usage ?? { prompt_tokens: 1900, completion_tokens: 42, prompt_tokens_details: { cached_tokens: 1536 }, completion_tokens_details: { reasoning_tokens: 0 } },
      }),
    );
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const NOW = {
  who: MARCO,
  markId: "m1",
  mark: { x: SPEC.marks[0].x, z: SPEC.marks[0].z, facingDeg: 0 },
  pose: "stand",
  gaze: null,
  cameraId: "c2",
  camera: { position: SPEC.cameras[1].position, target: SPEC.cameras[1].target, fovDeg: SPEC.cameras[1].fovDeg },
  frameX: "centre",
  rig: { format: "wide" },
  direction: "She leans on the car and looks back.",
};

beforeEach(() => {
  access = { error: null, userId: USER, isAdmin: true, plan: "starter", monthlyLimit: 5, periodStart: null };
  limited = false;
  limits.length = 0;
  sent = [];
  logged.length = 0;
  characterRows = [
    { id: EVA, name: "Eva", reference_image_urls: ["eva.jpg"] },
    { id: MARCO, name: "Marco", reference_image_urls: ["marco.jpg"] },
    { id: LENA, name: "Lena", reference_image_urls: [] },
  ];
  vi.stubEnv("OPENAI_API_KEY", "sk-test-only");
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push([level, ...args]));
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("readShotTurn: who may read, and when nothing is read", () => {
  it("answers the session's own error, and reads nothing", async () => {
    access = { error: SETS_SESSION_EXPIRED };
    const fetchFn = reader("{}");
    expect(await readShotTurn(SET, { text: "golden hour" })).toEqual({ error: SETS_SESSION_EXPIRED });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('is "off" for an account v2 is not open to yet: no set read, no reading, the page reads with v1', async () => {
    access = { error: null, userId: USER, isAdmin: false, plan: "starter", monthlyLimit: 5, periodStart: null };
    const fetchFn = reader("{}");
    const r = await readShotTurn(SET, { text: "golden hour" });
    expect(r).toEqual({ error: null, reading: null, why: "off", cut: false, dropped: [], aliases: { things: {}, people: {} } });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(limits).toEqual([]);
  });

  it("refuses a set that is not a set id", async () => {
    const fetchFn = reader("{}");
    expect(await readShotTurn("not-a-set", { text: "golden hour" })).toEqual({ error: SET_NOT_FOUND });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('is "empty" for no words, before the limiter or the reader', async () => {
    const fetchFn = reader("{}");
    for (const text of ["", "   ", 42 as unknown as string]) {
      const r = await readShotTurn(SET, { text });
      expect(r).toMatchObject({ error: null, reading: null, why: "empty" });
    }
    expect(fetchFn).not.toHaveBeenCalled();
    expect(limits).toEqual([]);
  });

  it('is "limited" past v1\'s own limit, in the same bucket, and asks nobody', async () => {
    limited = true;
    const fetchFn = reader("{}");
    expect(await readShotTurn(SET, { text: "golden hour" })).toMatchObject({ error: null, reading: null, why: "limited" });
    expect(limits).toEqual([{ scope: "set-words", windowSeconds: 600, max: SHOT_WORDS_PER_10_MIN }]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('is "down", changing nothing, when the reader fails in any way', async () => {
    const cases: (() => unknown)[] = [
      () => reader("{}", { status: 500 }),
      () => reader("{}", { status: 429 }),
      () => reader("not json at all"),
      () => reader(null),
      () => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); })),
    ];
    for (const stub of cases) {
      stub();
      expect(await readShotTurn(SET, { text: "golden hour", now: NOW })).toMatchObject({ error: null, reading: null, why: "down", dropped: [] });
    }
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchFn = reader("{}");
    expect(await readShotTurn(SET, { text: "golden hour" })).toMatchObject({ reading: null, why: "down" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("readShotTurn: what the reader is sent", () => {
  it("sends the fixed instructions first, byte for byte, then the set as it stands, then the words", async () => {
    reader('{"rig":["time:golden"]}');
    await readShotTurn(SET, { text: "  golden hour  ", now: NOW, turns: [{ said: "she leans on the car", did: "near t1 beside; pose lean; happens set" }] });
    expect(sent).toHaveLength(1);
    const [body] = sent;
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0]).toEqual({ role: "system", content: SHOT_READER_STATIC });
    expect(body.messages[1].role).toBe("system");
    const context = body.messages[1].content;
    expect(context).toMatch(/^STAGE\n/);
    expect(context).toContain("Cameras: c1: Circuit establishing; c2: Front three quarter; c3: Low rear wing.");
    expect(context).toContain("Characters: p1: Eva; p2: Marco; p3: Lena (no photo yet).");
    expect(context).toContain("t1: the car, red");
    expect(context).toContain("NOW\nWho: p2 Marco. On m1 Starting grid");
    expect(context).toContain('What happens: "She leans on the car and looks back."');
    expect(context).toContain("LAST TURNS\nYou: she leans on the car -> did: near t1 beside; pose lean; happens set");
    expect(context).not.toContain(READER_BUILD_LINE);
    // The model never sees a character's id or an element key.
    for (const id of [EVA, MARCO, LENA, CAR.key]) expect(JSON.stringify(body.messages)).not.toContain(id);
    expect(body.messages[2]).toEqual({ role: "user", content: "golden hour" });
  });

  it("pins the reading's settings: one sparse JSON object, temperature 0, seed 7, no reasoning, the 600 cap", async () => {
    reader("{}");
    await readShotTurn(SET, { text: "golden hour", now: NOW });
    expect(sent[0]).toMatchObject({
      model: "gpt-5.4-mini",
      max_completion_tokens: SHOT_READER_MAX_COMPLETION,
      temperature: 0,
      seed: 7,
      reasoning_effort: "none",
      response_format: { type: "json_object" },
    });
    expect(SHOT_READER_MAX_COMPLETION).toBe(600);
    // Not sent: the reference could not be read at build time (shot-words.ts askShotReader).
    expect(sent[0]).not.toHaveProperty("prompt_cache_key");
  });

  it("adds the build line only on the Sets home's first message to a set it just built", async () => {
    reader("{}");
    await readShotTurn(SET, { text: "a dusty race track at noon", now: NOW, origin: "build" });
    await readShotTurn(SET, { text: "a dusty race track at noon", now: NOW });
    await readShotTurn(SET, { text: "a dusty race track at noon", now: NOW, origin: "home" as "build" });
    expect(sent[0].messages[1].content.endsWith(`\n${READER_BUILD_LINE}`)).toBe(true);
    expect(sent[1].messages[1].content).not.toContain(READER_BUILD_LINE);
    expect(sent[2].messages[1].content).not.toContain(READER_BUILD_LINE);
  });

  it("checks the page's NOW: a stranger's character, a mark or camera the set doesn't have, are dropped", async () => {
    reader("{}");
    await readShotTurn(SET, { text: "golden hour", now: { ...NOW, who: STRANGER, markId: "m9", cameraId: "c9" } });
    const context = sent[0].messages[1].content;
    expect(context).toContain("Who: no one yet.");
    expect(context).toContain("On a spot of their own");
    expect(context).toContain("Camera: Free camera");
    expect(context).not.toContain(STRANGER);
  });

  it("reads with the set's own first mark and camera when the page sends no NOW at all", async () => {
    reader("{}");
    for (const now of [undefined, "garbage", 7]) await readShotTurn(SET, { text: "golden hour", now });
    expect(sent).toHaveLength(3);
    for (const body of sent) expect(body.messages[1].content).toContain("NOW\nWho: no one yet. On a spot of their own");
  });

  it("reads the first 600 characters of a longer message, and says it was cut", async () => {
    reader("{}");
    const long = `${"golden hour ".repeat(60)}and then some`;
    const r = await readShotTurn(SET, { text: long, now: NOW });
    expect(r).toMatchObject({ why: "ok", cut: true });
    expect(Array.from(sent[0].messages[2].content).length).toBeLessThanOrEqual(SHOT_WORDS_MAX_CHARS);
    const short = await readShotTurn(SET, { text: "golden hour", now: NOW });
    expect(short).toMatchObject({ why: "ok", cut: false });
  });
});

describe("readShotTurn: what comes back", () => {
  it("maps the aliases back to the person's own character and the set's own thing, and hands the aliases to the page", async () => {
    reader(JSON.stringify({ who: "p1", near: { thing: "t1", side: "beside" }, pose: "lean", happens: { add: ["Eva leans on the car"] }, rig: ["time:golden"] }));
    const r = await readShotTurn(SET, { text: "Eva leans on the car, golden hour", now: NOW });
    if (r.error !== null) throw new Error(r.error);
    expect(r.why).toBe("ok");
    expect(r.dropped).toEqual([]);
    expect(r.reading).toEqual({
      characterId: EVA,
      near: { thing: { key: CAR.key }, side: "beside" },
      pose: "lean",
      happens: { keep: [], add: ["Eva leans on the car"] },
      rig: ["time:golden"],
    });
    expect(r.aliases.people).toEqual({ p1: EVA, p2: MARCO, p3: LENA });
    expect(r.aliases.things.t1).toBe(CAR.key);
  });

  it("keeps a piece of what happens only from NOW's own text, as the server checked it", async () => {
    reader(JSON.stringify({ happens: { keep: ["She leans on the car"], add: ["she's smiling"] } }));
    const r = await readShotTurn(SET, { text: "now she's smiling", now: NOW });
    if (r.error !== null) throw new Error(r.error);
    expect(r.reading?.happens).toEqual({ keep: ["She leans on the car"], add: ["she's smiling"] });
  });

  it("names what did not match, never guesses it: an alias the stage never listed, words the person never wrote", async () => {
    reader(JSON.stringify({ who: "p9", set_change: { said: "add a Ferrari" }, rig: ["time:golden"] }));
    const r = await readShotTurn(SET, { text: "golden hour and a red car by the wall", now: NOW });
    if (r.error !== null) throw new Error(r.error);
    expect(r.why).toBe("ok");
    expect(r.reading).toEqual({ rig: ["time:golden"] });
    expect(r.dropped).toEqual(["who", "set_change"]);
  });
});

describe("what a v2 reading logs", () => {
  it("one usage line, counts only, with which effort path ran", async () => {
    reader('{"rig":["time:golden"]}');
    await readShotTurn(SET, { text: "SECRET golden hour", now: { ...NOW, direction: "PRIVATE words" } });
    const usage = logged.filter((l) => l[1] === "[sets] reader usage");
    expect(usage).toEqual([
      ["info", "[sets] reader usage", { model: "gpt-5.4-mini", prompt: 1900, cached: 1536, completion: 42, reasoning: 0, finish: "stop", reader: "v2", effort: "none" }],
    ]);
  });

  it("never logs the message, NOW, the turns, the instructions or the answer — whatever happens", async () => {
    const stubs = [
      () => reader('{"rig":["time:golden"], "idea": "ANSWER-WORDS"}'),
      () => reader("ANSWER-WORDS not json"),
      () => reader("{}", { status: 500, body: "SECRET echoed back" }),
      () => reader("{}", { status: 400, body: "SECRET bad request" }),
    ];
    for (const stub of stubs) {
      stub();
      await readShotTurn(SET, { text: "SECRET golden hour", now: { ...NOW, direction: "PRIVATE words" }, turns: [{ said: "SECRET turn", did: "PRIVATE did" }] });
    }
    const all = JSON.stringify(logged);
    expect(logged.length).toBeGreaterThan(0);
    for (const word of ["SECRET", "PRIVATE", "ANSWER-WORDS", "first assistant director", "STAGE", "Marco"]) expect(all).not.toContain(word);
  });
});

// The last group: once the API refuses reasoning_effort, the module
// remembers it for the life of the server instance — so each test here
// starts from a fresh module.
describe("when the API refuses reasoning_effort", () => {
  const refusal = JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning_effort' is not supported with this model.", param: "reasoning_effort" } });

  beforeEach(() => {
    vi.resetModules();
  });

  it("logs once and tries once more without it, at the higher cap — never uncapped, never a third call", async () => {
    const { askShotReader } = await import("./shot-words");
    let calls = 0;
    const bodies: Record<string, unknown>[] = [];
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      bodies.push(JSON.parse(String(init?.body)));
      if (calls === 1) return new Response(refusal, { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    }) as typeof fetch;
    const messages = [{ role: "system" as const, content: SHOT_READER_STATIC }, { role: "user" as const, content: "golden hour" }];
    const got = await askShotReader(messages, { maxCompletionTokens: SHOT_READER_MAX_COMPLETION, fetchFn });
    expect(got).toMatchObject({ text: "{}", effort: "default" });
    expect(calls).toBe(2);
    expect(bodies[0]).toMatchObject({ reasoning_effort: "none", max_completion_tokens: SHOT_READER_MAX_COMPLETION });
    expect(bodies[1]).not.toHaveProperty("reasoning_effort");
    expect(bodies[1]).toMatchObject({ max_completion_tokens: SHOT_READER_FALLBACK_MAX_COMPLETION, temperature: 0, seed: 7 });
    expect(bodies[1].messages).toEqual(bodies[0].messages);
    expect(SHOT_READER_FALLBACK_MAX_COMPLETION).toBe(1500);
    const warned = logged.filter((l) => l[0] === "warn" && String(l[1]).includes("refused reasoning_effort"));
    expect(warned).toHaveLength(1);
    expect(logged.filter((l) => l[1] === "[sets] reader usage").at(-1)?.[2]).toMatchObject({ reader: "v2", effort: "default" });

    // The next reading skips the parameter at once: one call, no second warning.
    calls = 1;
    bodies.length = 0;
    const again = await askShotReader(messages, { maxCompletionTokens: SHOT_READER_MAX_COMPLETION, fetchFn });
    expect(again).toMatchObject({ effort: "default" });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty("reasoning_effort");
    expect(logged.filter((l) => l[0] === "warn" && String(l[1]).includes("refused reasoning_effort"))).toHaveLength(1);
  });

  it("a 400 that doesn't name it is simply down, with no retry; a retry that fails too is down, with no third call", async () => {
    const { askShotReader } = await import("./shot-words");
    const messages = [{ role: "user" as const, content: "golden hour" }];
    let calls = 0;
    const other = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "Invalid messages" } }), { status: 400 });
    }) as typeof fetch;
    expect(await askShotReader(messages, { maxCompletionTokens: 600, fetchFn: other })).toBeNull();
    expect(calls).toBe(1);

    calls = 0;
    const twice = (async () => {
      calls += 1;
      return new Response(refusal, { status: 400 });
    }) as typeof fetch;
    expect(await askShotReader(messages, { maxCompletionTokens: 600, fetchFn: twice })).toBeNull();
    expect(calls).toBe(2);
  });

  it("through the action, the refused reading still reads", async () => {
    const { readShotTurn: fresh } = await import("./words-actions");
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) return new Response(refusal, { status: 400 });
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"rig":["time:night"]}' }, finish_reason: "stop" }] }));
      }),
    );
    const r = await fresh(SET, { text: "make it night", now: NOW });
    expect(r).toMatchObject({ error: null, why: "ok", reading: { rig: ["time:night"] } });
    expect(calls).toBe(2);
  });
});
