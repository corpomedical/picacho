// Part A: validity and cost. 30 briefs × 3 runs × each builder (Astra low
// and medium on Batch, claude-sonnet-5 and gpt-5.4-mini synchronously),
// every build through the same flow as production (build-flow.mts), the
// words gate on by default. Also writes the persons sheet for every Astra
// answer (Part D's second bar reads it).
//
// `a --probe`: one Batch line, one mini build and one Sonnet build — the
// minimal real calls that say whether Batch accepts the product's Astra
// body, and whether both baselines accept the strict schema.

import { SET_BUILD_EFFORT } from "../../../src/lib/sets/set-config.ts";
import { startBuild, type BuildRecord, type FlowDeps } from "../lib/build-flow.mts";
import { barLine, closureOf, spendLines, writeManifest, writeSummary, type RunContext } from "../lib/context.mts";
import { closeUnfinished, driveBatch, driveEach, loadState, personsItems, recordBuilds, saveState, type BuildJob } from "../lib/drive.mts";
import { barACost, barAValidity, defaultCredits, type BarResult } from "../lib/pass-bars.mts";
import { planA, planProbeA } from "../lib/plan.mts";
import { skipWords } from "../lib/words-gate.mts";
import { HarnessError, usd } from "../lib/util.mts";
import { buildSummary, selectRows, writeRaterSheets, type PartModule, type PlanOut } from "./common.mts";
import { fakeWords } from "./simulate.mts";
import type { Brief } from "../lib/corpus.mts";

const SHORT: Record<string, string> = { "astra-low": "al", "astra-medium": "am", "sonnet-5": "sn", "mini-5.4": "mn" };

function briefsFor(ctx: RunContext): Brief[] {
  if (ctx.flags.probe) {
    const c = ctx.corpus.data.canary[0];
    const b = ctx.corpus.data.briefs[0];
    const pick = c ? { id: c.id, category: "canary" as Brief["category"], brief: c.brief, template: c.template } : b;
    if (!pick) throw new HarnessError("the probe needs canary brief 1 (or one brief)");
    return [pick];
  }
  return selectRows(ctx.corpus.data.briefs, ctx.flags.only);
}

