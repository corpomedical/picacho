// The grader: one reading of one phrase, held to what the corpus expects
// (Helios Cut 2, step 13, 2026-09-25 — operator: "Run, keep going."). By
// code, never by a model judge (spec §7.4).
//
// WHAT IS GRADED. The reading AS THE PAGE WOULD USE IT: the model's answer
// through parseShotReading, mapped back to the reader's own short names
// (wireOf), so an expectation says "t1", never an element key. Then the
// plan (turn-plan.ts): whether it shoots, and which cards wait for a press.
// Then the reply the person would read, in their language.
//
// HARD GATES — each must be zero across the whole check (spec §7.4):
// - a forbidden key: shoot, set_change, undo and who are forbidden in every
//   phrase unless it expects or allows them, plus the phrase's own forbid
//   list. A `who` equal to NOW's is the same person, not a swap;
// - a plan that shoots where nothing should be shot;
// - lens_mm beside a film stock, when the phrase didn't name a focal length
//   ("35mm film grain" is a stock, never a lens);
// - words the person never wrote: a "not yet" quote, a piece of what
//   happens or a set change that isn't in the message. The parser drops
//   them; every part it had to drop is the model's miss, and is counted;
// - an answer that isn't a JSON object, a "length" finish, a 4xx;
// - a reply with no line at all.
// Reasoning tokens on more than 5% of calls is the run's own gate
// (summarise), since it is about the calls, not a phrase.
//
// Everything else a phrase expects is a MISS, not a gate: the soft bars
// count them (27 of the 29 designed-full audited requests, 85 of 100, 16 of
// 20 blind, every expected reply mention).
//
// Pure: no file, no network, no clock.

import { composeHappens, exactPiece, type ReaderAliases, type ShotAct, type ShotReading } from "../../../src/lib/sets/shot-reading.ts";
import type { ShootDecision, TurnPlan } from "../../../src/lib/sets/turn-plan.ts";
import type { ShotWords } from "../../../src/lib/sets/shot-words.ts";
import type { CorpusEntry } from "./corpus.mts";

