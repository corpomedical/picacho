// The reader check's three runs (Helios Cut 2, step 13, 2026-09-25 —
// operator: "Run, keep going."; spec §6.4 and §7.4):
//
// - DRY (the default): the perfect reader on every phrase, through the
//   page's own parse, plan and reply in the phrase's language, graded. It
//   proves the corpus, the fixtures, the grader and every reply string
//   agree — never how the model reads. Then the plan a live run would make
//   and its ceiling. Free; ends "network: 0 live calls, 0 blocked".
// - GARBAGE (--dry-garbage): four fixed wrong answers per phrase; every
//   hard gate each one owes must fire, and none may pass. Free.
// - LIVE (--live --max-usd n): check A. The real reader on the 100 phrases
//   and the 20 blind ones (v2), then v1 on the 53 audited ones for the
//   before/after table; one call at a time, each reserved at its worst and
//   settled from its usage, stopping before any call that could pass n.
//   The owner runs it, from the main checkout (spec §7.4).
//
// Every line printed also goes to the run's report.txt (live runs keep an
// out/<stamp>/ folder: the ledger, each answer, the report).

import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { Ledger } from "../../astra-sets-eval/lib/ledger.mts";
import { SpendGuard } from "../../astra-sets-eval/lib/spend-guard.mts";
import { nearestRank, median } from "../../astra-sets-eval/lib/stats.mts";
import { stamp } from "../../astra-sets-eval/lib/util.mts";
import type { NetGuard } from "../../astra-sets-eval/lib/net-guard.mts";
import { SHOT_READER_MAX_COMPLETION } from "../../../src/lib/sets/shot-reading.ts";
import { askShotReader, askShotWords, shotWordsInstructions, SHOT_WORDS_MODEL, type ReaderUsage } from "../../../src/lib/sets/shot-words.ts";
import type { Cli } from "./cli.mts";
import { CHECK_DIR } from "./corpus.mts";
import { garbageRun, load, perfectRun, type Loaded } from "./dry.mts";
import type { PreparedEntry } from "./fixtures.mts";
import { DESIGNED_FULL, summarise, type Bars, type CallFacts, type Grade } from "./grade.mts";
import { actualUsd, charsOf, priceProblems, typicalUsd, usd, V1_MAX_COMPLETION, worstUsd, type Prices } from "./money.mts";
import { fenceFor } from "./fence.mts";
import { gradeV1, gradeV2, readV2, type Reading } from "./turn.mts";

export type MainInput = { cli: Cli; net: NetGuard; key?: "shell" | "file" | "absent" };

const lines: string[] = [];
function say(s = ""): void {
  lines.push(s);
  process.stdout.write(`${s}\n`);
}
const networkLine = (net: NetGuard) => `network: ${net.liveCalls} live calls, ${net.blocked.length} blocked`;

// ---------------------------------------------------------------------------
// The plan and its ceiling (spec §7.4 "What it runs").
// ---------------------------------------------------------------------------

type Planned = { p: PreparedEntry; version: "v2" | "v1"; blind: boolean; worst: number; typical: number; messages: { role: "system" | "user"; content: string }[] };

function v1Messages(p: PreparedEntry): { role: "system" | "user"; content: string }[] {
  const instructions = shotWordsInstructions({ spec: p.spec, characters: p.characters.map((c) => c.name), askPlace: false });
  return [
    { role: "system", content: instructions },
    { role: "user", content: p.message },
  ];
}

function planCalls(l: Loaded, cli: Cli): Planned[] {
  const v2 = (blind: boolean) => (p: PreparedEntry): Planned => {
    const c = charsOf(p.messages);
    return { p, version: "v2", blind, worst: worstUsd(c, SHOT_READER_MAX_COMPLETION, l.prices), typical: typicalUsd(c, l.prices), messages: p.messages };
  };
  const v1 = (p: PreparedEntry): Planned => {
    const m = v1Messages(p);
    const c = charsOf(m);
    return { p, version: "v1", blind: false, worst: worstUsd(c, V1_MAX_COMPLETION, l.prices), typical: typicalUsd(c, l.prices), messages: m };
  };
  const audited = l.entries.filter((p) => /^A\d+$/.test(p.entry.id));
  return [...l.entries.map(v2(false)), ...(l.blind ?? []).map(v2(true)), ...(cli.v1 ? audited.map(v1) : [])];
}

