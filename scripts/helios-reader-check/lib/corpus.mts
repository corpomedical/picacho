// The phrase corpus and the blind phrases: their shapes, and the checks a
// corpus must pass before anything reads it (Helios Cut 2, step 13,
// 2026-09-25 — operator: "Run, keep going.").
//
// corpus.json is spec v2's corpus-v2.json (the Appendix), copied here so
// the check and its phrases travel together; version 3 (Helios Cut 4, step
// B3, 2026-09-26) reads its sets named and adds the phrases about parts. Its conventions block says how
// every expectation reads; grade.mts is those conventions as code. A corpus
// that names a key the reader doesn't have, an alias its set doesn't list,
// or a set change its own phrase doesn't contain is refused before a single
// reading is made — a wrong corpus would grade the reader against nothing.
//
// The checks are pure; only loadCorpus and loadBlind read a file.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WIRE_KEYS, PSEUDO_KEYS, CARD_KINDS, type CardKind } from "./grade.mts";

/** scripts/helios-reader-check/ with a trailing slash. */
export const CHECK_DIR = fileURLToPath(new URL("../", import.meta.url));

export const LOCALES = ["en", "es", "pt", "it"] as const;
export type Locale = (typeof LOCALES)[number];
export const MODES = ["talk", "ask", "auto"] as const;
export type Mode = (typeof MODES)[number];
export const SHOOTS = ["none", "still", "take"] as const;
export type ExpectShoot = (typeof SHOOTS)[number];

export type FixtureName = "race" | "showroom" | "garage";
export const FIXTURE_NAMES: readonly FixtureName[] = ["race", "showroom", "garage"];

/** A camera as the corpus describes NOW's: which set camera it is (or none), and where it stands round the figure. */
export type NowCamera = { id: string | null; mm: number; heightM: number; distanceM: number; side: string; tiltDeg: number };

export type FixtureNow = {
  who: string | null;
  mark: string | null;
  near?: { thing: string; side: string };
  facing: string;
  pose: string;
  gaze: null;
  camera: NowCamera;
  frameX: string;
  rig: Record<string, unknown>;
  direction: string;
  mode: Mode;
  /** A take set up from a still, by its number, and who set it up. */
  takeStart: { still: number; armedBy: "chat" | "person" } | null;
  filmOpen: boolean;
};

export type Fixture = {
  cameras: { id: string; label: string }[];
  marks: { id: string; label: string }[];
  characters: { alias: string; name: string; hasPhoto: boolean; hasOutfit: boolean }[];
  /** `name`: the set's own name for the thing, when the fixture names it (fixtures.mts HAND_NAMES). */
  things: { alias: string; label: string; kind: string; colour: string; size: string; where: string; name?: string }[];
  /** The set's named parts (Helios Cut 4, step B3): s1… by their place among the parts, as the reader is told them. */
  parts?: { alias: string; name: string; size?: string; where?: string }[];
  now: FixtureNow;
  stills: { n: number; who: string; format: string; status: string }[];
  edits: { left: number | null; cap: number };
  note?: string;
};

export type EntryContext = {
  now?: Partial<FixtureNow>;
  turns?: { said: string; did: string }[];
  locale?: Locale;
  origin?: "build";
  /** The set as it was before any name: the fixture file itself, as every set saved before the naming pass reads (Helios Cut 4, step B3). */
  unnamed?: true;
};

export type CorpusEntry = {
  id: string;
  set: FixtureName;
  phrase: string;
  expected: Record<string, unknown>;
  forbid?: string[];
  allow?: string[];
  expectShoot?: ExpectShoot;
  expectCards?: CardKind[];
  expectReplyMentions?: string[];
  context?: EntryContext;
  note?: string;
};

export type Corpus = {
  version: number;
  written: string;
  defaultForbid: string[];
  conventions: Record<string, string>;
  fixtures: Record<FixtureName, Fixture>;
  blind: { required: number; file: string };
  phrases: CorpusEntry[];
};

/** The blind phrases (spec §7.4 precondition 2): written by someone who has read none of the rules, graded apart. */
export type BlindCorpus = {
  author: string;
  expectationsBy: string;
  phrases: CorpusEntry[];
};

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** The keys an expectation may name: the reader's own, and the corpus's two derived ones (direction, set_change_gloss). */
const EXPECT_KEYS: ReadonlySet<string> = new Set([...WIRE_KEYS, ...PSEUDO_KEYS]);

/** Every alias an expectation points at, for the check that its set lists them. */
function aliasesIn(v: unknown, out: Set<string>): void {
  if (typeof v === "string" && /^[tps]\d+$/.test(v)) out.add(v);
  else if (Array.isArray(v)) for (const x of v) aliasesIn(x, out);
  else if (isObject(v)) for (const x of Object.values(v)) aliasesIn(x, out);
}

/** Every alias the entries point at, in their expectations and their context. */
export function usedAliases(entries: readonly CorpusEntry[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    aliasesIn(e.expected, out);
    aliasesIn(e.context ?? {}, out);
  }
  return out;
}

/** The expectation objects of an entry: its own, or each alternative of a top-level anyOf. */
export function alternativesOf(expected: Record<string, unknown>): Record<string, unknown>[] {
  const alts = expected.anyOf;
  if (Array.isArray(alts) && Object.keys(expected).length === 1) return alts.filter(isObject);
  return [expected];
}

/**
 * Every problem with one entry, in words; empty when it is sound. `known`
 * is the fixture's character and thing aliases.
 */