/** The keys the reader may write (shot-reading.ts READING_KEYS; a test holds the two lists together). */
export const WIRE_KEYS = [
  "shoot",
  "undo",
  "who",
  "happens",
  "wardrobe",
  "mark",
  "near",
  "nudge",
  "turn",
  "pose",
  "facing",
  "gaze",
  "camera_id",
  "side",
  "size",
  "height",
  "tilt_deg",
  "lens_mm",
  "frame_x",
  "steps",
  "look",
  "rig",
  "hour",
  "ev",
  "move",
  "textures",
  "engine",
  "set_change",
  "ask",
  "idea",
  "suggest",
  "cant",
] as const;
/** The corpus's derived keys: what happens as composed after the turn, and the set change's gloss. */
export const PSEUDO_KEYS = ["direction", "set_change_gloss"] as const;
/** The Needs cards a phrase may expect (turn-plan.ts Need kinds, less the take-format note). */
export const CARD_KINDS = ["astra", "which", "take", "hour"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/**
 * The 29 audited requests the design fully handles, 23 outright and 6 after
 * one press (spec §7.3): the soft bar asks 27 of them to pass.
 */
export const DESIGNED_FULL = [1, 7, 8, 11, 12, 14, 17, 18, 21, 23, 26, 28, 29, 32, 35, 36, 37, 38, 39, 40, 44, 45, 46, 47, 48, 49, 51, 52, 53].map((n) => `A${n}`);

export type Wire = Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const aliasOf = (map: Record<string, string>, id: string): string => Object.keys(map).find((k) => map[k] === id) ?? `?${id}`;

function thingWire(t: { key: string } | { candidates: string[] }, aliases: ReaderAliases): string | { candidates: string[] } {
  return "key" in t ? aliasOf(aliases.things, t.key) : { candidates: t.candidates.map((k) => aliasOf(aliases.things, k)) };
}

/** A reading's act keys under the reader's own names: a suggestion is graded the same way. */
function actWire(a: ShotAct, aliases: ReaderAliases): Wire {
  const w: Wire = {};
  if (a.characterId !== undefined) w.who = aliasOf(aliases.people, a.characterId);
  if (a.markId !== undefined) w.mark = a.markId;
  if (a.near) w.near = { thing: thingWire(a.near.thing, aliases), side: a.near.side };
  if (a.nudge) w.nudge = { ...a.nudge };
  if (a.turn !== undefined) w.turn = a.turn;
  if (a.pose !== undefined) w.pose = a.pose;
  if (a.facing !== undefined) w.facing = typeof a.facing === "string" ? a.facing : { thing: thingWire(a.facing, aliases) };
  if (a.gaze !== undefined) {
    const g = a.gaze;
    w.gaze = typeof g === "string" ? g : "side" in g ? { side: g.side } : { thing: thingWire(g, aliases) };
  }
  if (a.cameraId !== undefined) w.camera_id = a.cameraId;
  if (a.side !== undefined) w.side = a.side;
  if (a.size !== undefined) w.size = a.size;
  if (a.height !== undefined) w.height = a.height;
  if (a.tiltDeg !== undefined) w.tilt_deg = a.tiltDeg;
  if (a.lensMm !== undefined) w.lens_mm = a.lensMm;
  if (a.frameX !== undefined) w.frame_x = a.frameX;
  if (a.steps !== undefined) w.steps = [...a.steps];
  if (a.look !== undefined) w.look = a.look;
  if (a.rig !== undefined) w.rig = [...a.rig];
  if (a.hour !== undefined) w.hour = a.hour;
  if (a.evThirds !== undefined) w.ev = a.evThirds;
  if (a.move !== undefined) w.move = a.move;
  if (a.textures !== undefined) w.textures = [...a.textures];
  if (a.engine !== undefined) w.engine = a.engine;
  return w;
}

/**
 * A parsed reading under the reader's own names, as the corpus writes its
 * expectations: aliases for things and people, snake_case keys, `cant` as
 * its codes, `set_change` as the person's words and `set_change_gloss` as
 * the gloss, and `direction` — what happens after the turn — always set.
 */
export function wireOf(reading: ShotReading, aliases: ReaderAliases, nowDirection: string): Wire {
  const w = actWire(reading, aliases);
  if (reading.shoot) w.shoot = true;
  if (reading.undo) w.undo = true;
  if (reading.happens) w.happens = { keep: [...reading.happens.keep], add: [...reading.happens.add] };
  if (reading.wardrobe) w.wardrobe = true;
  if (reading.setChange) {
    w.set_change = reading.setChange.said;
    if (reading.setChange.gloss !== null) w.set_change_gloss = reading.setChange.gloss;
  }
  if (reading.ask) w.ask = [...reading.ask];
  if (reading.idea !== undefined) w.idea = reading.idea;
  if (reading.suggest) w.suggest = reading.suggest.map((s) => actWire(s, aliases));
  if (reading.cant) w.cant = reading.cant.map((c) => c.code);
  w.direction = composeHappens(reading.happens, nowDirection).text;
  return w;
}

/**
 * v1's reading under the same names, for the before/after table (spec
 * §7.4): the camera words it has, `shoot` for an intent to shoot, and a set
 * change — the whole message, which step 1's card quotes — for an intent to
 * edit. v1 has no key for who, the thing to stand by, pose, eye-line, the
 * third, steps, the look or a "not yet": an expectation on one of those is
 * a miss for v1, as it is on the page.
 */
export function v1WireOf(words: ShotWords, message: string, nowDirection: string): Wire {
  const w: Wire = {};
  if (words.intent === "shoot") w.shoot = true;
  if (words.intent === "edit") w.set_change = message;
  if (words.cameraId !== null) w.camera_id = words.cameraId;
  if (words.side !== null) w.side = words.side;
  if (words.size !== null) w.size = words.size;
  if (words.height !== null) w.height = words.height;
  if (words.tiltDeg !== null) w.tilt_deg = words.tiltDeg;
  if (words.lensMm !== null) w.lens_mm = words.lensMm;
  if (words.markId !== null) w.mark = words.markId;
  if (words.facing !== null) w.facing = words.facing;
  w.direction = words.direction || nowDirection;
  return w;
}

// ---------------------------------------------------------------------------
// The conventions (corpus.json "conventions"), as code.
// ---------------------------------------------------------------------------

const OPERATORS = ["anyOf", "includes", "excludes", "min", "max", "minItems", "candidates"];
const isOperator = (v: unknown): v is Record<string, unknown> => isObject(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => OPERATORS.includes(k));

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => same(a[k], b[k]));
  }
  return a === b;
}