function printPlan(l: Loaded, calls: Planned[], cli: Cli): number {
  const p = l.prices;
  say("THE PLAN (what a live run makes; a dry run makes none of it)");
  say(`  model ${SHOT_WORDS_MODEL} at $${p.inputPer1M} in / $${p.cachedInputPer1M} cached / $${p.outputPer1M} out per 1M tokens, read ${p.read} (${p.source})`);
  say(`  worst per call = ceil(characters ÷ 2.5) input tokens, none cached, + the whole answer cap (v2 ${SHOT_READER_MAX_COMPLETION}, v1 ${V1_MAX_COMPLETION}; hidden reasoning counts against it)`);
  const group = (label: string, xs: Planned[]) => {
    if (xs.length === 0) return 0;
    const worsts = xs.map((x) => x.worst);
    const sum = worsts.reduce((a, b) => a + b, 0);
    const typ = xs.reduce((a, x) => a + x.typical, 0);
    say(`  ${label}: ${xs.length} calls, worst ${usd(Math.min(...worsts))}–${usd(Math.max(...worsts))} each, ${usd(sum)} at worst, ≈${usd(typ)} typical`);
    return sum;
  };
  let ceiling = group("v2, the corpus", calls.filter((c) => c.version === "v2" && !c.blind));
  const blind = calls.filter((c) => c.version === "v2" && c.blind);
  if (blind.length > 0) ceiling += group("v2, the blind phrases", blind);
  else if (!cli.only) {
    const worst = Math.max(...calls.filter((c) => c.version === "v2").map((c) => c.worst), 0);
    const n = l.corpus.blind.required;
    say(`  v2, the blind phrases: ${n} calls, not written yet (${l.blindWritten} of ${n}); at the corpus's worst ${usd(worst)} each, ${usd(n * worst)}`);
    ceiling += n * worst;
  }
  ceiling += group("v1, the audited phrases (the before/after table)", calls.filter((c) => c.version === "v1"));
  say(`  ceiling, every call at its worst: ${usd(ceiling)}${cli.maxUsd !== null ? `; --max-usd ${usd(cli.maxUsd, 2)}` : ""}`);
  if (cli.maxUsd !== null && ceiling > cli.maxUsd) say(`  the ceiling is above --max-usd: the run stops early only if calls cost near their worst (≈${usd(calls.reduce((a, c) => a + c.typical, 0))} typical in all)`);
  say(`  typical is an estimate (4 characters a token in, nothing cached, 90 tokens out): check A measures the real one (spec §2.1).`);
  say(`  one call at a time; each is reserved at its worst before it is sent, settled from the usage it reports, and the run stops before any call whose worst would pass --max-usd.`);
  return ceiling;
}

// ---------------------------------------------------------------------------
// Printing a phrase.
// ---------------------------------------------------------------------------

function wireText(r: Reading): string {
  if (!r.wire) return "(no reading)";
  const w = { ...r.wire };
  delete w.direction;
  return JSON.stringify(w);
}

