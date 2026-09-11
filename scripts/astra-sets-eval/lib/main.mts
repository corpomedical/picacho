// Everything after the network guard: the price book, the corpus, the run
// directory and manifest, the money fence, the plan check, the mirror
// checks, Ctrl-C, and the part itself. run.mts imports this only once the
// guard is installed, so no product module loads before the fence is up.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cancelAstraJob } from "../../../src/lib/generations/providers/astra.ts";
import type { Cli, Part } from "./cli.mts";
import { loadCorpus, corpusSummary } from "./corpus.mts";
import { makeRunDir, writeManifest, type Gates, type RunContext } from "./context.mts";
import type { Presence } from "./env.mts";
import { docLineOf, gitState, promptFingerprint, srcHashes } from "./fingerprint.mts";
import { Ledger } from "./ledger.mts";
import { withNetContext, type NetGuard } from "./net-guard.mts";
import { formatPlan } from "./plan.mts";
import { BATCH_DOC_SENTENCE, makePriceBook, validateExternalPrices } from "./prices.mts";
import { checkPlan, SpendGuard } from "./spend-guard.mts";
import { EVAL_DIR, HarnessError, newRunId, REPO_ROOT, usd } from "./util.mts";
import { evalSafetyId } from "./builders.mts";
import { makeBriefGate, makeWordsJudge } from "./words-gate.mts";
import { ConfigAbort } from "./build-flow.mts";
import { checkViewerParity } from "../render/viewer-parity.mts";
import type { PartModule } from "../parts/common.mts";
import { partA } from "../parts/a.mts";
import { partB, readRun } from "../parts/b.mts";
import { partC } from "../parts/c.mts";
import { partD } from "../parts/d.mts";
import { partE } from "../parts/e.mts";
import { partCanary } from "../parts/canary.mts";
import { runReport } from "../parts/report.mts";

const PARTS: Record<Part, PartModule> = { a: partA, b: partB, c: partC, d: partD, e: partE, canary: partCanary };

const out = (line = "") => process.stdout.write(line + "\n");
const progress = (msg: string) => process.stderr.write(`  ${msg}\n`);

/** Which keys a real run of each part needs (presence only; values never leave process.env). */
const NEEDS_KEYS: Record<Part, ("OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "FAL_KEY")[]> = {
  a: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
  b: [],
  c: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "FAL_KEY"],
  d: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
  e: ["OPENAI_API_KEY"],
  canary: ["OPENAI_API_KEY"],
};

