// The Astra Sets eval runner (docs/ASTRA_SETS.md, section 4: parts A–E and
// the canary). Operator-run; see README.md in this folder.
//
//   npx tsx scripts/astra-sets-eval/run.mts <a|b|c|d|e|canary> <corpusDir> [flags]
//   npx tsx scripts/astra-sets-eval/run.mts report <runDir> [<runDir>...]
//
// DRY RUN BY DEFAULT: the network guard is offline, the plan and its ceiling
// are printed, and a few items run through fakes. Money moves only with
// --spend --max-usd <n>, and never past n.
//
// Order matters here, and is the whole point of this file: arguments, then
// the env allowlist (only the three API keys and OPENAI_MODEL; every
// Supabase variable deleted; a gpt-6 OPENAI_MODEL refused), then the
// network guard — and only then is any product module imported.
//
// Exit codes: 0 clean, or every evaluated bar passed; 1 a bar failed or a
// canary alert; 2 usage, harness, budget abort, or a bar that could not be
// determined; 130 interrupted.

import { parseCli, USAGE } from "./lib/cli.mts";
import { loadEvalEnv } from "./lib/env.mts";
import { installNetGuard } from "./lib/net-guard.mts";
import { HarnessError, REPO_ROOT } from "./lib/util.mts";

const parsed = parseCli(process.argv.slice(2));
if (!parsed.ok) {
  process.stderr.write(`usage error: ${parsed.error}\n\n${USAGE}\n`);
  process.exit(2);
}
if (parsed.cli.cmd === "help") {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}
const cli = parsed.cli;

const env = loadEvalEnv(cli.flags.envFile, REPO_ROOT);
if (!env.ok) {
  process.stderr.write(`${env.error}\n`);
  process.exit(2);
}

const net = installNetGuard(cli.cmd === "part" && cli.flags.spend ? "live" : "offline");

// Product code loads from here on, behind the guard.
let code: number;
try {
  const { main } = await import("./lib/main.mts");
  code = await main({ cli, net, presence: env.presence, envFile: env.file });
} catch (e) {
  // Anything that escapes a part is a harness problem: exit 2, never 1.
  const harness = e instanceof HarnessError;
  process.stderr.write(`${harness ? "STOPPED" : "HARNESS ERROR"}: ${e instanceof Error ? (harness ? e.message : (e.stack ?? e.message)) : String(e)}\n`);
  process.stderr.write(`network: ${net.liveCalls} live calls, ${net.blocked.length} blocked\n`);
  code = harness ? e.exitCode : 2;
}
process.exit(code);