const lower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : null);

/**
 * Whether `actual` meets `expected`: a scalar is equal; a list of strings
 * is all included; {anyOf} equals or includes one; {includes}/{excludes}
 * are case-insensitive substrings (excludes passes when absent); {min,max}
 * a range; {minItems} a length; {candidates} exactly those aliases in any
 * order; any other object is matched key by key.
 */
export function matches(expected: unknown, actual: unknown): boolean {
  if (isOperator(expected)) {
    const e = expected;
    if (Array.isArray(e.anyOf) && !e.anyOf.some((opt) => (Array.isArray(actual) && !Array.isArray(opt) ? actual.some((x) => same(x, opt)) : matches(opt, actual)))) return false;
    if (Array.isArray(e.includes)) {
      const a = lower(actual);
      if (a === null || !e.includes.every((w) => typeof w === "string" && a.includes(w.toLowerCase()))) return false;
    }
    if (Array.isArray(e.excludes)) {
      const a = lower(actual);
      if (a !== null && e.excludes.some((w) => typeof w === "string" && a.includes(w.toLowerCase()))) return false;
      if (actual !== undefined && a === null) return false;
    }
    if (e.min !== undefined || e.max !== undefined) {
      if (typeof actual !== "number") return false;
      if (typeof e.min === "number" && actual < e.min - 1e-9) return false;
      if (typeof e.max === "number" && actual > e.max + 1e-9) return false;
    }
    if (typeof e.minItems === "number" && !(Array.isArray(actual) && actual.length >= e.minItems)) return false;
    if (Array.isArray(e.candidates)) {
      const c = isObject(actual) && Array.isArray(actual.candidates) ? actual.candidates : null;
      if (!c || c.length !== e.candidates.length || !e.candidates.every((x) => c.includes(x))) return false;
    }
    return true;
  }
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.every((x) => actual.some((y) => same(x, y)));
  if (isObject(expected)) return isObject(actual) && Object.keys(expected).every((k) => matches(expected[k], actual[k]));
  return same(expected, actual);
}

/** The keys an expectation object names, a top-level anyOf's alternatives included. */
function expectedKeys(expected: Record<string, unknown>): Set<string> {
  const alts = Array.isArray(expected.anyOf) && Object.keys(expected).length === 1 ? expected.anyOf.filter(isObject) : [expected];
  return new Set(alts.flatMap((a) => Object.keys(a)));
}

/** Which expectation keys a wire misses; empty when it meets the expectation (any one alternative of a top-level anyOf). */
export function fieldMisses(expected: Record<string, unknown>, wire: Wire): string[] {
  const alts = Array.isArray(expected.anyOf) && Object.keys(expected).length === 1 ? expected.anyOf.filter(isObject) : [expected];
  let best: string[] | null = null;
  for (const alt of alts) {
    const missed = Object.keys(alt).filter((k) => !matches(alt[k], wire[k]));
    if (missed.length === 0) return [];
    if (!best || missed.length < best.length) best = missed;
  }
  return alts.length > 1 ? [`none of the ${alts.length} alternatives (closest misses ${(best ?? []).join(", ")})`] : (best ?? []);
}

/** The keys forbidden in this phrase: the default four unless expected or allowed, and its own. */
export function forbiddenKeys(entry: Pick<CorpusEntry, "expected" | "allow" | "forbid">, defaultForbid: readonly string[]): string[] {
  const named = expectedKeys(entry.expected ?? {});
  for (const k of entry.allow ?? []) named.add(k);
  const out = defaultForbid.filter((k) => !named.has(k));
  for (const k of entry.forbid ?? []) if (!out.includes(k)) out.push(k);
  return out;
}