export async function main(o: { cli: Exclude<Cli, { cmd: "help" }>; net: NetGuard; presence: Presence; envFile: string | null }): Promise<number> {
  const { cli, net } = o;
  const f = cli.flags;
  const outRoot = resolve(f.out ?? join(EVAL_DIR, "out"));

  const ext = validateExternalPrices(JSON.parse(readFileSync(join(EVAL_DIR, "external-prices.json"), "utf8")));
  if (!ext.ok) {
    process.stderr.write(`external-prices.json:\n${ext.problems.map((p) => `  ${p}`).join("\n")}\n`);
    return 2;
  }
  // IMAGE_COST_USD lives in a module that needs the "@/" alias (tsx resolves it).
  const { IMAGE_COST_USD } = await import("../../../src/lib/admin/economics.ts");
  const book = makePriceBook({ external: ext.prices, gptImageUsd: IMAGE_COST_USD });

  if (cli.cmd === "report") {
    const code = await runReport({ runDirs: cli.runDirs.map((d) => resolve(d)), flags: f, book, repoRoot: REPO_ROOT, outRoot, out });
    out(`network: ${net.liveCalls} live calls, ${net.blocked.length} blocked`);
    return code;
  }

  const part = cli.part;
  const mod = PARTS[part];
  const corpusDir = resolve(cli.corpusDir);
  const needs = mod.needs({ flags: f });
  const corpus = loadCorpus(corpusDir, { spend: f.spend, allowPartial: f.allowPartialCorpus, needs, photos: needs.photos });
  out(corpusSummary(corpus));
  if (!corpus.ok) return 2;

  if (f.spend) {
    const missing = NEEDS_KEYS[part].filter((k) => o.presence[k] === "absent");
    if (missing.length) {
      out(`a real ${part} run needs ${missing.join(" and ")} (from the shell or the env file); nothing was called`);
      return 2;
    }
  }

  // B never spends; it is a real run only when it draws a real A run.
  let dry = !f.spend;
  if (part === "b") dry = !f.fromRun || readRun(resolve(f.fromRun)).manifest.simulated === true;

  let runId: string;
  let runDir: string;
  let manifest: Record<string, unknown>;
  if (f.resume) {
    runDir = resolve(f.resume);
    const old = readRun(runDir).manifest;
    if (old.part !== part) throw new HarnessError(`--resume ${f.resume} is a ${String(old.part)} run, not ${part}`);
    if (old.mode !== "spend") throw new HarnessError("--resume continues a real run; this one was a dry run");
    if ((old.corpus as { hash?: string } | undefined)?.hash !== corpus.corpusHash) throw new HarnessError("--resume: the corpus changed since this run started");
    runId = String(old.runId);
    manifest = { ...old, resumedAt: [...((old.resumedAt as string[]) ?? []), new Date().toISOString()] };
  } else {
    runId = newRunId(part, dry);
    runDir = makeRunDir(outRoot, runId);
    manifest = {};
  }
  const replay = f.resume ? Ledger.read(join(runDir, "ledger.jsonl")) : [];
  const ledger = new Ledger(join(runDir, "ledger.jsonl"));
  const guard = new SpendGuard({ maxUsd: dry ? 1e9 : (f.maxUsd as number), sink: (e) => ledger.append(e), replay });

  net.onMeter = (m) =>
    guard.meter({
      host: m.host,
      model: m.model,
      usage: m.usage,
      usd: book.modelCost(m.model, m.usage, m.host === "api.anthropic.com" ? "anthropic" : "openai"),
      ...(m.ctx.tag ? { tag: m.ctx.tag } : {}),
      ...(m.ctx.ref ? { ref: m.ctx.ref } : {}),
    });

  Object.assign(manifest, {
    runId,
    part,
    argv: process.argv.slice(2),
    mode: dry ? "dry" : "spend",
    simulated: dry,
    createdAt: manifest.createdAt ?? new Date().toISOString(),
    git: gitState(REPO_ROOT),
    srcHashes: srcHashes(REPO_ROOT),
    promptFingerprint: promptFingerprint(),
    corpus: { dir: corpusDir, hash: corpus.corpusHash, hashes: corpus.hashes, attested: corpus.data.meta.attested, template: corpus.template },
    prices: book.snapshot(),
    batchDocSentenceLine: docLineOf(REPO_ROOT, BATCH_DOC_SENTENCE),
    env: { presence: o.presence, file: o.envFile },
    transport: f.transport,
    evalSafetyId: evalSafetyId(part),
    probe: f.probe,
    maxUsd: f.maxUsd,
    ...(f.seed !== null ? { seed: f.seed } : {}),
  });

  let gates: Gates | null = null;
  if (!dry && (part === "a" || part === "d")) {
    const cp = await import("../../../src/lib/generations/content-policy.ts");
    const refusalReason = (e: unknown) => (e instanceof cp.ContentPolicyRefusal ? e.reason : null);
    const onOddError = (ref: string, e: unknown) => progress(`gate error on ${ref}: ${e instanceof Error ? e.name : "error"} (counted as unavailable)`);
    gates = {
      words: makeWordsJudge({ assertPromptAllowed: cp.assertPromptAllowed, refusalReason, onOddError }),
      brief: makeBriefGate({ assertPromptAllowed: cp.assertPromptAllowed, refusalReason, onOddError }),
    };
  }

  let stopReason: string | null = null;
  const inflight = new Set<string>();
  const ctx: RunContext = {
    part,
    runId,
    runDir,
    dry,
    flags: f,
    corpusDir,
    repoRoot: REPO_ROOT,
    net,
    book,
    guard,
    ledger,
    corpus,
    gates,
    manifest,
    inflight,
    stopping: () => stopReason !== null || guard.stopped !== null,
    interrupted: () => stopReason === "sigint",
    requestStop: (r) => {
      stopReason ??= r;
    },
    stopReason: () => stopReason,
    out,
    progress,
  };

  out(`run ${runId}  ${dry ? "DRY RUN: the network guard is offline; nothing is called" : `REAL RUN: at most ${usd(f.maxUsd, 2)}`}`);
  out(`  directory ${runDir}`);
  const plan = mod.plan(ctx);
  manifest.plan = plan;
  if ("blocked" in plan) out(`--- ${part.toUpperCase()} --- ${plan.blocked}`);
  else out(formatPlan(plan.title, plan.lines));
  for (const n of plan.notes) out(`  note: ${n}`);

  if (!dry && "lines" in plan) {
    const check = checkPlan(plan.lines, f.maxUsd as number, f.allowUnpriced);
    manifest.planCheck = check;
    if (!f.resume) ledger.append({ ev: "plan", ceilingUsd: check.ceilingUsd, maxUsd: f.maxUsd as number, unpriced: check.unpriced });
    if (!check.ok) {
      if (check.excessUsd > 0) out(`ABORT: the ceiling ${usd(check.ceilingUsd, 2)} is over --max-usd ${usd(f.maxUsd, 2)} by ${usd(check.excessUsd, 2)}`);
      if (check.unacknowledged.length) out(`ABORT: unpriced kinds not acknowledged: ${check.unacknowledged.join(", ")} (fill external-prices.json, or pass --allow-unpriced ${check.unacknowledged.join(",")})`);
      out("nothing was called");
      ledger.close();
      writeManifest(ctx);
      return 2;
    }
  }

  if (part === "b" || part === "c") {
    const parity = checkViewerParity(REPO_ROOT);
    manifest.viewerParity = { ...parity, acceptedDrift: !parity.ok && f.acceptDrift };
    if (!parity.ok) {
      out(`set-view.tsx no longer has ${parity.missing.length} line(s) the snapshot page mirrors:`);
      for (const l of parity.missing) out(`  ${l}`);
      if (!f.acceptDrift) {
        out("the snapshot page may no longer draw what the product draws: update render/snap-page.html and render/viewer-parity.mts, or pass --accept-drift (recorded)");
        ledger.close();
        writeManifest(ctx);
        return 2;
      }
    }
  }

  let interrupts = 0;
  const onSigint = () => {
    interrupts += 1;
    if (interrupts > 1) process.exit(130);
    stopReason = "sigint";
    if (!dry) guard.stop("sigint");
    process.stderr.write("\n  interrupt: no new work starts; cancelling background builds in flight (Ctrl-C again to quit at once)\n");
    for (const id of inflight) void withNetContext({ settled: true, tag: "cancel" }, () => cancelAstraJob(id));
  };
  process.on("SIGINT", onSigint);

  let code: number;
  try {
    code = await mod.run(ctx);
  } catch (e) {
    if (e instanceof HarnessError || e instanceof ConfigAbort) {
      out(`STOPPED: ${e.message}`);
      if (e instanceof ConfigAbort) guard.stop("config");
      code = e instanceof HarnessError ? e.exitCode : 2;
    } else {
      out(`HARNESS ERROR: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      code = 2;
    }
  } finally {
    process.off("SIGINT", onSigint);
    manifest.endedAt = new Date().toISOString();
    manifest.network = { liveCalls: net.liveCalls, blocked: net.blocked };
    ledger.close();
    writeManifest(ctx);
  }
  out(`network: ${net.liveCalls} live calls, ${net.blocked.length} blocked${net.blocked.length ? ` (${[...new Set(net.blocked.map((b) => b.host))].join(", ")})` : ""}`);
  if (stopReason === "sigint") return 130;
  return code;
}
