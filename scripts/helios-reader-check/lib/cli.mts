// The check's command line (Helios Cut 2, step 13, 2026-09-25). DRY BY
// DEFAULT: nothing is read from .env.local and nothing leaves the machine
// unless --live is typed, with a --max-usd the run never passes.

export const USAGE = `Helios reader check (the chat's reader v2, spec §7.4)

  npx tsx scripts/helios-reader-check/run.mts                  dry run: the perfect reader, free
  npx tsx scripts/helios-reader-check/run.mts --dry-garbage    dry run: four wrong answers per phrase, free
  npx tsx scripts/helios-reader-check/run.mts --live --max-usd 0.50
                                                              check A: the real model, paid, the owner runs it

Flags
  --only A1,X54      only these phrases (a re-run of the failures costs cents; the blind phrases are skipped)
  --verbose          every phrase, not only the ones that fail
  --no-v1            live: skip v1's 53 audited readings (the before/after table)
  --env-file <path>  live: where OPENAI_API_KEY is (default: the checkout's .env.local)`;

export type Cli = {
  mode: "dry" | "garbage" | "live";
  maxUsd: number | null;
  only: string[] | null;
  verbose: boolean;
  v1: boolean;
  envFile: string | null;
  help: boolean;
};

/** The most a live run may be given: check A's cap is $0.50; this stops a typo like 50. */
export const MAX_USD_CEILING = 2;

export function parseCli(argv: readonly string[]): { ok: true; cli: Cli } | { ok: false; error: string } {
  const cli: Cli = { mode: "dry", maxUsd: null, only: null, verbose: false, v1: true, envFile: null, help: false };
  let live = false;
  let garbage = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) return null;
      i += 1;
      return v;
    };
    switch (a) {
      case "--help":
      case "-h":
        cli.help = true;
        break;
      case "--live":
        live = true;
        break;
      case "--dry-garbage":
        garbage = true;
        break;
      case "--spend":
        return { ok: false, error: "--spend is not this check's flag: a paid run is --live --max-usd <dollars>" };
      case "--max-usd": {
        const v = next();
        const n = v === null ? NaN : Number(v);
        if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "--max-usd needs an amount above 0, in dollars" };
        if (n > MAX_USD_CEILING) return { ok: false, error: `--max-usd ${n} is over $${MAX_USD_CEILING}; check A is capped at $0.50` };
        cli.maxUsd = n;
        break;
      }
      case "--only": {
        const v = next();
        const ids = (v ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (ids.length === 0) return { ok: false, error: "--only needs phrase ids, e.g. --only A1,X54" };
        cli.only = ids;
        break;
      }
      case "--verbose":
        cli.verbose = true;
        break;
      case "--no-v1":
        cli.v1 = false;
        break;
      case "--env-file": {
        const v = next();
        if (!v) return { ok: false, error: "--env-file needs a path" };
        cli.envFile = v;
        break;
      }
      default:
        return { ok: false, error: `unknown argument ${a}` };
    }
  }
  if (live && garbage) return { ok: false, error: "--live and --dry-garbage are two different runs" };
  if (live && cli.maxUsd === null) return { ok: false, error: "--live needs --max-usd <dollars>: the run stops before any call that could pass it" };
  if (!live && cli.maxUsd !== null) return { ok: false, error: "--max-usd is for a --live run; a dry run spends nothing" };
  if (!live && cli.envFile !== null) return { ok: false, error: "--env-file is for a --live run; a dry run reads no keys" };
  if (!live && !cli.v1) return { ok: false, error: "--no-v1 is for a --live run" };
  cli.mode = live ? "live" : garbage ? "garbage" : "dry";
  return { ok: true, cli };
}
