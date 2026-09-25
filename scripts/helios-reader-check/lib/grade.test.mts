import { describe, expect, it } from "vitest";
import { parseShotReading, SHOT_READER_STATIC, type ShotReading } from "../../../src/lib/sets/shot-reading.ts";
import type { ShootDecision, TurnPlan } from "../../../src/lib/sets/turn-plan.ts";
import type { CorpusEntry } from "./corpus.mts";
import { DESIGNED_FULL, fieldMisses, forbiddenKeys, grade, matches, summarise, v1WireOf, WIRE_KEYS, wireOf, type GradeInput, type Wire } from "./grade.mts";

// The phrase check's grader (Helios Cut 2, step 13, 2026-09-25 — operator:
// "Run, keep going."; spec §7.4 conventions): graded by code, never by a
// model. These hand-made readings hold each convention and each hard gate.

const DEFAULT_FORBID = ["shoot", "set_change", "undo", "who"];
const ALIASES = { things: { t1: "c_car1", t2: "c_car2" }, people: { p1: "eva-id", p2: "marco-id" } };

const entry = (over: Partial<CorpusEntry> = {}): CorpusEntry => ({ id: "T1", set: "race", phrase: "She leans on the car.", expected: {}, expectShoot: "none", ...over });
const plan = (needs: TurnPlan["needs"] = []): TurnPlan => ({ needs }) as unknown as TurnPlan;
const decided = (kind: ShootDecision["kind"] = "none"): ShootDecision => ({ kind, held: [], offer: null });

/** A reading graded the way the check grades it. */
function graded(reading: ShotReading, over: Partial<GradeInput> & { now?: string } = {}) {
  const wire: Wire = wireOf(reading, ALIASES, over.now ?? "");
  return grade({
    entry: entry(),
    defaultForbid: DEFAULT_FORBID,
    message: over.message ?? over.entry?.phrase ?? "She leans on the car.",
    nowWho: "p2",
    raw: null,
    wire,
    dropped: [],
    plan: { plan: plan(), decision: decided() },
    reply: { text: "Done: Pose · Leaning.", lines: 1 },
    ...over,
  });
}

describe("the conventions, as code", () => {
  it("a scalar is equal; a list is all included; any other object is matched key by key", () => {
    expect(matches("close_up", "close_up")).toBe(true);
    expect(matches("close_up", "wide")).toBe(false);
    expect(matches(24, 24)).toBe(true);
    expect(matches(["time:night"], ["time:night", "height:low"])).toBe(true);
    expect(matches(["time:night", "palette:silver-print"], ["time:night"])).toBe(false);
    expect(matches({ thing: "t1" }, { thing: "t1", side: "beside" })).toBe(true);
    expect(matches({ right: -2 }, { right: -2, toward: 0 })).toBe(true);
    expect(matches({ right: -2 }, { right: 2, toward: 0 })).toBe(false);
  });

  it("anyOf equals or includes one; includes and excludes ignore case, and excludes passes when absent", () => {
    expect(matches({ anyOf: ["back_left", "back_right"] }, "back_right")).toBe(true);
    expect(matches({ anyOf: ["back_left", "back_right"] }, "back")).toBe(false);
    expect(matches({ anyOf: ["film_beats", "mover"] }, ["mover"])).toBe(true);
    expect(matches({ includes: ["Lean", "smil"] }, "She leans on the car. Now she's smiling.")).toBe(true);
    expect(matches({ includes: ["lean"] }, undefined)).toBe(false);
    expect(matches({ excludes: ["bonnet"] }, undefined)).toBe(true);
    expect(matches({ excludes: ["Bonnet"] }, "She sits on the bonnet.")).toBe(false);
  });

  it("a range, a length, and candidates as exactly those aliases in any order", () => {
    expect(matches({ min: 1, max: 6 }, 3)).toBe(true);
    expect(matches({ min: 1, max: 6 }, 9)).toBe(false);
    expect(matches({ max: -1 }, -3)).toBe(true);
    expect(matches({ minItems: 1 }, [{ size: "wide" }])).toBe(true);
    expect(matches({ minItems: 1 }, undefined)).toBe(false);
    expect(matches({ thing: { candidates: ["t1", "t2"] } }, { thing: { candidates: ["t2", "t1"] }, side: "beside" })).toBe(true);
    expect(matches({ thing: { candidates: ["t1", "t2"] } }, { thing: "t1" })).toBe(false);
    expect(matches({ thing: { candidates: ["t1", "t2"] } }, { thing: { candidates: ["t1", "t2", "t3"] } })).toBe(false);
  });

  it("a top-level anyOf passes on any one alternative", () => {
    const expected = { anyOf: [{ rig: { anyOf: ["time:night", "light:moonlight"] } }, { ev: { max: -1 } }] };
    expect(fieldMisses(expected, { ev: -3, direction: "" })).toEqual([]);
    expect(fieldMisses(expected, { rig: ["light:moonlight"], direction: "" })).toEqual([]);
    expect(fieldMisses(expected, { rig: ["time:golden"], direction: "" })).toHaveLength(1);
  });
});

