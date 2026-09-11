// What every part gets: the run directory and its files, the money fence,
// the network guard, the price book and the corpus — and the few helpers
// every part shares (the manifest, results, the summary, closure).
//
// Progress goes to stderr as ids only, never brief text. Everything a run
// writes lands in its own directory under out/ (ignored by git): the
// manifest, the ledger, results, answers, specs, frames, sheets, keys,
// ratings and the summary.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describeOpenSides, measureClosure } from "../../../src/lib/sets/closure.ts";
import type { SetSpec } from "../../../src/lib/sets/set-spec.ts";
import type { Flags, Part } from "./cli.mts";
import type { CorpusCheck } from "./corpus.mts";
import type { Ledger } from "./ledger.mts";
import type { NetGuard } from "./net-guard.mts";
import type { PriceBook } from "./prices.mts";
import type { SpendGuard } from "./spend-guard.mts";
import type { GateVerdict } from "./words-gate.mts";
import type { WordsVerdict } from "./build-flow.mts";
import type { BarResult } from "./pass-bars.mts";

export type Gates = {
  words: (spec: SetSpec, ref: string) => Promise<WordsVerdict>;
  brief: (brief: string, priorHits: number, ref: string) => Promise<GateVerdict>;
};

export type RunContext = {
  part: Part;
  runId: string;
  runDir: string;
  dry: boolean;
  flags: Flags;
  corpusDir: string;
  repoRoot: string;
  net: NetGuard;
  book: PriceBook;
  guard: SpendGuard;
  ledger: Ledger;
  corpus: CorpusCheck;
  /** Real gates in a --spend run; null in a dry run (the part uses fakes). */
  gates: Gates | null;
  manifest: Record<string, unknown>;
  inflight: Set<string>;
  /** Start nothing new: Ctrl-C, or the spend guard stopped (budget, overshoot, config). */
  stopping: () => boolean;
  /** Ctrl-C only: cancel background jobs in flight and stop waiting on a batch. A budget stop lets paid work finish. */
  interrupted: () => boolean;
  requestStop: (reason: string) => void;
  stopReason: () => string | null;
  out: (line?: string) => void;
  progress: (msg: string) => void;
};

export const RUN_SUBDIRS = ["answers", "specs", "frames", "stills", "sheets", "keys", "ratings"] as const;

export function makeRunDir(outRoot: string, runId: string): string {
  const dir = join(outRoot, runId);
  for (const s of RUN_SUBDIRS) mkdirSync(join(dir, s), { recursive: true });
  return dir;
}

export function writeResult(ctx: Pick<RunContext, "runDir">, row: object): void {
  appendFileSync(join(ctx.runDir, "results.jsonl"), JSON.stringify(row) + "\n");
}

export function writeManifest(ctx: Pick<RunContext, "runDir" | "manifest">): void {
  writeFileSync(join(ctx.runDir, "manifest.json"), JSON.stringify(ctx.manifest, null, 2));
}

export function writeSummary(ctx: Pick<RunContext, "runDir">, text: string, json: unknown): void {
  writeFileSync(join(ctx.runDir, "summary.txt"), text.endsWith("\n") ? text : text + "\n");
  writeFileSync(join(ctx.runDir, "summary.json"), JSON.stringify(json, null, 2));
}

/** sets/build-tick.ts closureOf: a measurement that throws reads as closed. */
export function closureOf(spec: SetSpec): { open: number; sides: string[] } {
  try {
    const report = measureClosure(THREE, spec);
    return { open: report.openBearings.length, sides: describeOpenSides(spec, report.openSides) };
  } catch {
    return { open: 0, sides: [] };
  }
}

export function barLine(b: BarResult): string {
  return `${b.label}: ${b.arithmetic} → ${b.verdict}${b.notes.length ? `  (${b.notes.join("; ")})` : ""}`;
}

/** The spend picture every part prints at the end. */
export function spendLines(ctx: Pick<RunContext, "guard" | "dry">): string[] {
  const g = ctx.guard;
  const lines = [
    `--- spend${ctx.dry ? " (SIMULATED: nothing was called)" : ""} ---`,
    `  settled (billed)            $${g.settledUsd.toFixed(4)}`,
    `  settled (standard price)    $${g.settledStandardUsd.toFixed(4)}`,
    `  metered (priced readers)    $${g.meteredUsd.toFixed(4)}   unpriced metered calls: ${g.unpricedMeterEvents}`,
    `  still reserved              $${g.outstandingUsd.toFixed(4)}`,
    ctx.dry
      ? `  committed                   $${g.committedUsd.toFixed(4)} (a dry run has no --max-usd)`
      : `  committed / max             $${g.committedUsd.toFixed(4)} / $${g.maxUsd.toFixed(2)}`,
  ];
  if (g.stopped) lines.push(`  STOPPED: ${g.stopped.reason} at $${g.stopped.committedUsd.toFixed(4)}`);
  if (g.overshoots.length) lines.push(`  OVERSHOOT of a reservation on ${g.overshoots.length} call(s)`);
  if (g.overMaxUsd > 0) lines.push(`  OVER --max-usd by $${g.overMaxUsd.toFixed(4)} (metered calls already in flight at the stop)`);
  return lines;
}
