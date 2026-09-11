// Part A: validity and cost. 30 briefs × 3 runs × each builder (Astra low
// and medium on Batch, claude-sonnet-5 and gpt-5.4-mini synchronously),
// every build through the same flow as production (build-flow.mts), the
// words gate on by default. Also writes the persons sheet for every Astra
// answer (Part D's second bar reads it).
//
// `a --photos`: the photo arm (Sets from a photo). 20 location photos × 3
// runs on Astra at SET_PHOTO_BUILD_EFFORT (the arm that decides; another
// effort named in --builders is reported beside it), each photo prepared
// exactly as production prepares it (lib/photos.mts) and sent as the
// product sends it (photoBuildRequest; the photo again on the one retry),
// in background only: a photo never goes into a Batch input file. The
// baselines are words-only (section 4 bars photo builds on Astra alone).
// The bytes sent are kept in the run's photos/ for B.
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

import { SET_BUILD_EFFORT, SET_PHOTO_BUILD_EFFORT } from "../../../src/lib/sets/set-config.ts";
import { startBuild, startPhotoBuild, type BuildRecord, type FlowDeps } from "../lib/build-flow.mts";
import type { Builder } from "../lib/cli.mts";
import { barLine, closureOf, spendLines, writeManifest, writeSummary, type RunContext } from "../lib/context.mts";
import { LOCATION_PHOTOS_WANTED, type Brief, type LocationPhoto } from "../lib/corpus.mts";
import { closeUnfinished, driveBatch, driveEach, loadState, personsItems, recordBuilds, runComplete, saveState, type BuildJob } from "../lib/drive.mts";
import { asReported, barACost, barAValidity, defaultCredits, photoArm, type BarResult } from "../lib/pass-bars.mts";
import { planA, planAPhotos, planProbeA } from "../lib/plan.mts";
import { skipWords } from "../lib/words-gate.mts";
import { HarnessError, usd } from "../lib/util.mts";
import { buildSummary, preparePhotos, selectRows, writeRaterSheets, type PartModule, type PlanOut } from "./common.mts";
import { fakeWords } from "./simulate.mts";

const SHORT: Record<string, string> = { "astra-low": "al", "astra-medium": "am", "sonnet-5": "sn", "mini-5.4": "mn" };
/** The photo arm that decides A's and B's photo bars. */
export const PHOTO_ARM = `astra-${SET_PHOTO_BUILD_EFFORT}` as Builder;
const isAstra = (b: string) => b === "astra-low" || b === "astra-medium";

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

function photoPlan(ctx: RunContext): PlanOut {
  const f = ctx.flags;
  const b = ctx.book;
  const photos = selectRows(ctx.corpus.data.locationPhotos, f.only).length;
  const runs = f.runs ?? 3;
  const arms = f.builders.filter(isAstra);
  const specBuilds = LOCATION_PHOTOS_WANTED * 3;
  return {
    title: `A photos: ${photos} location photos × ${runs} runs × ${arms.join(", ")} (background: photos never go on Batch)`,
    lines: planAPhotos({ photos, runs, builders: arms, wordsGate: f.wordsGate, book: b }),
    notes: [
      `${LOCATION_PHOTOS_WANTED} photos × 3 runs = ${specBuilds} builds: the spend block's "A/B photos: 60 builds", at SET_PHOTO_BUILD_EFFORT (${SET_PHOTO_BUILD_EFFORT}), the arm that decides. --builders astra-low,astra-medium adds the other effort, reported beside it.`,
      `The spend block prices those builds on Batch at the first attempt's ${usd(b.astraPhotoFirstWorstUsd, 2)} (${specBuilds} × ${usd(b.astraPhotoFirstWorstUsd, 2)} × ${b.batchMultiplier} = ${usd(specBuilds * b.astraPhotoFirstWorstUsd * b.batchMultiplier, 2)}). A photo never goes into a Batch input file here (it would sit in OpenAI's Files storage, which the product never does), so every photo build runs in background at standard price, and the closing retry raises the worst case to ${usd(b.astraPhotoBuildWorstUsd, 5)} a build (set-config.ts). These numbers stand; the doc is not edited.`,
      `Expected, not a ceiling: the three test builds' $0.49–$0.65 a build (set-config.ts header) × ${specBuilds} ≈ ${usd(specBuilds * 0.49, 2)}–${usd(specBuilds * 0.65, 2)}, plus retries. Medium effort has never been measured on a photo.`,
      "Astra only: section 4 bars photo builds on Astra's cost ($1.12 for photos) and names no baseline for them, so the Sonnet and mini baselines stay words-only.",
      "Like the words arm, A runs no input gate: the notes gate and the picture check are D's photo leg. The words gate on Astra's answers runs as for words.",
    ],
  };
}