// ---------------------------------------------------------------------------
// One phrase.
// ---------------------------------------------------------------------------

/** What one live call reported, when there was one (the dry runs have none). */
export type CallFacts = {
  /** The HTTP status; -1 when the request went out and nothing came back; null when nothing was sent. */
  status: number | null;
  finish: string | null;
  reasoning: number | null;
};

export type GradeInput = {
  entry: CorpusEntry;
  defaultForbid: readonly string[];
  /** The message as the reader was given it (cleaned, at most 600). */
  message: string;
  /** NOW's who, as an alias, after the phrase's own context. */
  nowWho: string | null;
  /** The model's answer as JSON, or null when it was not an object. */
  raw: Record<string, unknown> | null;
  /** The reading under the reader's names (wireOf, v1WireOf); null when the answer did not parse. */
  wire: Wire | null;
  /** What the parser had to drop (parseShotReading); v1's parser drops without saying, so [] there. */
  dropped: readonly string[];
  /** v2's plan and its shot; null for v1, whose page has neither. */
  plan: { plan: TurnPlan; decision: ShootDecision } | null;
  reply: { text: string; lines: number } | null;
  call?: CallFacts | null;
};

export type Grade = {
  id: string;
  /** No hard gate, every expected field, the shot and the cards as expected. */
  pass: boolean;
  /** Every expected field met (the audited bar's "passes all expected fields"). */
  fields: boolean;
  hard: string[];
  misses: string[];
  /** Expected reply mentions that the reply does not say (their own soft bar). */
  mentionsMissing: string[];
};

const isStock = (id: unknown) => typeof id === "string" && id.startsWith("stock:") && id !== "stock:none";

export function grade(g: GradeInput): Grade {
  const { entry } = g;
  const hard: string[] = [];
  const misses: string[] = [];

  // The call itself.
  if (g.call) {
    if (g.call.status !== null && g.call.status >= 400 && g.call.status < 500) hard.push(`the API answered ${g.call.status}`);
    else if (g.call.status !== null && g.call.status !== 200) hard.push(g.call.status === -1 ? "no answer came back" : `the API answered ${g.call.status}`);
    if (g.call.finish === "length") hard.push('the answer ran out of room (finish "length")');
  }
  if (!g.wire) {
    hard.push("the answer was not a JSON object");
    return { id: entry.id, pass: false, fields: false, hard, misses: ["nothing to grade"], mentionsMissing: [...(entry.expectReplyMentions ?? [])] };
  }
  const wire = g.wire;

  // Forbidden keys; a who equal to NOW's is not a swap.
  for (const k of forbiddenKeys(entry, g.defaultForbid)) {
    if (!(k in wire) || wire[k] === undefined) continue;
    if (k === "who" && wire.who === g.nowWho) continue;
    if (k === "direction") continue;
    hard.push(k === "who" ? `who swapped to ${String(wire.who)} (NOW is ${g.nowWho ?? "no one"})` : `${k} where none is allowed`);
  }
  // A film stock is never a lens.
  if (Array.isArray(wire.rig) && wire.rig.some(isStock) && wire.lens_mm !== undefined && !expectedKeys(entry.expected).has("lens_mm")) hard.push("lens_mm beside a film stock");
  // Words the person never wrote: every part the parser had to drop, and a "not yet" quote it had to blank.
  if (g.dropped.length > 0) hard.push(`parts dropped: ${g.dropped.join(", ")}`);
  const rawCant = g.raw && Array.isArray(g.raw.cant) ? g.raw.cant : [];
  for (const c of rawCant) {
    const said = isObject(c) ? c.said : null;
    if (typeof said === "string" && said.trim().length >= 2 && exactPiece(said, g.message) === null) {
      hard.push("a “not yet” quote the message doesn't have");
      break;
    }
  }

  // The plan: the shot, and the cards.
  const expectShoot = entry.expectShoot ?? "none";
  if (g.plan) {
    const kind = g.plan.decision.kind;
    if (kind !== "none" && expectShoot === "none") hard.push(`shot a ${kind} where none is expected`);
    else if (kind !== expectShoot) misses.push(`shoot: ${kind}, expected ${expectShoot}`);
    if (entry.expectCards !== undefined) {
      const cards = [...new Set(g.plan.plan.needs.map((n) => n.kind).filter((k): k is CardKind => (CARD_KINDS as readonly string[]).includes(k)))].sort();
      const want = [...new Set(entry.expectCards)].sort();
      if (!same(cards, want)) misses.push(`cards: [${cards.join(", ")}], expected [${want.join(", ")}]`);
    }
  }

  // The reply.
  if (g.reply && g.reply.lines === 0) hard.push("a silent reply");
  const said = (g.reply?.text ?? "").toLowerCase();
  const mentionsMissing = g.reply ? (entry.expectReplyMentions ?? []).filter((m) => !said.includes(m.toLowerCase())) : [];

  // The expected fields.
  const missed = fieldMisses(entry.expected ?? {}, wire);
  for (const k of missed) misses.push(`expected ${k}: got ${JSON.stringify(k in wire ? wire[k] : undefined) ?? "nothing"}`);

  return {
    id: entry.id,
    pass: hard.length === 0 && misses.length === 0,
    fields: missed.length === 0,
    hard,
    misses,
    mentionsMissing,
  };
}

