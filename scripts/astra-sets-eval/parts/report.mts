// report <runDir> [<runDir>...]: every bar the runs in hand can settle.
//
// It reads each run's manifest, results, ledger, sheet keys and returned
// ratings (<runDir>/ratings/*.json), imports the ratings against their keys,
// computes the bars (pass-bars.mts) and writes one summary: a line per bar
// with its value, threshold, n and arithmetic; the spend picture (billed and
// production-equivalent, by kind, and the metered tokens of unpriced
// models); and the release line for SETS_OPEN_TO_PLANS.
//
// Simulated rows (a dry run's) never reach a bar: a simulated run is listed
// and set aside.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BuildRecord } from "../lib/build-flow.mts";
import { combineRatings, importRatings, type RatingRow, type SheetKey } from "../lib/blind-sheet.mts";
import type { Flags } from "../lib/cli.mts";
import { barLine } from "../lib/context.mts";
import { Ledger, type CallKind } from "../lib/ledger.mts";
import { agreement, barACost, barAValidity, barB, barD, defaultCredits, priorHitsConstruction, type BarResult, type BItem, type DRow, type PersonsItem } from "../lib/pass-bars.mts";
import { tokenCounts, type PriceBook } from "../lib/prices.mts";
import { newRunId, pct, usd } from "../lib/util.mts";
import { readRun } from "./b.mts";
import type { DOutcome } from "./d.mts";

type LoadedRun = {
  dir: string;
  manifest: Record<string, unknown>;
  rows: Record<string, unknown>[];
  keys: SheetKey[];
  ratings: unknown[];
  simulated: boolean;
  part: string;
};

function loadRun(dir: string): LoadedRun {
  const { manifest, rows } = readRun(dir);
  const read = (sub: string, match: (f: string) => boolean) =>
    existsSync(join(dir, sub))
      ? readdirSync(join(dir, sub))
          .filter(match)
          .map((f) => JSON.parse(readFileSync(join(dir, sub, f), "utf8")) as unknown)
      : [];
  return {
    dir,
    manifest,
    rows,
    keys: read("keys", (f) => f.endsWith(".key_do_not_share.json")) as SheetKey[],
    ratings: read("ratings", (f) => f.endsWith(".json")),
    simulated: manifest.simulated === true,
    part: String(manifest.part ?? "?"),
  };
}

function spendPicture(runs: readonly LoadedRun[]): string[] {
  const lines = ["--- spend (from each run's ledger) ---"];
  for (const r of runs) {
    const events = Ledger.read(join(r.dir, "ledger.jsonl"));
    const kindOf = new Map<string, CallKind>();
    const byKind = new Map<string, { billed: number; standard: number; n: number }>();
    const meters = new Map<string, { n: number; usd: number | null; input: number; output: number }>();
    for (const e of events) {
      if (e.ev === "reserve") kindOf.set(e.ticket, e.kind);
      if (e.ev === "settle") {
        const k = kindOf.get(e.ticket) ?? "?";
        const v = byKind.get(k) ?? { billed: 0, standard: 0, n: 0 };
        v.billed += e.actualUsd;
        v.standard += e.standardUsd;
        v.n += 1;
        byKind.set(k, v);
      }
      if (e.ev === "meter") {
        const m = meters.get(e.model) ?? { n: 0, usd: 0, input: 0, output: 0 };
        m.n += 1;
        m.usd = e.usd === null || m.usd === null ? null : m.usd + e.usd;
        const t = tokenCounts(e.usage, e.host === "api.anthropic.com" ? "anthropic" : "openai");
        if (t) {
          m.input += t.freshInput + t.cachedInput + t.cacheWrite;
          m.output += t.output;
        }
        meters.set(e.model, m);
      }
    }
    lines.push(`  ${r.manifest.runId ?? r.dir}${r.simulated ? " (simulated)" : ""}`);
    for (const [k, v] of byKind) lines.push(`    ${k}: ${v.n} calls, billed ${usd(v.billed)}, production-equivalent ${usd(v.standard)}`);
    for (const [model, m] of meters) lines.push(`    metered ${model}: ${m.n} calls, ${m.input} in / ${m.output} out tokens, ${m.usd === null ? "unpriced" : usd(m.usd)}`);
    if (byKind.size === 0 && meters.size === 0) lines.push("    nothing spent");
  }
  return lines;
}