describe("the default forbids (spec §7.4, critic item 8)", () => {
  it("shoot, set_change, undo and who are forbidden unless the phrase expects or allows them", () => {
    expect(forbiddenKeys({ expected: {} }, DEFAULT_FORBID)).toEqual(DEFAULT_FORBID);
    expect(forbiddenKeys({ expected: { shoot: true } }, DEFAULT_FORBID)).toEqual(["set_change", "undo", "who"]);
    expect(forbiddenKeys({ expected: {}, allow: ["who", "set_change"] }, DEFAULT_FORBID)).toEqual(["shoot", "undo"]);
    expect(forbiddenKeys({ expected: {}, forbid: ["lens_mm"] }, DEFAULT_FORBID)).toEqual([...DEFAULT_FORBID, "lens_mm"]);
    // An alternative of a top-level anyOf names its keys too.
    expect(forbiddenKeys({ expected: { anyOf: [{ undo: true }, { rig: ["time:night"] }] } }, DEFAULT_FORBID)).toEqual(["shoot", "set_change", "who"]);
  });

  it("each forbidden key present is a hard gate", () => {
    expect(graded({ shoot: true }).hard).toEqual(["shoot where none is allowed"]);
    expect(graded({ undo: true }).hard).toEqual(["undo where none is allowed"]);
    expect(graded({ setChange: { said: "leans", gloss: null, cut: false } }).hard).toEqual(["set_change where none is allowed"]);
    expect(graded({ lensMm: 35 }, { entry: entry({ forbid: ["lens_mm"] }) }).hard).toEqual(["lens_mm where none is allowed"]);
    expect(graded({ shoot: true }, { entry: entry({ expected: { shoot: true }, expectShoot: "still" }) }).hard).toEqual([]);
  });

  it("the same-who rule: a who equal to NOW's is the same person, not a swap", () => {
    expect(graded({ characterId: "marco-id" }).hard).toEqual([]);
    expect(graded({ characterId: "eva-id" }).hard).toEqual(["who swapped to p1 (NOW is p2)"]);
    // Expected, it is compared as written — and the same person meets it.
    const keep = graded({ characterId: "marco-id" }, { entry: entry({ expected: { who: "p2" } }) });
    expect(keep.fields).toBe(true);
    expect(graded({ characterId: "eva-id" }, { entry: entry({ expected: { who: "p1" } }) }).hard).toEqual([]);
  });
});