function printPhrase(p: PreparedEntry, g: Grade, r: Reading | null, extra = ""): void {
  const e = p.entry;
  say(`${g.pass && g.mentionsMissing.length === 0 ? "PASS" : "FAIL"} ${e.id} [${e.set}, ${p.locale}, ${p.state.mode}${e.context?.origin ? ", from build" : ""}] “${e.phrase.length > 90 ? `${e.phrase.slice(0, 87)}…` : e.phrase}”${extra}`);
  if (r) {
    say(`     reading: ${wireText(r)}`);
    if (r.wire && r.wire.direction !== p.now.direction) say(`     what happens: “${String(r.wire.direction)}”`);
    const cards = r.plan.needs.map((n) => n.kind);
    say(`     plan: ${r.plan.kind}${r.plan.steps.length ? ` (${r.plan.steps.map((s) => s.kind).join(", ")})` : ""} · shot: ${r.decision.kind}${r.decision.held.length ? ` (held: ${r.decision.held.join(", ")})` : ""} · cards: ${cards.length ? cards.join(", ") : "none"}`);
    say(`     reply: ${r.replyText.replace(/\n/g, " / ")}`);
  }
  for (const h of g.hard) say(`     HARD: ${h}`);
  for (const m of g.misses) say(`     missed: ${m}`);
  if (g.mentionsMissing.length) say(`     the reply doesn't say: ${g.mentionsMissing.map((m) => `“${m}”`).join(", ")}`);
}

function printBars(b: Bars, live: boolean): void {
  say("THE BARS (spec §7.4)");
  say(`  hard gates: ${b.hardGates} (must be 0)`);
  say(`  corpus phrases passing: ${b.corpus.passed} of ${b.corpus.of} (needs ${b.corpus.needed})`);
  say(`  designed-full audited requests passing every expected field: ${b.audited.passed} of ${b.audited.of} (needs ${b.audited.needed})`);
  say(b.blind ? `  blind phrases passing: ${b.blind.passed} of ${b.blind.of} (needs ${b.blind.needed}), reported apart` : "  blind phrases: none graded in this run");
  say(`  expected reply mentions missing: ${b.mentionsMissing} (must be 0)`);
  if (b.reasoning) say(`  calls with reasoning tokens: ${b.reasoning.calls} of ${b.reasoning.of} (${(b.reasoning.share * 100).toFixed(1)}%; above 5% means "none" is not honoured: stop and decide before opening)`);
  else if (live) say("  calls with reasoning tokens: no usage came back");
  say(`  ${b.ok ? "ALL BARS MET" : "NOT MET"}`);
}

// ---------------------------------------------------------------------------
// The dry runs.
// ---------------------------------------------------------------------------

function dryPerfect(l: Loaded, cli: Cli): number {
  say(`DRY RUN — the perfect reader: each phrase's answer is built from its own expected block, then parsed, planned and composed in its language, and graded. It tests the corpus, the fixtures, the grader and the reply strings; only check A tests the model.`);
  say("");
  const run = perfectRun(l);
  for (const u of run.unsatisfiable) say(`CORPUS ERROR ${u}`);
  for (const x of [...run.corpus, ...(run.blind ?? [])]) if (cli.verbose || !x.g.pass || x.g.mentionsMissing.length > 0) printPhrase(x.p, x.g, x.r);
  const passed = run.corpus.filter((x) => x.g.pass && x.g.mentionsMissing.length === 0).length;
  say(`perfect reader: ${passed} of ${l.entries.length} phrases pass every expectation, the shot, the cards and the reply mentions${run.unsatisfiable.length ? `; ${run.unsatisfiable.length} could not be answered` : ""}`);
  say("");
  printBars(summarise({ corpus: run.corpus.map((x) => x.g), blind: run.blind ? run.blind.map((x) => x.g) : null }), false);
  return passed === l.entries.length && run.unsatisfiable.length === 0 ? 0 : 1;
}