export async function runReport(o: { runDirs: readonly string[]; flags: Flags; book: PriceBook; repoRoot: string; outRoot: string; out: (l?: string) => void }): Promise<number> {
  const runs = o.runDirs.map(loadRun);
  const real = runs.filter((r) => !r.simulated);
  const problems: string[] = [];
  const warnings: string[] = [];

  // Ratings, imported against their keys.
  const ratingRows: RatingRow[] = [];
  const keyKind = new Map<string, string>();
  for (const r of runs) {
    for (const key of r.keys) {
      keyKind.set(key.sheetId, key.kind);
      if (r.ratings.length === 0) continue;
      const imp = importRatings(key, r.ratings, { allowIncomplete: o.flags.allowIncomplete });
      if (imp.rows.length === 0 && imp.problems.every((p) => p.includes("no ratings file"))) {
        warnings.push(...imp.problems);
        continue;
      }
      problems.push(...imp.problems);
      warnings.push(...imp.warnings);
      if (!r.simulated) ratingRows.push(...imp.rows.map((x) => ({ ...x, source: { ...x.source, kind: key.kind } })));
    }
  }
  const combined = combineRatings(ratingRows);
  const ofKind = (kind: string) => [...combined.values()].filter((c) => c.source.kind === kind);

  const bars: BarResult[] = [];
  const release: Record<"A" | "B" | "C" | "D", "✓" | "✗" | "?"> = { A: "?", B: "?", C: "?", D: "?" };
  const verdictOf = (all: BarResult[]) => {
    const bs = all.filter((b) => b.verdict !== "REPORTED");
    return bs.length === 0 ? "?" : bs.some((b) => b.verdict === "FAIL") ? "✗" : bs.every((b) => b.verdict === "PASS") ? "✓" : "?";
  };

  // A
  const aBuilds = real.filter((r) => r.part === "a" && r.manifest.probe !== true).flatMap((r) => r.rows.filter((x) => x.type === "build") as unknown as BuildRecord[]);
  const astraArms = [...new Set(aBuilds.map((b) => b.builder))].filter((b) => b.startsWith("astra-"));
  const credits = o.flags.credits ?? defaultCredits(o.book.astraFirstWorstUsd, o.book.costBasisUsdPerCredit);
  const aBars: BarResult[] = [];
  for (const arm of astraArms) aBars.push(barAValidity(arm, aBuilds), barACost(arm, aBuilds, credits, o.book.costBasisUsdPerCredit));
  bars.push(...aBars);
  const reported: BarResult[] = [...new Set(aBuilds.map((b) => b.builder))]
    .filter((b) => !b.startsWith("astra-"))
    .map((b) => ({ ...barAValidity(b, aBuilds), label: `A ${b} validity (baseline, no bar)`, verdict: "REPORTED" as const }));
  if (aBars.length) release.A = verdictOf(aBars);

  // B
  const costPerDelivered: Record<string, number | null> = {};
  for (const b of new Set(aBuilds.map((x) => x.builder))) {
    const mine = aBuilds.filter((x) => x.builder === b && !x.notRun);
    const delivered = mine.filter((x) => x.status === "delivered").length;
    costPerDelivered[b] = mine.some((x) => x.standardUsd === null) || delivered === 0 ? null : mine.reduce((s, x) => s + (x.standardUsd as number), 0) / delivered;
  }
  const bItems: BItem[] = ofKind("b-fidelity").map((c) => ({ builder: String(c.source.builder), scores: c.ratings.map((x) => x.score).filter((x): x is number => typeof x === "number") }));
  if (real.some((r) => r.part === "b")) {
    const bBars = barB(bItems, costPerDelivered, astraArms.length ? astraArms : ["astra-low"]);
    bars.push(...bBars);
    release.B = verdictOf(bBars.filter((b) => b.id.startsWith("B-median")));
    const ag = agreement(bItems);
    if (ag.n) {
      reported.push({
        id: "B-agreement",
        label: "B inter-rater agreement (no bar)",
        verdict: "REPORTED",
        value: pct(ag.exact / ag.n),
        threshold: "reported",
        n: ag.n,
        arithmetic: `exact ${ag.exact}/${ag.n} = ${pct(ag.exact / ag.n)}; within 1 point ${ag.within1}/${ag.n} = ${pct(ag.within1 / ag.n)}`,
        notes: [],
      });
    }
  }

  // C: the engine leg is not built yet, so no real C run exists to settle it.
  const cNote = real.some((r) => r.part === "c") ? "C: a real C run is in hand but the engine leg is not built; nothing to settle" : "C: not run (the engine leg is design §9's second sitting)";

  // D
  const dOutcomes = real.filter((r) => r.part === "d").flatMap((r) => r.rows.filter((x) => x.type === "d-outcome") as unknown as DOutcome[]);
  if (dOutcomes.length) {
    const rows: DRow[] = dOutcomes.map((x) => ({ briefId: `${x.briefId}-r${x.run}`, harmful: x.harmful, outcome: x.outcome }));
    const persons: PersonsItem[] = ofKind("d-persons").map((c) => ({ choices: c.ratings.map((x) => x.choice).filter((x): x is "yes" | "no" | "unsure" => typeof x === "string") }));
    const construction = priorHitsConstruction({
      actions: readFileSync(join(o.repoRoot, "src/lib/sets/actions.ts"), "utf8"),
      policyLog: readFileSync(join(o.repoRoot, "src/lib/generations/policy-log.ts"), "utf8"),
    });
    const personsKeys = real.flatMap((r) => r.keys.filter((k) => k.kind === "d-persons")).length;
    const dBars = barD(rows, personsKeys ? persons : [], construction);
    bars.push(...dBars);
    release.D = verdictOf(dBars.filter((b) => b.id !== "D-over-refusal"));
  }

  // Canary: the latest real canary run's own verdict.
  const canaries = real.filter((r) => r.part === "canary");
  const canaryLines: string[] = [];
  let canaryAlerted = false;
  for (const c of canaries) {
    const s = join(c.dir, "summary.json");
    if (!existsSync(s)) continue;
    const j = JSON.parse(readFileSync(s, "utf8")) as { alert?: { alert?: boolean; lines?: string[]; reasons?: string[] } };
    canaryLines.push(`  ${String(c.manifest.runId)}: ${j.alert?.alert ? `ALERT (${(j.alert.reasons ?? []).join("; ")})` : "no alert"}`);
    for (const l of j.alert?.lines ?? []) canaryLines.push(`    ${l}`);
    canaryAlerted ||= Boolean(j.alert?.alert);
  }

  const lines: string[] = [];
  lines.push(`Astra Sets eval report — ${new Date().toISOString()}`);
  lines.push(`runs: ${runs.map((r) => `${r.manifest.runId ?? r.dir}${r.simulated ? " (SIMULATED: set aside)" : ""}`).join(", ")}`);
  if (real.length === 0) lines.push("*** DRY RUN ONLY: every run here is simulated; no bar below is a result ***");
  lines.push("--- bars ---");
  for (const b of bars) lines.push(`  ${barLine(b)}`);
  for (const b of reported) lines.push(`  ${barLine(b)}`);
  lines.push(`  ${cNote}`);
  if (!dOutcomes.length) lines.push("  D: no real D run in hand");
  if (!aBuilds.length) lines.push("  A: no real A run in hand");
  lines.push(`  A cost bar priced at ${credits} credits${o.flags.credits ? " (--credits)" : ` (ceil(${usd(o.book.astraFirstWorstUsd, 3)} / ${usd(o.book.costBasisUsdPerCredit, 2)}))`}; the worst case with the closing retry, ${usd(o.book.astraBuildWorstUsd, 3)}, would be ${defaultCredits(o.book.astraBuildWorstUsd, o.book.costBasisUsdPerCredit)} credits: the operator's call`);
  lines.push("  statistics: median averages the two middle values; p95 is nearest rank, sorted[ceil(0.95 n) − 1]");
  if (canaryLines.length) lines.push("--- canary ---", ...canaryLines);
  if (warnings.length) lines.push("--- ratings: warnings ---", ...warnings.map((w) => `  ${w}`));
  if (problems.length) lines.push("--- ratings: PROBLEMS (these ratings were not used) ---", ...problems.map((p) => `  ${p}`));
  lines.push(...spendPicture(runs));
  lines.push(`SETS_OPEN_TO_PLANS needs A–D PASS: A ${release.A} B ${release.B} C ${release.C} D ${release.D}`);

  const dir = join(o.outRoot, newRunId("report", real.length === 0));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "summary.txt"), lines.join("\n") + "\n");
  writeFileSync(join(dir, "summary.json"), JSON.stringify({ runs: runs.map((r) => ({ dir: r.dir, part: r.part, simulated: r.simulated })), bars, reported, release, problems, warnings, credits }, null, 2));
  for (const l of lines) o.out(l);
  o.out(`summary: ${join(dir, "summary.txt")}`);

  if (real.length === 0) return 0;
  if (problems.length) return 2;
  if (bars.some((b) => b.verdict === "FAIL") || canaryAlerted) return 1;
  if (bars.some((b) => b.verdict === "UNDETERMINED")) return 2;
  return 0;
}
