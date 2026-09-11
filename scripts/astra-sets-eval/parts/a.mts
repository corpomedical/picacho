// Part A: validity and cost. 30 briefs × 3 runs × each builder (Astra low
// and medium on Batch, claude-sonnet-5 and gpt-5.4-mini synchronously),
// every build through the same flow as production (build-flow.mts), the
// words gate on by default. Also writes the persons sheet for every Astra
// answer (Part D's second bar reads it).
//
// `a --probe`: one Batch line, one mini build and one Sonnet build — the
// minimal real calls that say whether Batch accepts the product's Astra
// body, and whether both baselines accept the strict schema. It asks only
// that, so the words gate does not run on its answers (nor is it planned).
//
// A run is COMPLETE when nothing stopped it and every build reached its end
// (manifest.complete). Only a complete run writes the persons sheet and
// computes bars; state.json keeps every attempt that never started, so
// --resume finishes the run. results.jsonl is rewritten on every invocation.

import { SET_BUILD_EFFORT } from "../../../src/lib/sets/set-config.ts";
import { startBuild, type BuildRecord, type FlowDeps } from "../lib/build-flow.mts";
import { barLine, closureOf, spendLines, writeManifest, writeSummary, type RunContext } from "../lib/context.mts";
import { closeUnfinished, driveBatch, driveEach, loadState, personsItems, recordBuilds, runComplete, saveState, type BuildJob } from "../lib/drive.mts";
import { asReported, barACost, barAValidity, defaultCredits, type BarResult } from "../lib/pass-bars.mts";
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
    // Section 4's sample per arm: the A bars bound whatever of it is missing.
    ctx.manifest.plannedBuilds = Object.fromEntries(builders.map((b) => [b, briefs.length * runs]));

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
      judgeWords: !f.wordsGate || f.probe ? skipWords : ctx.dry ? fakeWords(counter) : ctx.gates ? ctx.gates.words : skipWords,
      closureOf,
    };
    ctx.manifest.wordsGate = f.probe ? "off (the probe asks only whether each request is accepted)" : ctx.dry ? "simulated" : f.wordsGate ? "on" : "off (--no-words-gate)";

    const batchJobs = jobs.filter((j) => j.transport === "batch" && !ctx.dry);
    const eachJobs = jobs.filter((j) => !(j.transport === "batch" && !ctx.dry));
    let saved = 0;
    // If either driver stops on an error, the other starts nothing new and
    // lets what is in flight land (settled, and saved) before the error goes
    // up: a request cut off by the exit would be billed and never booked.
    const halt = (e: unknown) => {
      ctx.requestStop("harness");
      throw e;
    };
    const [batch, each] = await Promise.allSettled([
      batchJobs.length ? driveBatch(ctx, batchJobs, jobs, deps, { resume: Boolean(f.resume) }).catch(halt) : Promise.resolve("done" as const),
      driveEach(ctx, eachJobs, deps, {
        sonnetMode: f.sonnetMode,
        onDone: () => {
          if (++saved % 10 === 0) saveState(ctx, jobs);
        },
      }).catch(halt),
    ]);
    if (batch.status === "rejected" || each.status === "rejected") {
      saveState(ctx, jobs);
      throw batch.status === "rejected" ? batch.reason : (each as PromiseRejectedResult).reason;
    }
    const batchEnd = batch.value;
    const interruptedBatch = batchEnd === "stopped";
    const complete = runComplete(ctx, jobs, batchEnd);
    ctx.manifest.complete = complete;
    ctx.manifest.stop = ctx.stopReason() ?? ctx.guard.stopped?.reason ?? null;
    // state.json first: every attempt that never started stays pending there,
    // for --resume. The rows below close them (in memory) as not run.
    saveState(ctx, jobs);
    closeUnfinished(ctx, jobs);
    const records = recordBuilds(ctx, jobs, { fresh: true });
    const pages = f.probe || !complete ? [] : writeRaterSheets(ctx, "d-persons", personsItems(ctx, records, (b) => b.startsWith("astra")));

    const out: string[] = [];
    out.push(`A ${ctx.runId}${ctx.dry ? "  (DRY RUN: simulated answers, simulated gates)" : ""}`);
    if (interruptedBatch) out.push("INTERRUPTED with a batch still running at OpenAI: resume with --resume " + ctx.runDir);
    else if (!complete) out.push(`DID NOT FINISH (${String(ctx.manifest.stop ?? "unfinished")}): the attempts that never started are kept; --resume ${ctx.runDir} sends them`);
    out.push(...buildSummary(records));
    const bars: BarResult[] = [];
    if (f.probe) out.push(...probeLines(records));
    else if (!ctx.dry && complete) {
      const credits = defaultCredits(ctx.book.astraFirstWorstUsd, ctx.book.costBasisUsdPerCredit);
      const shipped = `astra-${SET_BUILD_EFFORT}`;
      for (const b of builders.filter((x) => x.startsWith("astra"))) {
        const plan = { planned: briefs.length * runs, worstBuildUsd: ctx.book.astraBuildWorstUsd };
        const bs = [barAValidity(b, records, plan), barACost(b, records, credits, ctx.book.costBasisUsdPerCredit, plan)];
        bars.push(...(b === shipped ? bs : bs.map((x) => asReported(x, `not the shipped effort (SET_BUILD_EFFORT = ${SET_BUILD_EFFORT})`))));
      }
      out.push("--- bars (report recomputes these; --credits there changes the price) ---", ...bars.map(barLine));
      out.push(
        `  the worst case with the closing retry, ${usd(ctx.book.astraBuildWorstUsd, 3)}, would be ${defaultCredits(ctx.book.astraBuildWorstUsd, ctx.book.costBasisUsdPerCredit)} credits at ${usd(ctx.book.costBasisUsdPerCredit, 2)}; pricing is the operator's call`,
      );
    } else if (ctx.dry) out.push("--- bars: none (simulated rows are never a result) ---");
    else out.push("--- bars: none until the run finishes (no persons sheet either) ---");
    if (pages.length) out.push(`--- persons sheets (Part D's bar) ---`, ...pages.map((p) => `  ${p}`));
    out.push(...spendLines(ctx));
    for (const l of out) ctx.out(l);
    writeSummary(ctx, out.join("\n"), { part: "a", runId: ctx.runId, simulated: ctx.dry, complete, builds: records.length, bars, spend: { settledUsd: ctx.guard.settledUsd, meteredUsd: ctx.guard.meteredUsd } });
    writeManifest(ctx);
    if (interruptedBatch || ctx.stopReason() === "sigint") return 130;
    if ((ctx.guard.stopped || !complete) && !ctx.dry) return 2;
    if (bars.some((b) => b.verdict === "FAIL")) return 1;
    if (bars.some((b) => b.verdict === "UNDETERMINED")) return 2;
    return 0;
  },
};

function probeLines(records: readonly BuildRecord[]): string[] {
  const lines = ["--- probe ---"];
  for (const r of records) {
    const a = r.attempts.find((x) => !x.voided);
    const rejected = a?.outcome.startsWith("submit-failed") ? a.detail ?? a.outcome : null;
    lines.push(
      `  ${r.builder}: ${rejected ? `REJECTED (${rejected})` : `accepted, ${a?.outcome ?? "?"}`}; usage ${a?.usage ? "returned" : "MISSING"}; cost ${usd(a?.billedUsd ?? null)} billed / ${usd(a?.standardUsd ?? null)} standard`,
    );
  }
  lines.push("  sonnet-mode: format accepted → keep --sonnet-mode format; a REJECTED format → run A with --sonnet-mode prompt");
  return lines;
}