export const partA: PartModule = {
  needs: (ctx) => ({ briefs: !ctx.flags.probe, canary: false }),

  plan(ctx): PlanOut {
    const f = ctx.flags;
    const notes = [
      "A/B words in the doc's spend block price 90 builds at $0.54; section 4's table asks for two Astra efforts (180 builds), and the closing retry raised the worst case to $1.155 a build (set-config.ts). These numbers stand; the doc is not edited.",
      "Expected, not a ceiling: the Astra-low arm at the measured ≤ $0.33 a build (set-config.ts header, 8 builds) × 90 × 0.5 ≈ $14.85, plus mends for about 1 in 8. Medium effort has never been measured.",
    ];
    if (f.probe) return { title: "A probe: one Batch line, one mini build, one Sonnet build", lines: planProbeA(ctx.book), notes };
    const briefs = briefsFor(ctx).length;
    return {
      title: `A: ${briefs} briefs × ${f.runs ?? 3} runs × ${f.builders.join(", ")} (${f.transport ?? "batch"} for Astra)`,
      lines: planA({ briefs, runs: f.runs ?? 3, builders: f.builders, transport: f.transport ?? "batch", wordsGate: f.wordsGate, book: ctx.book }),
      notes,
    };
  },

  async run(ctx) {
    const f = ctx.flags;
    const transport = f.transport ?? "batch";
    const briefs = briefsFor(ctx);
    const builders = f.probe ? (["astra-low", "mini-5.4", "sonnet-5"] as const) : f.builders;
    const runs = f.probe ? 1 : (f.runs ?? 3);
    ctx.manifest.transport = { astra: transport, baselines: "sync", sonnetMode: f.sonnetMode };

    let jobs: BuildJob[] | null = f.resume ? loadState(ctx.runDir) : null;
    if (f.resume && !jobs) throw new HarnessError(`--resume: no state.json in ${ctx.runDir}`);
    if (!jobs) {
      jobs = [];
      let index = 0;
      for (const b of builders) {
        for (let run = 1; run <= runs; run++) {
          for (const brief of briefs) {
            const isAstra = b === "astra-low" || b === "astra-medium";
            jobs.push({
              state: startBuild(`${SHORT[b]}-${brief.id}-r${run}`, brief.brief),
              builder: b,
              effort: b === "astra-medium" ? "medium" : isAstra ? SET_BUILD_EFFORT : null,
              provider: b === "sonnet-5" ? "anthropic" : "openai",
              run,
              briefId: brief.id,
              category: brief.category,
              index: index++,
              transport: isAstra ? transport : "sync",
              // The probe asks one question of each builder: does the first request go through?
              ...(f.probe ? { firstOnly: true } : {}),
            });
          }
        }
      }
      if (ctx.dry) {
        // Up to three (brief, run) items per builder, through the fakes.
        const keep = new Set(jobs.filter((j) => j.builder === builders[0]).slice(0, 3).map((j) => `${j.briefId}:${j.run}`));
        jobs = jobs.filter((j) => keep.has(`${j.briefId}:${j.run}`));
        jobs.forEach((j, i) => (j.index = i));
      }
    }
    saveState(ctx, jobs);

    const counter = { n: 0 };
    const deps: FlowDeps = {
      judgeWords: !f.wordsGate ? skipWords : ctx.dry ? fakeWords(counter) : ctx.gates ? ctx.gates.words : skipWords,
      closureOf,
    };
    ctx.manifest.wordsGate = ctx.dry ? "simulated" : f.wordsGate ? "on" : "off (--no-words-gate)";

    const batchJobs = jobs.filter((j) => j.transport === "batch" && !ctx.dry);
    const eachJobs = jobs.filter((j) => !(j.transport === "batch" && !ctx.dry));
    let saved = 0;
    const [batchEnd] = await Promise.all([
      batchJobs.length ? driveBatch(ctx, batchJobs, jobs, deps, { resume: Boolean(f.resume) }) : Promise.resolve("done" as const),
      driveEach(ctx, eachJobs, deps, {
        sonnetMode: f.sonnetMode,
        onDone: () => {
          if (++saved % 10 === 0) saveState(ctx, jobs);
        },
      }),
    ]);
    const interruptedBatch = batchEnd === "stopped";
    if (!interruptedBatch) closeUnfinished(ctx, jobs);
    saveState(ctx, jobs);

    const finished = jobs.filter((j) => j.state.final);
    const records = recordBuilds(ctx, finished);
    const pages = f.probe || interruptedBatch ? [] : writeRaterSheets(ctx, "d-persons", personsItems(ctx, records, (b) => b.startsWith("astra")));

    const out: string[] = [];
    out.push(`A ${ctx.runId}${ctx.dry ? "  (DRY RUN: simulated answers, simulated gates)" : ""}`);
    if (interruptedBatch) out.push("INTERRUPTED with a batch still running at OpenAI: resume with --resume " + ctx.runDir);
    out.push(...buildSummary(records));
    const bars: BarResult[] = [];
    if (f.probe) out.push(...probeLines(records));
    else if (!ctx.dry && !interruptedBatch) {
      const credits = defaultCredits(ctx.book.astraFirstWorstUsd, ctx.book.costBasisUsdPerCredit);
      for (const b of builders.filter((x) => x.startsWith("astra"))) {
        bars.push(barAValidity(b, records), barACost(b, records, credits, ctx.book.costBasisUsdPerCredit));
      }
      out.push("--- bars (report recomputes these; --credits there changes the price) ---", ...bars.map(barLine));
      out.push(
        `  the worst case with the closing retry, ${usd(ctx.book.astraBuildWorstUsd, 3)}, would be ${defaultCredits(ctx.book.astraBuildWorstUsd, ctx.book.costBasisUsdPerCredit)} credits at ${usd(ctx.book.costBasisUsdPerCredit, 2)}; pricing is the operator's call`,
      );
    } else if (ctx.dry) out.push("--- bars: none (simulated rows are never a result) ---");
    if (pages.length) out.push(`--- persons sheets (Part D's bar) ---`, ...pages.map((p) => `  ${p}`));
    out.push(...spendLines(ctx));
    for (const l of out) ctx.out(l);
    writeSummary(ctx, out.join("\n"), { part: "a", runId: ctx.runId, simulated: ctx.dry, builds: records.length, bars, spend: { settledUsd: ctx.guard.settledUsd, meteredUsd: ctx.guard.meteredUsd } });
    writeManifest(ctx);
    if (interruptedBatch || ctx.stopReason() === "sigint") return 130;
    if (ctx.guard.stopped && !ctx.dry) return 2;
    if (bars.some((b) => b.verdict === "FAIL")) return 1;
    if (bars.some((b) => b.verdict === "UNDETERMINED")) return 2;
    return 0;
  },
};

function probeLines(records: readonly BuildRecord[]): string[] {
  const lines = ["--- probe ---"];
  for (const r of records) {
    const a = r.attempts[0];
    const rejected = a?.outcome.startsWith("submit-failed") ? a.detail ?? a.outcome : null;
    lines.push(
      `  ${r.builder}: ${rejected ? `REJECTED (${rejected})` : `accepted, ${a?.outcome ?? "?"}`}; usage ${a?.usage ? "returned" : "MISSING"}; cost ${usd(a?.billedUsd ?? null)} billed / ${usd(a?.standardUsd ?? null)} standard`,
    );
  }
  lines.push("  sonnet-mode: format accepted → keep --sonnet-mode format; a REJECTED format → run A with --sonnet-mode prompt");
  return lines;
}