// ---------------------------------------------------------------------------
// The whole check: the bars (spec §7.4).
// ---------------------------------------------------------------------------

export type Bars = {
  hardGates: number;
  corpus: { passed: number; of: number; needed: number };
  audited: { passed: number; of: number; needed: number };
  blind: { passed: number; of: number; needed: number } | null;
  mentionsMissing: number;
  /** Calls with reasoning tokens above 0, and the share allowed (5%); null for a dry run. */
  reasoning: { calls: number; of: number; share: number; allowed: number } | null;
  ok: boolean;
};

export function summarise(input: { corpus: readonly Grade[]; blind?: readonly Grade[] | null; calls?: readonly CallFacts[] | null }): Bars {
  const blind = input.blind ?? null;
  const all = [...input.corpus, ...(blind ?? [])];
  const hardGates = all.reduce((n, g) => n + g.hard.length, 0);
  const audited = input.corpus.filter((g) => DESIGNED_FULL.includes(g.id));
  const corpusNeeded = Math.ceil((85 / 100) * input.corpus.length);
  const auditedNeeded = audited.length === DESIGNED_FULL.length ? 27 : Math.max(0, audited.length - 2);
  const bars: Bars = {
    hardGates,
    corpus: { passed: input.corpus.filter((g) => g.pass).length, of: input.corpus.length, needed: corpusNeeded },
    audited: { passed: audited.filter((g) => g.fields && g.hard.length === 0).length, of: audited.length, needed: auditedNeeded },
    blind: blind ? { passed: blind.filter((g) => g.pass).length, of: blind.length, needed: Math.ceil((16 / 20) * blind.length) } : null,
    mentionsMissing: all.reduce((n, g) => n + g.mentionsMissing.length, 0),
    reasoning: null,
    ok: false,
  };
  if (input.calls && input.calls.length > 0) {
    const withReasoning = input.calls.filter((c) => (c.reasoning ?? 0) > 0).length;
    bars.reasoning = { calls: withReasoning, of: input.calls.length, share: withReasoning / input.calls.length, allowed: 0.05 };
  }
  bars.ok =
    bars.hardGates === 0 &&
    bars.corpus.passed >= bars.corpus.needed &&
    bars.audited.passed >= bars.audited.needed &&
    (bars.blind === null || bars.blind.passed >= bars.blind.needed) &&
    bars.mentionsMissing === 0 &&
    (bars.reasoning === null || bars.reasoning.share <= bars.reasoning.allowed);
  return bars;
}