export function entryProblems(e: CorpusEntry, fixtures: Record<string, Fixture>): string[] {
  const out: string[] = [];
  const at = `${e.id ?? "(no id)"}`;
  if (typeof e.id !== "string" || !/^[A-Z]+\d+$/.test(e.id)) out.push(`${at}: id must be letters then a number`);
  if (typeof e.phrase !== "string" || e.phrase.trim().length === 0) out.push(`${at}: no phrase`);
  const fx = fixtures[e.set];
  if (!fx) {
    out.push(`${at}: set "${e.set}" is not a fixture`);
    return out;
  }
  if (!isObject(e.expected)) out.push(`${at}: expected must be an object`);
  const alts = isObject(e.expected) ? alternativesOf(e.expected) : [];
  for (const alt of alts) for (const k of Object.keys(alt)) if (!EXPECT_KEYS.has(k)) out.push(`${at}: expected names "${k}", which is not a reader key`);
  for (const k of [...(e.forbid ?? []), ...(e.allow ?? [])]) if (!EXPECT_KEYS.has(k)) out.push(`${at}: forbid/allow names "${k}", which is not a reader key`);
  if (e.expectShoot !== undefined && !(SHOOTS as readonly string[]).includes(e.expectShoot)) out.push(`${at}: expectShoot "${e.expectShoot}"`);
  for (const c of e.expectCards ?? []) if (!(CARD_KINDS as readonly string[]).includes(c)) out.push(`${at}: expectCards "${c}"`);
  if (e.expectReplyMentions !== undefined && !Array.isArray(e.expectReplyMentions)) out.push(`${at}: expectReplyMentions must be a list`);
  const ctx = e.context ?? {};
  if (ctx.locale !== undefined && !(LOCALES as readonly string[]).includes(ctx.locale)) out.push(`${at}: locale "${ctx.locale}"`);
  if (ctx.origin !== undefined && ctx.origin !== "build") out.push(`${at}: origin "${ctx.origin}"`);
  if (ctx.unnamed !== undefined && ctx.unnamed !== true) out.push(`${at}: unnamed must be true when given`);
  for (const k of Object.keys(ctx.now ?? {})) if (!(k in fx.now)) out.push(`${at}: context.now names "${k}", which NOW doesn't have`);
  const mode = ctx.now?.mode ?? fx.now.mode;
  if (!(MODES as readonly string[]).includes(mode)) out.push(`${at}: mode "${mode}"`);
  // A set change is the person's own words, always (spec §2.4): what it must include is in the phrase.
  for (const alt of alts) {
    const sc = alt.set_change;
    if (isObject(sc) && Array.isArray(sc.includes)) {
      for (const w of sc.includes) if (typeof w !== "string" || !e.phrase.toLowerCase().includes(w.toLowerCase())) out.push(`${at}: set_change must include "${String(w)}", which the phrase doesn't say`);
    }
  }
  // An unnamed set has no parts to name: an s-alias there is the corpus's error.
  const known = new Set([...fx.characters.map((c) => c.alias), ...fx.things.map((t) => t.alias), ...(ctx.unnamed ? [] : (fx.parts ?? []).map((s) => s.alias))]);
  const used = new Set<string>();
  for (const alt of alts) aliasesIn(alt, used);
  const nowWho = ctx.now?.who;
  if (typeof nowWho === "string") used.add(nowWho);
  for (const a of used) if (!known.has(a)) out.push(`${at}: names ${a}, which the ${e.set} fixture doesn't list`);
  return out;
}

/** Every problem with a corpus; empty when it is sound. */
export function corpusProblems(c: Corpus): string[] {
  const out: string[] = [];
  if (!isObject(c) || !Array.isArray(c.phrases)) return ["the corpus is not an object with phrases"];
  for (const name of FIXTURE_NAMES) if (!isObject(c.fixtures?.[name])) out.push(`fixture "${name}" is missing`);
  if (!Array.isArray(c.defaultForbid)) out.push("defaultForbid must be a list");
  const ids = new Set<string>();
  for (const e of c.phrases) {
    if (ids.has(e.id)) out.push(`${e.id}: id used twice`);
    ids.add(e.id);
    out.push(...entryProblems(e, c.fixtures));
  }
  return out;
}

/** Problems with the blind phrases, for the live run's precondition (spec §7.4: at least 20, an author, expectations by someone else). */
export function blindProblems(b: BlindCorpus, fixtures: Record<string, Fixture>, required: number): string[] {
  const out: string[] = [];
  if (!isObject(b) || !Array.isArray(b.phrases)) return ["blind-corpus.json is not an object with phrases"];
  if (typeof b.author !== "string" || b.author.trim().length === 0) out.push("the blind phrases have no author");
  // Expectations are added afterwards, from the phrase alone, by someone else (none: the phrases are held to the hard gates only).
  else if (typeof b.expectationsBy === "string" && b.expectationsBy.trim().toLowerCase() === b.author.trim().toLowerCase()) out.push("the blind phrases' expectations must be written by someone other than their author");
  const written = b.phrases.filter((p) => typeof p.phrase === "string" && p.phrase.trim().length > 0);
  if (written.length < required) out.push(`${written.length} blind phrases are written; ${required} are needed`);
  const ids = new Set<string>();
  for (const e of written) {
    if (ids.has(e.id)) out.push(`${e.id}: id used twice`);
    ids.add(e.id);
    out.push(...entryProblems({ ...e, expected: isObject(e.expected) ? e.expected : {} }, fixtures));
  }
  return out;
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function loadCorpus(path = `${CHECK_DIR}corpus.json`): Corpus {
  return readJson<Corpus>(path);
}

/** The blind phrases when they are written, or null. */
export function loadBlind(path = `${CHECK_DIR}blind-corpus.json`): BlindCorpus | null {
  return existsSync(path) ? readJson<BlindCorpus>(path) : null;
}