describe("the reading under the reader's names", () => {
  it("maps things and people back to aliases, candidates included", () => {
    const w = wireOf({ characterId: "eva-id", near: { thing: { key: "c_car1" }, side: "beside" }, gaze: { candidates: ["c_car1", "c_car2"] }, facing: "camera" }, ALIASES, "");
    expect(w.who).toBe("p1");
    expect(w.near).toEqual({ thing: "t1", side: "beside" });
    expect(w.gaze).toEqual({ thing: { candidates: ["t1", "t2"] } });
    expect(w.facing).toBe("camera");
  });

  it("the composed direction: NOW's pieces kept, the message's added, as the page composes them", () => {
    const now = "She leans on the car.";
    const w = wireOf({ happens: { keep: ["She leans on the car"], add: ["Now she's smiling"] } }, ALIASES, now);
    expect(w.direction).toBe("She leans on the car. Now she's smiling.");
    expect(matches({ includes: ["lean", "smil"] }, w.direction)).toBe(true);
    // Nothing said about what happens: NOW's stays.
    expect(wireOf({ pose: "sit" }, ALIASES, now).direction).toBe(now);
    // {} clears it.
    expect(wireOf({ happens: { keep: [], add: [] } }, ALIASES, now).direction).toBe("");
  });

  it("cant is its codes, a set change its words, and its gloss apart", () => {
    const w = wireOf({ cant: [{ code: "brand", said: "Ferrari" }], setChange: { said: "Put a red Ferrari by the pit wall", gloss: "a red sports car", cut: false } }, ALIASES, "");
    expect(w.cant).toEqual(["brand"]);
    expect(w.set_change).toBe("Put a red Ferrari by the pit wall");
    expect(w.set_change_gloss).toBe("a red sports car");
    expect(matches({ excludes: ["Ferrari"] }, w.set_change_gloss)).toBe(true);
  });

  it("names every key the parser knows, and the parser knows every key it names", () => {
    const ctx = { spec: { cameras: [], marks: [] }, aliases: ALIASES, message: "x", nowHappens: "" };
    for (const k of WIRE_KEYS) {
      // A value no key accepts: the key is known, so it is dropped by its own name, never as "unknown".
      const parsed = parseShotReading(JSON.stringify({ [k]: { nonsense: 12345 } }), ctx);
      expect(parsed?.dropped, k).not.toContain("unknown");
      // …and the instructions teach it ("move, textures: …" names two at once).
      expect(SHOT_READER_STATIC.includes(`${k}:`) || SHOT_READER_STATIC.includes(`${k}, `), k).toBe(true);
    }
    expect(parseShotReading(JSON.stringify({ lens: 35 }), ctx)?.dropped).toEqual(["unknown"]);
  });

  it("v1's fields under the same names: an edit intent is the whole message as a set change", () => {
    const w = v1WireOf({ intent: "edit", direction: "", place: null, cameraId: "c1", side: null, size: null, height: "low", tiltDeg: null, lensMm: 85, markId: null, facing: null }, "Remove the barriers.", "");
    expect(w).toEqual({ set_change: "Remove the barriers.", camera_id: "c1", height: "low", lens_mm: 85, direction: "" });
  });
});

describe("the plan: expectShoot and expectCards", () => {
  it("a shot where none is expected is a hard gate; any other difference a miss", () => {
    expect(graded({ steps: ["closer"] }, { plan: { plan: plan(), decision: decided("still") } }).hard).toEqual(["shot a still where none is expected"]);
    expect(graded({ steps: ["closer"] }, { plan: { plan: plan(), decision: decided("take") } }).hard).toEqual(["shot a take where none is expected"]);
    const want = graded({ steps: ["closer"] }, { entry: entry({ expectShoot: "still" }) });
    expect(want.hard).toEqual([]);
    expect(want.misses).toEqual(["shoot: none, expected still"]);
    expect(graded({ shoot: true }, { entry: entry({ expected: { shoot: true }, expectShoot: "still" }), plan: { plan: plan(), decision: decided("still") } }).pass).toBe(true);
  });

  it("expectCards is exactly those cards, in any order; absent, cards aren't checked", () => {
    const needs = [
      { kind: "astra", said: "x", gloss: null, seal: null, cut: false, card: "ask", canGo: true },
      { kind: "which", slot: "near", candidates: ["c_car1", "c_car2"] },
    ] as TurnPlan["needs"];
    expect(graded({}, { entry: entry({ expectCards: ["which", "astra"] }), plan: { plan: plan(needs), decision: decided() } }).misses).toEqual([]);
    expect(graded({}, { entry: entry({ expectCards: ["astra"] }), plan: { plan: plan(needs), decision: decided() } }).misses).toEqual(["cards: [astra, which], expected [astra]"]);
    expect(graded({}, { entry: entry({ expectCards: [] }), plan: { plan: plan(needs), decision: decided() } }).misses).toHaveLength(1);
    expect(graded({}, { plan: { plan: plan(needs), decision: decided() } }).misses).toEqual([]);
    // The take-format note is not a card.
    expect(graded({}, { entry: entry({ expectCards: [] }), plan: { plan: plan([{ kind: "takeFormat", still: { id: "g-1", n: 1 }, stillFormat: "wide", format: "vertical" }]), decision: decided() } }).misses).toEqual([]);
  });
});