/** The words arm's jobs: every builder × run × brief (a dry run keeps three items per builder). */
function textJobs(ctx: RunContext, builders: readonly string[], runs: number, transport: "batch" | "background"): BuildJob[] {
  const briefs = briefsFor(ctx);
  let jobs: BuildJob[] = [];
  let index = 0;
  for (const b of builders) {
    for (let run = 1; run <= runs; run++) {
      for (const brief of briefs) {
        jobs.push({
          state: startBuild(`${SHORT[b]}-${brief.id}-r${run}`, brief.brief),
          builder: b,
          effort: b === "astra-medium" ? "medium" : isAstra(b) ? SET_BUILD_EFFORT : null,
          provider: b === "sonnet-5" ? "anthropic" : "openai",
          run,
          briefId: brief.id,
          category: brief.category,
          index: index++,
          transport: isAstra(b) ? transport : "sync",
          // The probe asks one question of each builder: does the first request go through?
          ...(ctx.flags.probe ? { firstOnly: true } : {}),
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
  return jobs;
}

/** The photo arm's jobs, after preparing the photos they send (a dry run: three (photo, run) items per arm). */
async function photoJobs(ctx: RunContext, arms: readonly string[], runs: number): Promise<BuildJob[]> {
  let items: { row: LocationPhoto; run: number }[] = [];
  for (let run = 1; run <= runs; run++) for (const row of selectRows(ctx.corpus.data.locationPhotos, ctx.flags.only)) items.push({ row, run });
  if (ctx.dry) items = items.slice(0, 3);
  const rows = [...new Map(items.map((it) => [it.row.id, it.row])).values()];
  ctx.photos = await preparePhotos(ctx, rows, { keep: true });
  const store = ctx.photos;
  const jobs: BuildJob[] = [];
  for (const b of arms) {
    for (const { row, run } of items) {
      const sha256 = store.get(row.id)?.sha256 ?? "";
      jobs.push({
        state: startPhotoBuild(`${SHORT[b]}-${row.id}-r${run}`, { photoId: row.id, notes: row.notes, sha256 }),
        builder: b,
        effort: b === "astra-medium" ? "medium" : "low",
        provider: "openai",
        run,
        briefId: row.id,
        category: row.category,
        index: jobs.length,
        transport: "background",
      });
    }
  }
  return jobs;
}

export const partA: PartModule = {
  needs: (ctx) => (ctx.flags.photos ? { locationPhotos: true } : { briefs: !ctx.flags.probe, canary: false }),

  resolveFlags: (f) => (f.photos && !f.given.includes("--builders") ? { ...f, builders: [PHOTO_ARM] } : f),

  plan(ctx): PlanOut {
    const f = ctx.flags;
    if (f.photos) return photoPlan(ctx);
    const notes = [
      "A/B words in the doc's spend block price 90 builds at $0.54; section 4's table asks for two Astra efforts (180 builds), and the closing retry raised the worst case to $1.155 a build (set-config.ts). These numbers stand; the doc is not edited.",
      "Expected, not a ceiling: the Astra-low arm at the measured ≤ $0.33 a build (set-config.ts header, 8 builds) × 90 × 0.5 ≈ $14.85, plus mends for about 1 in 8. Medium effort has never been measured.",
      "The photo arm is its own run: a --photos (location-photos.json, Astra only, background).",
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
    const photos = f.photos;
    const transport = photos ? "background" : (f.transport ?? "batch");
    const builders: readonly string[] = f.probe ? (["astra-low", "mini-5.4", "sonnet-5"] as const) : photos ? f.builders.filter(isAstra) : f.builders;
    const runs = f.probe ? 1 : (f.runs ?? 3);
    const items = photos ? selectRows(ctx.corpus.data.locationPhotos, f.only).length : briefsFor(ctx).length;
    ctx.manifest.transport = photos ? { astra: "background", photos: true } : { astra: transport, baselines: "sync", sonnetMode: f.sonnetMode };
    // Section 4's sample per arm: the A bars bound whatever of it is missing.
    ctx.manifest.plannedBuilds = Object.fromEntries(builders.map((b) => [b, items * runs]));

    let jobs: BuildJob[] | null = f.resume ? loadState(ctx.runDir) : null;
    if (f.resume && !jobs) throw new HarnessError(`--resume: no state.json in ${ctx.runDir}`);
    if (!jobs) jobs = photos ? await photoJobs(ctx, builders, runs) : textJobs(ctx, builders, runs, transport);
    else if (photos) {
      // The bytes this run already sent, read back from its photos/ (never re-encoded mid-run).
      const ids = new Set(jobs.map((j) => j.state.photo?.photoId));
      ctx.photos = await preparePhotos(ctx, ctx.corpus.data.locationPhotos.filter((p) => ids.has(p.id)), { keep: true });
    }
    saveState(ctx, jobs);

    const counter = { n: 0 };
    const deps: FlowDeps = {
      judgeWords: !f.wordsGate || f.probe ? skipWords : ctx.dry ? fakeWords(counter) : ctx.gates ? ctx.gates.words : skipWords,
      closureOf,
    };
    ctx.manifest.wordsGate = f.probe ? "off (the probe asks only whether each request is accepted)" : ctx.dry ? "simulated" : f.wordsGate ? "on" : "off (--no-words-gate)";

    const all = jobs;
    const batchJobs = all.filter((j) => j.transport === "batch" && !ctx.dry);
    const eachJobs = all.filter((j) => !(j.transport === "batch" && !ctx.dry));
    let saved = 0;
    // If either driver stops on an error, the other starts nothing new and
    // lets what is in flight land (settled, and saved) before the error goes
    // up: a request cut off by the exit would be billed and never booked.
    const halt = (e: unknown) => {
      ctx.requestStop("harness");
      throw e;
    };
    const [batch, each] = await Promise.allSettled([
      batchJobs.length ? driveBatch(ctx, batchJobs, all, deps, { resume: Boolean(f.resume) }).catch(halt) : Promise.resolve("done" as const),
      driveEach(ctx, eachJobs, deps, {
        sonnetMode: f.sonnetMode,
        onDone: () => {
          if (++saved % 10 === 0) saveState(ctx, all);
        },
      }).catch(halt),
    ]);
    if (batch.status === "rejected" || each.status === "rejected") {
      saveState(ctx, all);
      throw batch.status === "rejected" ? batch.reason : (each as PromiseRejectedResult).reason;
    }
    const batchEnd = batch.value;
    const interruptedBatch = batchEnd === "stopped";
    const complete = runComplete(ctx, all, batchEnd);
    ctx.manifest.complete = complete;
    ctx.manifest.stop = ctx.stopReason() ?? ctx.guard.stopped?.reason ?? null;
    // state.json first: every attempt that never started stays pending there,
    // for --resume. The rows below close them (in memory) as not run.
    saveState(ctx, all);
    closeUnfinished(ctx, all);
    const records = recordBuilds(ctx, all, { fresh: true });
    const pages = f.probe || !complete ? [] : writeRaterSheets(ctx, "d-persons", personsItems(ctx, records, (b) => b.startsWith("astra")));

    const out: string[] = [];
    out.push(`A ${ctx.runId}${photos ? " (photo arm)" : ""}${ctx.dry ? "  (DRY RUN: simulated answers, simulated gates)" : ""}`);
    if (interruptedBatch) out.push("INTERRUPTED with a batch still running at OpenAI: resume with --resume " + ctx.runDir);
    else if (!complete) out.push(`DID NOT FINISH (${String(ctx.manifest.stop ?? "unfinished")}): the attempts that never started are kept; --resume ${ctx.runDir} sends them`);
    out.push(...buildSummary(records, photos ? "photos" : "briefs"));
    const bars: BarResult[] = [];
    if (f.probe) out.push(...probeLines(records));
    else if (!ctx.dry && complete) {
      const firstWorst = photos ? ctx.book.astraPhotoFirstWorstUsd : ctx.book.astraFirstWorstUsd;
      const buildWorst = photos ? ctx.book.astraPhotoBuildWorstUsd : ctx.book.astraBuildWorstUsd;
      const credits = defaultCredits(firstWorst, ctx.book.costBasisUsdPerCredit);
      const shipped = photos ? PHOTO_ARM : `astra-${SET_BUILD_EFFORT}`;
      const knob = photos ? `SET_PHOTO_BUILD_EFFORT = ${SET_PHOTO_BUILD_EFFORT}` : `SET_BUILD_EFFORT = ${SET_BUILD_EFFORT}`;
      for (const b of builders.filter(isAstra)) {
        const plan = { planned: items * runs, worstBuildUsd: buildWorst };
        const measured = [barAValidity(b, records, plan), barACost(b, records, credits, ctx.book.costBasisUsdPerCredit, plan)];
        const bs = photos ? measured.map(photoArm) : measured;
        bars.push(...(b === shipped ? bs : bs.map((x) => asReported(x, `not the shipped effort (${knob})`))));
      }
      out.push(`--- bars (report recomputes these; --${photos ? "photo-credits" : "credits"} there changes the price) ---`, ...bars.map(barLine));
      out.push(
        `  the worst case with the closing retry, ${usd(buildWorst, 3)}, would be ${defaultCredits(buildWorst, ctx.book.costBasisUsdPerCredit)} credits at ${usd(ctx.book.costBasisUsdPerCredit, 2)}; pricing is the operator's call`,
      );
    } else if (ctx.dry) out.push("--- bars: none (simulated rows are never a result) ---");
    else out.push("--- bars: none until the run finishes (no persons sheet either) ---");
    if (pages.length) out.push(`--- persons sheets (Part D's bar) ---`, ...pages.map((p) => `  ${p}`));
    out.push(...spendLines(ctx));
    for (const l of out) ctx.out(l);
    writeSummary(ctx, out.join("\n"), { part: "a", photos, runId: ctx.runId, simulated: ctx.dry, complete, builds: records.length, bars, spend: { settledUsd: ctx.guard.settledUsd, meteredUsd: ctx.guard.meteredUsd } });
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