function dryGarbage(l: Loaded, cli: Cli): number {
  say(`DRY RUN — the garbage reader: four fixed wrong answers per phrase (a person swap with a shot, words the person never wrote, a film stock as a lens with an undo, and prose instead of JSON). Every hard gate an answer owes must fire, and no wrong answer may pass.`);
  say("");
  const run = garbageRun(l);
  for (const x of run.rows) {
    if (x.g.pass) printPhrase(x.p, x.g, x.r, ` — the "${x.name}" answer PASSED`);
    else if (cli.verbose) printPhrase(x.p, x.g, x.r, ` — "${x.name}"`);
  }
  for (const m of run.missing) say(`MISSED ${m}`);
  const passed = run.rows.filter((x) => x.g.pass).length;
  say(`garbage reader: ${run.rows.length} wrong answers, ${run.rows.length - passed} failed${passed ? `, ${passed} PASSED (the grader let a wrong answer through)` : ""}`);
  for (const [gate, t] of run.owed) say(`  ${gate}: owed ${t.owed}, fired ${t.fired}`);
  return passed === 0 && run.missing.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Check A.
// ---------------------------------------------------------------------------

type Measured = { version: "v2" | "v1"; usage: ReaderUsage | null; effort: "none" | "default" | null; usd: number | null; call: CallFacts };

function usageReport(ms: Measured[], prices: Prices): void {
  for (const version of ["v2", "v1"] as const) {
    const xs = ms.filter((m) => m.version === version);
    if (xs.length === 0) continue;
    const got = xs.map((m) => m.usage).filter((u): u is ReaderUsage => u !== null);
    const nums = (k: keyof Pick<ReaderUsage, "prompt" | "cached" | "completion" | "reasoning">) => got.map((u) => u[k]).filter((n): n is number => typeof n === "number");
    const pct = (k: Parameters<typeof nums>[0]) => {
      const v = nums(k);
      return v.length ? `p50 ${median(v)}, p95 ${nearestRank(v, 0.95)}, p99 ${nearestRank(v, 0.99)}, max ${Math.max(...v)}` : "not reported";
    };
    const finishes = new Map<string, number>();
    for (const u of got) finishes.set(u.finish ?? "unknown", (finishes.get(u.finish ?? "unknown") ?? 0) + 1);
    const efforts = new Map<string, number>();
    for (const m of xs) if (m.effort) efforts.set(m.effort, (efforts.get(m.effort) ?? 0) + 1);
    const costs = xs.map((m) => m.usd).filter((n): n is number => n !== null);
    say(`  ${version}: ${xs.length} calls, ${got.length} with usage`);
    say(`    prompt tokens: ${pct("prompt")}`);
    say(`    cached tokens: ${pct("cached")}`);
    say(`    completion tokens: ${pct("completion")}`);
    say(`    reasoning tokens: ${pct("reasoning")}`);
    say(`    finish: ${[...finishes].map(([k, n]) => `${k} ${n}`).join(", ") || "none"}${efforts.size ? `; effort path: ${[...efforts].map(([k, n]) => `${k} ${n}`).join(", ")}` : ""}`);
    say(`    cost: ${usd(costs.reduce((a, b) => a + b, 0))} in all, typical (median) ${costs.length ? usd(median(costs) ?? 0, 5) : "—"}`);
    if (version === "v2") {
      const p99 = nearestRank(nums("completion"), 0.99);
      if (p99 !== null) say(`    the cap after check A (spec §2.1): max(400, ceil(1.5 × p99 ${p99})) = ${Math.max(400, Math.ceil(1.5 * p99))} tokens, worst ${usd((Math.max(400, Math.ceil(1.5 * p99)) * prices.outputPer1M) / 1_000_000, 5)} of output`);
    }
  }
  const typ = (v: "v2" | "v1") => median(ms.filter((m) => m.version === v && m.usd !== null).map((m) => m.usd as number));
  const t2 = typ("v2");
  const t1 = typ("v1");
  if (t2 !== null && t1 !== null && t1 > 0) {
    const ratio = t2 / t1;
    say(`  typical v2 ÷ typical v1: ${ratio.toFixed(2)}× — ${ratio > 1.25 ? "OVER the 1.25× budget: trim the static block before opening (palette glosses, then CANT glosses, then LOOK IDS glosses; spec §2.1)" : "within the 1.25× budget"}`);
  }
}

async function live(l: Loaded, cli: Cli, net: NetGuard, key: MainInput["key"]): Promise<number> {
  const problems = [...priceProblems(l.prices, SHOT_WORDS_MODEL, new Date())];
  if (!cli.only) problems.push(...l.blindProblems);
  if (key === "absent") problems.push("no OPENAI_API_KEY in the shell or the env file");
  const calls = planCalls(l, cli);
  printPlan(l, calls, cli);
  say("");
  if (problems.length > 0) {
    say("CHECK A CANNOT START:");
    for (const p of problems) say(`  - ${p}`);
    say(networkLine(net));
    return 2;
  }
  const maxUsd = cli.maxUsd as number;
  const dir = join(CHECK_DIR, "out", `check-a-${stamp()}`);
  mkdirSync(dir, { recursive: true });
  const ledger = new Ledger(join(dir, "ledger.jsonl"));
  const guard = new SpendGuard({ maxUsd, sink: (e) => void ledger.append(e) });
  ledger.append({ ev: "plan", ceilingUsd: calls.reduce((a, c) => a + c.worst, 0), maxUsd, unpriced: [] });
  const onSigint = () => guard.stop("sigint");
  process.on("SIGINT", onSigint);

  say(`CHECK A — live, one call at a time, stopping before ${usd(maxUsd, 2)}. Output: ${dir}`);
  const v2Grades: { p: PreparedEntry; g: Grade; r: Reading; blind: boolean }[] = [];
  const v1Grades = new Map<string, Grade>();
  const measured: Measured[] = [];
  let stopReason: string | null = null;

  for (const c of calls) {
    if (guard.stopped) {
      stopReason ??= `stopped (${guard.stopped.reason})`;
      break;
    }
    const res = guard.reserve("mini-5.4", c.worst, `${c.version}:${c.p.entry.id}`);
    if (!res.ok) {
      stopReason = res.reason;
      break;
    }
    const cap = c.version === "v2" ? SHOT_READER_MAX_COMPLETION : V1_MAX_COMPLETION;
    const fence = fenceFor({ version: c.version, cap });
    let text: string | null = null;
    let effort: "none" | "default" | null = null;
    if (c.version === "v2") {
      const a = await askShotReader(c.p.messages, { maxCompletionTokens: SHOT_READER_MAX_COMPLETION, fetchFn: fence.fetch });
      text = a?.text ?? null;
      effort = a?.effort ?? null;
    } else {
      text = await askShotWords(c.messages[0].content, c.messages[1].content, { fetchFn: fence.fetch });
    }
    const cost = actualUsd(fence.usage, l.prices);
    if (fence.sent === 0) guard.release(res.ticket, fence.refused ?? "not sent");
    else if (cost !== null) guard.settle(res.ticket, cost, cost, "usage", fence.usage as unknown as Record<string, unknown>);
    else guard.settle(res.ticket, c.worst, c.worst, "no usage came back: booked at its worst");
    measured.push({ version: c.version, usage: fence.usage, effort, usd: fence.sent === 0 ? null : (cost ?? c.worst), call: { ...fence.call } });
    appendFileSync(join(dir, "answers.jsonl"), `${JSON.stringify({ id: c.p.entry.id, version: c.version, text, usage: fence.usage, status: fence.call.status, effort, refused: fence.refused })}\n`);

    if (c.version === "v2") {
      const r = readV2(c.p, text);
      const g = gradeV2(c.p, r, l.corpus.defaultForbid, fence.call);
      v2Grades.push({ p: c.p, g, r, blind: c.blind });
      process.stdout.write(`  ${c.p.entry.id} ${g.pass ? "pass" : "FAIL"}\n`);
    } else {
      v1Grades.set(c.p.entry.id, gradeV1(c.p, text, l.corpus.defaultForbid, fence.call).grade);
    }
    if (fence.effortRefused) {
      stopReason = "the API refused reasoning_effort: readings would run at the model's own effort (cap 1,500 tokens, worst ≈$0.009 each), which this run was not reserved for. Stop and decide before opening (spec §7.4).";
      guard.stop("config");
      break;
    }
    if (fence.refused) {
      // The reader asked for something this call wasn't reserved for (a new cap, a new model): every later call would too.
      stopReason = `the fence refused a request: ${fence.refused}. The reader's code changed since this check was written; update the check before spending.`;
      guard.stop("config");
      break;
    }
  }
  process.off("SIGINT", onSigint);
  ledger.close();

  say("");
  const corpusRows = v2Grades.filter((x) => !x.blind);
  const blindRows = v2Grades.filter((x) => x.blind);
  say("THE CORPUS");
  for (const { p, g, r } of corpusRows) if (cli.verbose || !g.pass || g.mentionsMissing.length > 0) printPhrase(p, g, r);
  if (blindRows.length > 0) {
    say("");
    say("THE BLIND PHRASES (reported apart)");
    for (const { p, g, r } of blindRows) printPhrase(p, g, r);
  }
  if (v1Grades.size > 0) {
    say("");
    say("BEFORE / AFTER: the 53 audited requests, every expected field and nothing forbidden (v1 has no plan or reply to grade)");
    let b = 0;
    let a = 0;
    for (const { p, g } of corpusRows.filter((x) => /^A\d+$/.test(x.p.entry.id))) {
      const v1 = v1Grades.get(p.entry.id);
      const ok1 = v1 ? v1.fields && v1.hard.length === 0 : false;
      const ok2 = g.fields && g.hard.length === 0;
      if (ok1) b += 1;
      if (ok2) a += 1;
      say(`  ${p.entry.id.padEnd(4)} v1 ${ok1 ? "pass" : "miss"}  v2 ${ok2 ? "pass" : "miss"}${DESIGNED_FULL.includes(p.entry.id) ? "  (designed full)" : ""}  ${p.entry.phrase.slice(0, 60)}`);
    }
    say(`  v1 ${b} of ${v1Grades.size}; v2 ${a} of ${corpusRows.filter((x) => /^A\d+$/.test(x.p.entry.id)).length}`);
  }
  say("");
  say("USAGE (token counts only; never a word)");
  usageReport(measured, l.prices);
  say("");
  const bars = summarise({ corpus: corpusRows.map((x) => x.g), blind: blindRows.length ? blindRows.map((x) => x.g) : null, calls: measured.filter((m) => m.version === "v2").map((m) => m.call) });
  printBars(bars, true);
  say("");
  say(`SPEND: ${usd(guard.settledUsd)} settled of ${usd(maxUsd, 2)}${guard.overshoots.length ? `; ${guard.overshoots.length} call(s) cost more than reserved` : ""}`);
  if (stopReason) say(`STOPPED EARLY: ${stopReason}`);
  say(networkLine(net));
  writeFileSync(join(dir, "report.txt"), `${lines.join("\n")}\n`);
  return stopReason ? 2 : bars.ok ? 0 : 1;
}

// ---------------------------------------------------------------------------

export async function main({ cli, net, key }: MainInput): Promise<number> {
  const loaded = load(cli);
  if (!loaded.ok) {
    say("THE CORPUS OR ITS SETS CANNOT BE USED:");
    for (const p of loaded.problems) say(`  - ${p}`);
    say(networkLine(net));
    return 2;
  }
  const l = loaded.l;
  say(`corpus: ${l.corpus.phrases.length} phrases (v${l.corpus.version}, ${l.corpus.written}); running ${l.entries.length}; blind: ${l.blindWritten} of ${l.corpus.blind.required} written`);
  for (const n of l.notes) say(`  fixture note — ${n}`);
  say("");
  if (cli.mode === "live") return live(l, cli, net, key);
  const code = cli.mode === "garbage" ? dryGarbage(l, cli) : dryPerfect(l, cli);
  say("");
  printPlan(l, planCalls(l, { ...cli, v1: true }), cli);
  say("");
  say(networkLine(net));
  return code;
}