describe("the other hard gates", () => {
  it("lens_mm beside a film stock, unless the phrase named a focal length", () => {
    expect(graded({ rig: ["stock:film35"], lensMm: 35 }).hard).toEqual(["lens_mm beside a film stock"]);
    expect(graded({ rig: ["stock:none"], lensMm: 35 }).hard).toEqual([]);
    expect(graded({ rig: ["stock:film35"], lensMm: 35 }, { entry: entry({ expected: { lens_mm: 35 } }) }).hard).toEqual([]);
  });

  it("every part the parser dropped, and a “not yet” quote the message doesn't have", () => {
    expect(graded({}, { dropped: ["set_change", "happens.add"] }).hard).toEqual(["parts dropped: set_change, happens.add"]);
    expect(graded({}, { raw: { cant: [{ code: "weather", said: "a storm nobody asked for" }] } }).hard).toEqual(["a “not yet” quote the message doesn't have"]);
    // Their own words, in other capitals and quotes, are theirs.
    expect(graded({}, { raw: { cant: [{ code: "raise_figure", said: "she SITS on the bonnet" }] }, message: "She sits on the bonnet." }).hard).toEqual([]);
  });

  it("an answer that isn't an object, a length finish, a 4xx, a silent reply", () => {
    expect(graded({}, { wire: null }).hard).toEqual(["the answer was not a JSON object"]);
    expect(graded({}, { call: { status: 200, finish: "length", reasoning: 0 } }).hard).toEqual(['the answer ran out of room (finish "length")']);
    expect(graded({}, { call: { status: 400, finish: null, reasoning: null } }).hard).toEqual(["the API answered 400"]);
    expect(graded({}, { call: { status: -1, finish: null, reasoning: null } }).hard).toEqual(["no answer came back"]);
    expect(graded({}, { reply: { text: "", lines: 0 } }).hard).toEqual(["a silent reply"]);
  });

  it("expected reply mentions are their own bar, case-insensitive", () => {
    const g = graded({}, { entry: entry({ expectReplyMentions: ["leaning", "Undo"] }) });
    expect(g.mentionsMissing).toEqual(["Undo"]);
    expect(g.pass).toBe(true);
  });
});

describe("the bars (spec §7.4)", () => {
  const ok = (id: string) => ({ id, pass: true, fields: true, hard: [], misses: [], mentionsMissing: [] });
  const miss = (id: string) => ({ ...ok(id), pass: false, fields: false, misses: ["expected size"] });

  it("85 of 100, 27 of the 29 designed-full, 16 of 20 blind, no mention missing, no hard gate", () => {
    const corpus = Array.from({ length: 100 }, (_, i) => (i < 53 ? `A${i + 1}` : `X${i + 1}`)).map(ok);
    expect(DESIGNED_FULL).toHaveLength(29);
    expect(summarise({ corpus }).ok).toBe(true);
    const twoAudited = corpus.map((g) => (g.id === "A1" || g.id === "A7" ? miss(g.id) : g));
    expect(summarise({ corpus: twoAudited }).audited).toEqual({ passed: 27, of: 29, needed: 27 });
    expect(summarise({ corpus: twoAudited }).ok).toBe(true);
    const threeAudited = twoAudited.map((g) => (g.id === "A8" ? miss(g.id) : g));
    expect(summarise({ corpus: threeAudited }).ok).toBe(false);
    const sixteen = corpus.map((g, i) => (i >= 84 && !DESIGNED_FULL.includes(g.id) ? miss(g.id) : g));
    expect(summarise({ corpus: sixteen }).corpus.passed).toBe(84);
    expect(summarise({ corpus: sixteen }).ok).toBe(false);
    expect(summarise({ corpus, blind: Array.from({ length: 20 }, (_, i) => (i < 5 ? miss(`B${i}`) : ok(`B${i}`))) }).ok).toBe(false);
    expect(summarise({ corpus: corpus.map((g, i) => (i === 60 ? { ...g, hard: ["shoot where none is allowed"] } : g)) }).ok).toBe(false);
    expect(summarise({ corpus: corpus.map((g, i) => (i === 60 ? { ...g, mentionsMissing: ["Undo"] } : g)) }).ok).toBe(false);
  });

  it("reasoning tokens on more than 5% of calls fail the run", () => {
    const corpus = Array.from({ length: 100 }, (_, i) => ({ id: `X${i}`, pass: true, fields: true, hard: [], misses: [], mentionsMissing: [] }));
    const calls = (n: number) => Array.from({ length: 100 }, (_, i) => ({ status: 200, finish: "stop", reasoning: i < n ? 12 : 0 }));
    expect(summarise({ corpus, calls: calls(5) }).ok).toBe(true);
    expect(summarise({ corpus, calls: calls(6) }).ok).toBe(false);
  });
});
