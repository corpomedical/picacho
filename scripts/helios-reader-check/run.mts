// The Helios reader check (Helios Cut 2, "Astra understands", step 13,
// 2026-09-25 — operator: "Run, keep going."; spec §6.4 and §7.4). See
// README.md in this folder.
//
//   npx tsx scripts/helios-reader-check/run.mts                   dry run, free
//   npx tsx scripts/helios-reader-check/run.mts --dry-garbage     dry run, free
//   npx tsx scripts/helios-reader-check/run.mts --live --max-usd 0.50
//                                                                check A, paid: the owner runs it
//
// DRY BY DEFAULT. Order matters, and is the point of this file: the
// arguments; then, only for --live, the one key (lib/env.mts); then the
// network guard (offline unless --live, and then only the reader's one
// address); and only then is any product module imported.
//
// Exit codes: 0 clean (every bar met, or the dry run's reader passed
// everything); 1 a bar or a dry-run check failed; 2 usage, a corpus or set
// problem, a precondition, or a live run that stopped early.

import { fileURLToPath } from "node:url";
import { parseCli, USAGE } from "./lib/cli.mts";
import { loadReaderKey } from "./lib/env.mts";
import { installReaderFence } from "./lib/net.mts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const parsed = parseCli(process.argv.slice(2));
if (!parsed.ok) {
  process.stderr.write(`usage error: ${parsed.error}\n\n${USAGE}\n`);
  process.exit(2);
}
if (parsed.cli.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}
const cli = parsed.cli;

let key: "shell" | "file" | "absent" | undefined;
if (cli.mode === "live") {
  const env = loadReaderKey(cli.envFile, REPO_ROOT);
  if (!env.ok) {
    process.stderr.write(`${env.error}\n`);
    process.exit(2);
  }
  key = env.key;
}

const net = installReaderFence(cli.mode === "live");

// Product code loads from here on, behind the guard.
let code: number;
try {
  const { main } = await import("./lib/main.mts");
  code = await main({ cli, net, key });
} catch (e) {
  process.stderr.write(`HARNESS ERROR: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.stderr.write(`network: ${net.liveCalls} live calls, ${net.blocked.length} blocked\n`);
  code = 2;
}
process.exit(code);
