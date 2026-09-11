// Helpers the parts share: selecting rows, writing rater sheets, and the
// build summary A, D and the canary print.

import { randomInt } from "node:crypto";
import { join } from "node:path";
import type { BuildRecord } from "../lib/build-flow.mts";
import { planSheet, QUESTIONS, writeSheet, type SheetItemIn, type SheetKind } from "../lib/blind-sheet.mts";
import type { RunContext } from "../lib/context.mts";
import type { PlannedCall } from "../lib/spend-guard.mts";
import { max, median, p95 } from "../lib/stats.mts";
import { HarnessError, pct, usd } from "../lib/util.mts";
import type { CorpusNeeds } from "../lib/corpus.mts";

export type PlanOut = { title: string; lines: PlannedCall[]; notes: string[] } | { blocked: string; notes: string[] };

export type PartModule = {
  needs(ctx: Pick<RunContext, "flags">): CorpusNeeds & { photos?: boolean };
  plan(ctx: RunContext): PlanOut;
  run(ctx: RunContext): Promise<number>;
};

export function selectRows<T extends { id: string }>(rows: readonly T[], only: string[] | null): T[] {
  if (!only) return [...rows];
  const unknown = only.filter((id) => !rows.some((r) => r.id === id));
  if (unknown.length) throw new HarnessError(`--only: no such id ${unknown.join(", ")}`);
  return rows.filter((r) => only.includes(r.id));
}

/** The run's shuffle seed: --seed, or a random one that the keys and the manifest record. */
export function runSeed(ctx: RunContext): number {
  const existing = ctx.manifest.seed;
  if (typeof existing === "number") return existing;
  const seed = ctx.flags.seed ?? randomInt(0, 2 ** 31 - 1);
  ctx.manifest.seed = seed;
  return seed;
}

/** One sheet per rater, each with its own order and ids. */
export function writeRaterSheets(ctx: RunContext, kind: SheetKind, items: readonly SheetItemIn[]): string[] {
  if (items.length === 0) return [];
  const seed = runSeed(ctx);
  const pages: string[] = [];
  for (const raterId of ctx.flags.raters) {
    const plan = planSheet({ kind, raterId, seed, items });
    const { page } = writeSheet(plan, QUESTIONS[kind], { sheets: join(ctx.runDir, "sheets"), keys: join(ctx.runDir, "keys") });
    pages.push(page);
  }
  return pages;
}

const count = <T,>(xs: readonly T[], f: (x: T) => boolean) => xs.filter(f).length;

/** Per builder: validity, delivery, closure, cost and tokens, by run and by brief. */
export function buildSummary(records: readonly BuildRecord[]): string[] {
  const lines: string[] = [];
  const builders = [...new Set(records.map((r) => r.builder))];
  for (const b of builders) {
    const all = records.filter((r) => r.builder === b);
    const ran = all.filter((r) => !r.notRun);
    const n = ran.length;
    const valid = count(ran, (r) => r.validWithinRetry);
    const first = count(ran, (r) => r.firstValid);
    const delivered = count(ran, (r) => r.status === "delivered");
    const closed = count(ran, (r) => r.status === "delivered" && r.openAtDelivery === 0);
    const costs = ran.map((r) => r.standardUsd).filter((x): x is number => x !== null);
    const billed = ran.map((r) => r.billedUsd).filter((x): x is number => x !== null);
    const outs = ran.map((r) => r.outputTokens);
    lines.push(`--- ${b} ---`);
    lines.push(`  ran ${n} (not run: ${all.length - n}${all.length - n ? `: ${[...new Set(all.filter((r) => r.notRun).map((r) => r.notRun))].join(", ")}` : ""})`);
    if (n === 0) continue;
    lines.push(`  valid within one retry ${valid}/${n} = ${pct(valid / n)}   valid first time ${first}/${n} = ${pct(first / n)}`);
    lines.push(`  delivered ${delivered}/${n}   closed at delivery ${closed}/${delivered || 1}`);
    const fail = new Map<string, number>();
    for (const r of ran) if (r.failure) fail.set(r.failure, (fail.get(r.failure) ?? 0) + 1);
    if (fail.size) lines.push(`  failures: ${[...fail.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}`);
    const kinds = new Map<string, number>();
    for (const r of ran) for (const a of r.attempts.slice(1)) kinds.set(a.kind, (kinds.get(a.kind) ?? 0) + 1);
    if (kinds.size) lines.push(`  retries: ${[...kinds.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}`);
    const notes = new Map<string, number>();
    for (const r of ran) for (const a of r.attempts) for (const x of a.notes ?? []) notes.set(x, (notes.get(x) ?? 0) + 1);
    if (notes.size) lines.push(`  normaliser notes: ${[...notes.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}`);
    const words = new Map<string, number>();
    for (const r of ran) for (const a of r.attempts) if (a.words) {
      const k = typeof a.words === "object" ? "refused" : a.words;
      words.set(k, (words.get(k) ?? 0) + 1);
    }
    if (words.size) lines.push(`  words gate: ${[...words.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}`);
    if (costs.length === n) {
      lines.push(`  cost per build (standard) p50 ${usd(median(costs))} p95 ${usd(p95(costs))} max ${usd(max(costs))}; billed total ${usd(billed.reduce((a, c) => a + c, 0))}`);
    } else lines.push(`  cost: ${n - costs.length} builds unpriced (tokens metered)`);
    lines.push(`  output tokens p50 ${median(outs)} p95 ${p95(outs)} max ${max(outs)}`);
    const runs = [...new Set(ran.map((r) => r.run))].sort();
    if (runs.length > 1) lines.push(`  valid by run: ${runs.map((k) => `run ${k} ${count(ran, (r) => r.run === k && r.validWithinRetry)}/${count(ran, (r) => r.run === k)}`).join(", ")}`);
    const briefs = [...new Set(ran.map((r) => r.briefId))];
    if (runs.length > 1) {
      const stable = briefs.filter((id) => ran.filter((r) => r.briefId === id).every((r) => r.validWithinRetry)).length;
      lines.push(`  briefs valid on every run: ${stable}/${briefs.length}`);
    }
  }
  return lines;
}

export function printPlanNotes(ctx: RunContext, notes: readonly string[]): void {
  for (const n of notes) ctx.out(`  note: ${n}`);
}
