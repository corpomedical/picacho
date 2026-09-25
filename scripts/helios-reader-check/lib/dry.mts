// Loading the check, and its two free runs as data (Helios Cut 2, step 13,
// 2026-09-25 — operator: "Run, keep going."): main.mts prints them, and the
// tests hold them — the perfect reader passes every phrase, and every wrong
// answer fails with every hard gate it owes.
//
// Reads the check's own files (corpus.json, dry-extras.json, prices.json,
// blind-corpus.json when it is written); no key, no network.

import { garbageAnswers, gateName, perfectAnswer, Unsatisfiable, type GateName } from "./answers.mts";
import type { Cli } from "./cli.mts";
import { blindProblems, CHECK_DIR, corpusProblems, loadBlind, loadCorpus, readJson, usedAliases, type Corpus, type CorpusEntry, type FixtureName } from "./corpus.mts";
import { buildSets, checkFixture, prepareEntry, type BuiltSet, type PreparedEntry } from "./fixtures.mts";
import type { Grade } from "./grade.mts";
import type { Prices } from "./money.mts";
import { gradeV2, readV2, type Reading } from "./turn.mts";

export type Loaded = {
  corpus: Corpus;
  sets: Record<FixtureName, BuiltSet>;
  entries: PreparedEntry[];
  /** The blind phrases, prepared, when all 20 are written and sound (never with --only). */
  blind: PreparedEntry[] | null;
  blindWritten: number;
  blindProblems: string[];
  extras: Record<string, Record<string, unknown>>;
  prices: Prices;
  /** Where the built sets differ from the corpus's descriptions, said and not stopped on. */
  notes: string[];
};

/** The corpus, its sets and the phrases to run, with every problem that stops a run before it starts. */
export function load(cli: Pick<Cli, "only">): { ok: true; l: Loaded } | { ok: false; problems: string[] } {
  const corpus = loadCorpus();
  const problems = corpusProblems(corpus);
  const sets = buildSets();
  const notes: string[] = [];
  for (const name of Object.keys(sets) as FixtureName[]) {
    const r = checkFixture(corpus.fixtures[name], sets[name], usedAliases(corpus.phrases.filter((p) => p.set === name)));
    problems.push(...r.problems);
    notes.push(...r.notes);
  }
  let chosen: CorpusEntry[] = corpus.phrases;
  if (cli.only) {
    const unknown = cli.only.filter((id) => !corpus.phrases.some((p) => p.id === id));
    if (unknown.length > 0) problems.push(`--only names phrases the corpus doesn't have: ${unknown.join(", ")}`);
    chosen = corpus.phrases.filter((p) => cli.only?.includes(p.id));
  }
  if (problems.length > 0) return { ok: false, problems };
  const entries = chosen.map((e) => prepareEntry(e, corpus.fixtures[e.set], sets[e.set]));
  const b = loadBlind();
  const bp = b ? blindProblems(b, corpus.fixtures, corpus.blind.required) : [`blind-corpus.json is not written yet (${corpus.blind.required} phrases, from blind-corpus.template.json)`];
  const written = b ? b.phrases.filter((p) => typeof p.phrase === "string" && p.phrase.trim().length > 0) : [];
  const blind = b && bp.length === 0 && !cli.only ? written.map((e) => prepareEntry({ ...e, expected: e.expected ?? {} }, corpus.fixtures[e.set], sets[e.set])) : null;
  const extras = readJson<{ extras: Record<string, Record<string, unknown>> }>(`${CHECK_DIR}dry-extras.json`).extras;
  const prices = readJson<Prices>(`${CHECK_DIR}prices.json`);
  return { ok: true, l: { corpus, sets, entries, blind, blindWritten: written.length, blindProblems: bp, extras, prices, notes } };
}

export type Row = { p: PreparedEntry; g: Grade; r: Reading };

/** The perfect reader on every phrase (and the blind ones, when written); a phrase it can't answer is a corpus error. */
export function perfectRun(l: Loaded): { corpus: Row[]; blind: Row[] | null; unsatisfiable: string[] } {
  const unsatisfiable: string[] = [];
  const run = (p: PreparedEntry): Row | null => {
    try {
      const r = readV2(p, perfectAnswer(p.entry, p.now.direction, l.extras[p.entry.id]));
      return { p, g: gradeV2(p, r, l.corpus.defaultForbid), r };
    } catch (err) {
      if (!(err instanceof Unsatisfiable)) throw err;
      unsatisfiable.push(err.message);
      return null;
    }
  };
  const corpus = l.entries.map(run).filter((x): x is Row => x !== null);
  const blind = l.blind ? l.blind.map(run).filter((x): x is Row => x !== null) : null;
  return { corpus, blind, unsatisfiable };
}

/** Every phrase's four wrong answers, graded; which owed gates fired; the ones that didn't. */
export function garbageRun(l: Loaded): { rows: (Row & { name: string })[]; owed: Map<GateName, { owed: number; fired: number }>; missing: string[] } {
  const rows: (Row & { name: string })[] = [];
  const owed = new Map<GateName, { owed: number; fired: number }>();
  const missing: string[] = [];
  for (const p of l.entries) {
    for (const bad of garbageAnswers(p.entry, l.corpus.fixtures[p.entry.set])) {
      const r = readV2(p, bad.text);
      const g = gradeV2(p, r, l.corpus.defaultForbid);
      rows.push({ p, g, r, name: bad.name });
      const fired = new Set(g.hard.map(gateName));
      for (const gate of bad.gates) {
        const t = owed.get(gate) ?? { owed: 0, fired: 0 };
        t.owed += 1;
        if (fired.has(gate)) t.fired += 1;
        else missing.push(`${p.entry.id} ${bad.name}: ${gate} did not fire`);
        owed.set(gate, t);
      }
    }
  }
  return { rows, owed, missing };
}
