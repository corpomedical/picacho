// The canary: 10 fixed briefs, first attempt only, SET_BUILD_EFFORT, on
// Batch. The model is one alias with no dated snapshot, so this is how a
// silent change shows up: first-attempt validity under 90%, or p95 output
// tokens moving more than 30% from the baseline (with n = 10, p95 is the
// maximum). History lives in out/canary/history.jsonl; a new prompt
// fingerprint or canary file starts a new baseline, and so does
// --rebaseline. Dry runs never write the history.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SET_BUILD_EFFORT } from "../../../src/lib/sets/set-config.ts";
import { startBuild, type FlowDeps } from "../lib/build-flow.mts";
import { closureOf, spendLines, writeManifest, writeSummary } from "../lib/context.mts";
import { canarySha } from "../lib/corpus.mts";
import { closeUnfinished, driveBatch, driveEach, loadState, recordBuilds, saveState, type BuildJob } from "../lib/drive.mts";
import { promptFingerprint } from "../lib/fingerprint.mts";
import { canaryAlert, type CanaryRow } from "../lib/pass-bars.mts";
import { planCanary } from "../lib/plan.mts";
import { mean, p95 } from "../lib/stats.mts";
import { skipWords } from "../lib/words-gate.mts";
import { HarnessError } from "../lib/util.mts";
import { selectRows, type PartModule } from "./common.mts";

export function historyPath(outRoot: string): string {
  return join(outRoot, "canary", "history.jsonl");
}

export function readHistory(path: string): CanaryRow[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as CanaryRow);
}

export const partCanary: PartModule = {
  needs: () => ({ canary: true }),

  plan(ctx) {
    const rows = selectRows(ctx.corpus.data.canary, ctx.flags.only);
    return {
      title: `Canary: ${rows.length} briefs, first attempt only, ${ctx.flags.transport ?? "batch"}`,
      lines: planCanary({ briefs: rows.length, transport: ctx.flags.transport ?? "batch", book: ctx.book }),
      notes: ["The doc's weekly figure (about $1.60) is the measured rate; the ceiling above is the worst case at the output cap."],
    };
  },

  async run(ctx) {
    const f = ctx.flags;
    const transport = f.transport ?? "batch";
    ctx.manifest.transport = { astra: transport, effort: SET_BUILD_EFFORT };
    const rows = selectRows(ctx.corpus.data.canary, f.only);
    let jobs: BuildJob[] | null = f.resume ? loadState(ctx.runDir) : null;
    if (f.resume && !jobs) throw new HarnessError(`--resume: no state.json in ${ctx.runDir}`);
    if (!jobs) {
      jobs = rows.map((r, i) => ({
        state: startBuild(`cn-${r.id}`, r.brief),
        builder: "astra-canary",
        effort: SET_BUILD_EFFORT,
        provider: "openai" as const,
        run: 1,
        briefId: r.id,
        category: "canary",
        index: i,
        transport,
        firstOnly: true,
      }));
      if (ctx.dry) jobs = jobs.slice(0, 3);
    }
    saveState(ctx, jobs);
    const deps: FlowDeps = { judgeWords: skipWords, closureOf };
    const end = !ctx.dry && transport === "batch" ? await driveBatch(ctx, jobs, jobs, deps, { resume: Boolean(f.resume) }) : (await driveEach(ctx, jobs, deps, { sonnetMode: "format" }), "done" as const);
    if (end === "stopped") {
      saveState(ctx, jobs);
      ctx.out(`INTERRUPTED with a batch still running at OpenAI: resume with --resume ${ctx.runDir}`);
      writeManifest(ctx);
      return 130;
    }
    closeUnfinished(ctx, jobs);
    saveState(ctx, jobs);
    const records = recordBuilds(ctx, jobs);
    const ran = records.filter((r) => !r.notRun);
    const firstOut = ran.map((r) => r.attempts[0]).filter((a) => a && !a.outcome.startsWith("submit-failed"));
    const outTokens = ran.map((r) => r.outputTokens);
    const inTokens = ran.map((r) => r.inputTokens);
    const std = ran.map((r) => r.standardUsd).filter((x): x is number => x !== null);
    const row: CanaryRow = {
      runId: ctx.runId,
      date: new Date().toISOString().slice(0, 10),
      promptFingerprint: promptFingerprint(),
      canarySha: canarySha(rows),
      validFirst: ran.filter((r) => r.firstValid).length,
      n: firstOut.length,
      p95Output: p95(outTokens),
      p95Input: p95(inTokens),
      meanStandardUsd: mean(std),
      ...(f.rebaseline ? { rebaseline: true } : {}),
    };
    const hPath = historyPath(dirname(ctx.runDir));
    const history = readHistory(hPath);
    const alert = canaryAlert(row, history);
    const out = [`Canary ${ctx.runId}${ctx.dry ? "  (DRY RUN: simulated answers; the history is not written)" : ""}`, ...alert.lines.map((l) => `  ${l}`)];
    if (!ctx.dry) {
      mkdirSync(dirname(hPath), { recursive: true });
      appendFileSync(hPath, JSON.stringify(row) + "\n");
      out.push(`  history: ${hPath}`);
      if (alert.alert) out.push(`  ALERT: ${alert.reasons.join("; ")}`);
    }
    out.push(...spendLines(ctx));
    for (const l of out) ctx.out(l);
    writeSummary(ctx, out.join("\n"), { part: "canary", simulated: ctx.dry, row, alert });
    writeManifest(ctx);
    if (ctx.stopReason() === "sigint") return 130;
    if (!ctx.dry && ctx.guard.stopped) return 2;
    return !ctx.dry && alert.alert ? 1 : 0;
  },
};
