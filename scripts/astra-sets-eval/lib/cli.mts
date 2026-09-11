// Arguments for the Astra Sets eval runner. Pure: parseCli never exits,
// prints or reads anything; run.mts turns an error into exit code 2.
//
// THE DEFAULT IS A DRY RUN. Money moves only with BOTH --spend and
// --max-usd <n>: one without the other is a usage error, and n must be a
// finite number above zero. B makes no API calls at all, so it takes
// neither; report reads files only.
//
// --photos is the photo arm (Sets from a photo): A and B on the location
// photos, D on the photos with people. Astra only, and background only —
// a photo in a Batch input file would be uploaded to OpenAI's Files
// storage, which the product never does — so --transport batch, the
// baselines, --probe and --escalate are refused beside it. This file loads
// before the network guard, so it cannot read SET_PHOTO_BUILD_EFFORT: the
// part settles the photo arm's default builder (common.mts resolveFlags).

export const PARTS = ["a", "b", "c", "d", "e", "canary"] as const;
export type Part = (typeof PARTS)[number];
export type Scope = Part | "report";

export const BUILDERS = ["astra-low", "astra-medium", "sonnet-5", "mini-5.4"] as const;
export type Builder = (typeof BUILDERS)[number];

export const ENGINES = ["gpt-image", "flux", "seedream"] as const;
export type Engine = (typeof ENGINES)[number];

/** Spend kinds an operator may acknowledge with --allow-unpriced. */
export const UNPRICED_KINDS = ["sonnet-5", "mini-5.4", "gates", "scorer", "drafter", "flux", "seedream"] as const;

export type Flags = {
  spend: boolean;
  maxUsd: number | null;
  runs: number | null;
  only: string[] | null;
  builders: Builder[];
  transport: "batch" | "background" | null;
  wordsGate: boolean;
  sonnetMode: "format" | "prompt";
  credits: number | null;
  fromRun: string | null;
  effort: "low" | "medium" | null;
  engines: Engine[];
  control: boolean;
  escalate: boolean;
  dCameras: number;
  raters: string[];
  seed: number | null;
  allowUnpriced: string[];
  probe: boolean;
  resume: string | null;
  out: string | null;
  envFile: string | null;
  chrome: string | null;
  acceptDrift: boolean;
  rebaseline: boolean;
  allowPartialCorpus: boolean;
  allowIncomplete: boolean;
  /** The photo arm: A and B on location-photos.json, D on people-photos.json. */
  photos: boolean;
  photoCredits: number | null;
  /** The flags written on the command line (the rest are defaults): --resume compares these with the original run. */
  given: string[];
};

export type Cli =
  | { cmd: "help" }
  | { cmd: "part"; part: Part; corpusDir: string; flags: Flags }
  | { cmd: "report"; runDirs: string[]; flags: Flags };

type Kind = "bool" | "int" | "num" | "str" | "list";
type Spec = { kind: Kind; scopes: readonly Scope[] };

const ALL: readonly Scope[] = [...PARTS, "report"];
const SPENDING: readonly Scope[] = ["a", "c", "d", "e", "canary"];

const SPECS: Record<string, Spec> = {
  "--spend": { kind: "bool", scopes: SPENDING },
  "--max-usd": { kind: "num", scopes: SPENDING },
  "--runs": { kind: "int", scopes: ["a", "d", "e"] },
  "--only": { kind: "list", scopes: ["a", "c", "d", "e", "canary"] },
  "--builders": { kind: "list", scopes: ["a"] },
  "--transport": { kind: "str", scopes: ["a", "d", "canary"] },
  "--no-words-gate": { kind: "bool", scopes: ["a"] },
  "--sonnet-mode": { kind: "str", scopes: ["a"] },
  "--credits": { kind: "int", scopes: ["report"] },
  "--from-run": { kind: "str", scopes: ["b", "c"] },
  "--effort": { kind: "str", scopes: ["c", "d"] },
  "--engines": { kind: "list", scopes: ["c"] },
  "--no-control": { kind: "bool", scopes: ["c"] },
  "--escalate": { kind: "bool", scopes: ["d"] },
  "--d-cameras": { kind: "int", scopes: ["d"] },
  // A writes the persons sheet for its own Astra specs (Part D's bar reads it).
  "--raters": { kind: "list", scopes: ["a", "b", "c", "d"] },
  "--seed": { kind: "int", scopes: ["a", "b", "c", "d"] },
  "--allow-unpriced": { kind: "list", scopes: SPENDING },
  "--probe": { kind: "bool", scopes: ["a", "c"] },
  "--resume": { kind: "str", scopes: ["a", "canary"] },
  "--out": { kind: "str", scopes: ALL },
  "--env-file": { kind: "str", scopes: ALL },
  "--chrome": { kind: "str", scopes: ["b", "c", "d"] },
  "--accept-drift": { kind: "bool", scopes: ["b", "c", "d"] },
  "--rebaseline": { kind: "bool", scopes: ["canary"] },
  "--allow-partial-corpus": { kind: "bool", scopes: SPENDING },
  "--allow-incomplete": { kind: "bool", scopes: ["report"] },
  "--photos": { kind: "bool", scopes: ["a", "b", "d"] },
  "--photo-credits": { kind: "int", scopes: ["report"] },
};

export const USAGE = `Astra Sets eval runner (docs/ASTRA_SETS.md section 4). Dry run unless --spend --max-usd <n>.

  npx tsx scripts/astra-sets-eval/run.mts <a|c|d|e|canary> <corpusDir> [flags]
  npx tsx scripts/astra-sets-eval/run.mts <a|d> <corpusDir> --photos [flags]
  npx tsx scripts/astra-sets-eval/run.mts b <corpusDir> --from-run <A runDir> [flags]
  npx tsx scripts/astra-sets-eval/run.mts report <runDir> [<runDir>...] [flags]

  --spend --max-usd <n>     real calls, never past n US dollars (both required, n > 0)
  --runs N                  a d e      runs per brief (default 3: section 4's "3 runs each")
  --only id,...             a c d e canary  a subset of corpus ids
  --builders ...            a          astra-low,astra-medium,sonnet-5,mini-5.4
  --transport batch|background   a d canary
  --no-words-gate           a          skip the gate on the builder's words
  --sonnet-mode format|prompt    a          structured output, or the schema in the system prompt
  --credits N               report     priced credits for A's cost bar
  --from-run <dir>          b c        sets come from an A run
  --effort low|medium       c d        which Astra arm's sets (c); D's build effort
  --engines ...             c          gpt-image,flux,seedream
  --no-control              c          skip the ordinary-render control arm
  --escalate                d          carry sessionPriorHits across briefs
  --d-cameras N             d          stills per delivered set (default 1)
  --raters a,b              a b c d    rater ids (default r1,r2)
  --seed N                  a b c d    shuffle seed (random by default, recorded in the key)
  --allow-unpriced kinds    spend      acknowledge metered or unpriced kinds (${UNPRICED_KINDS.join(", ")})
  --probe                   a c        the minimal real calls that settle the unknowns
  --resume <runDir>         a canary   replay the ledger and re-attach recorded batches (the run keeps its
                                       original --sonnet-mode, --no-words-gate, --raters, --seed, --builders,
                                       --runs, --only, --transport and --photos; a different value is refused)
  --out <dir>               all        default scripts/astra-sets-eval/out
  --env-file <path>         all        default <repo>/.env.local
  --chrome <path>           b c d      Chrome binary
  --accept-drift            b c d      run despite a failed mirror check (recorded)
  --rebaseline              canary     start a new canary baseline on purpose
  --allow-partial-corpus    spend      run with fewer rows than the eval asks for
  --allow-incomplete        report     import rating files with missing items
  --photos                  a b d      the photo arm: A and B on the location photos, D on the photos with
                                       people. Astra only (default: SET_PHOTO_BUILD_EFFORT's arm), background
                                       only: a photo never goes into a Batch input file
  --photo-credits N         report     priced credits for A's photo cost bar

Exit codes: 0 clean or every evaluated bar passed; 1 a bar failed or a canary alert;
2 usage, harness, budget abort or a bar that could not be determined; 130 interrupted.`;

function defaults(): Flags {
  return {
    spend: false,
    maxUsd: null,
    runs: null,
    only: null,
    builders: [...BUILDERS],
    transport: null,
    wordsGate: true,
    sonnetMode: "format",
    credits: null,
    fromRun: null,
    effort: null,
    engines: [...ENGINES],
    control: true,
    escalate: false,
    dCameras: 1,
    raters: ["r1", "r2"],
    seed: null,
    allowUnpriced: [],
    probe: false,
    resume: null,
    out: null,
    envFile: null,
    chrome: null,
    acceptDrift: false,
    rebaseline: false,
    allowPartialCorpus: false,
    allowIncomplete: false,
    photos: false,
    photoCredits: null,
    given: [],
  };
}

const list = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The flags that shape what a run does. --resume keeps the original run's
 * values: one not given again is taken from the run; one given with a
 * different value is refused (the mix would be recorded nowhere).
 */
export const BEHAVIOUR: readonly { flag: string; key: keyof Flags }[] = [
  { flag: "--sonnet-mode", key: "sonnetMode" },
  { flag: "--no-words-gate", key: "wordsGate" },
  { flag: "--raters", key: "raters" },
  { flag: "--seed", key: "seed" },
  { flag: "--builders", key: "builders" },
  { flag: "--runs", key: "runs" },
  { flag: "--only", key: "only" },
  { flag: "--transport", key: "transport" },
  { flag: "--rebaseline", key: "rebaseline" },
  { flag: "--photos", key: "photos" },
];

/** What the manifest records at the start of a run. */
export function behaviourOf(f: Flags): Record<string, unknown> {
  return Object.fromEntries(BEHAVIOUR.map((b) => [b.key, f[b.key]]));
}

/** The flags a --resume runs with: the original run's behaviour over the new command line. Pure. */
export function resumeFlags(f: Flags, original: Record<string, unknown> | undefined): { ok: true; flags: Flags } | { ok: false; error: string } {
  if (!original) return { ok: false, error: "--resume: this run's manifest has no behaviour record (it predates it); start a new run" };
  const clash = BEHAVIOUR.filter((b) => f.given.includes(b.flag) && JSON.stringify(f[b.key]) !== JSON.stringify(original[b.key]));
  if (clash.length) {
    return {
      ok: false,
      error: `--resume keeps the run's original ${clash.map((b) => `${b.flag} (${JSON.stringify(original[b.key])})`).join(", ")}; drop ${clash.length > 1 ? "those flags" : "the flag"} or start a new run`,
    };
  }
  const flags: Flags = { ...f };
  for (const b of BEHAVIOUR) if (b.key in original) (flags as Record<string, unknown>)[b.key] = original[b.key];
  return { ok: true, flags };
}

export function parseCli(argv: readonly string[]): { ok: true; cli: Cli } | { ok: false; error: string } {
  if (argv.length === 0) return { ok: false, error: "no part given" };
  if (argv.includes("--help") || argv.includes("-h")) return { ok: true, cli: { cmd: "help" } };
  const scope = argv[0] as Scope;
  if (!ALL.includes(scope)) return { ok: false, error: `unknown part "${argv[0]}" (expected ${ALL.join(", ")})` };

  const flags = defaults();
  const positionals: string[] = [];
  const seen = new Set<string>();
  const raw: Record<string, string | true> = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const spec = SPECS[arg];
    if (!spec) return { ok: false, error: `unknown flag ${arg}` };
    if (!spec.scopes.includes(scope)) {
      return { ok: false, error: `${arg} does not apply to ${scope} (only ${spec.scopes.join(", ")})` };
    }
    if (seen.has(arg)) return { ok: false, error: `${arg} given twice` };
    seen.add(arg);
    if (spec.kind === "bool") {
      raw[arg] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return { ok: false, error: `${arg} needs a value` };
    raw[arg] = value;
    i += 1;
  }

  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : null);
  const intOf = (k: string, min: number, max: number): number | null | string => {
    const v = str(k);
    if (v === null) return null;
    const n = Number(v);
    if (!/^-?\d+$/.test(v) || !Number.isInteger(n) || n < min || n > max) return `${k} needs a whole number from ${min} to ${max}`;
    return n;
  };

  flags.spend = raw["--spend"] === true;
  const maxUsd = str("--max-usd");
  if (maxUsd !== null) {
    const n = Number(maxUsd);
    if (!/^\d+(\.\d+)?$/.test(maxUsd.trim()) || !Number.isFinite(n) || n <= 0) {
      return { ok: false, error: "--max-usd needs a finite number of US dollars above 0" };
    }
    flags.maxUsd = n;
  }
  if (flags.spend && flags.maxUsd === null) return { ok: false, error: "--spend needs --max-usd <n>: a real run always carries its own ceiling" };
  if (!flags.spend && flags.maxUsd !== null) return { ok: false, error: "--max-usd without --spend: add --spend to make real calls, or drop --max-usd for a dry run" };

  for (const [k, min, max, set] of [
    ["--runs", 1, 10, (n: number) => (flags.runs = n)],
    ["--credits", 1, 50, (n: number) => (flags.credits = n)],
    ["--photo-credits", 1, 50, (n: number) => (flags.photoCredits = n)],
    ["--d-cameras", 1, 6, (n: number) => (flags.dCameras = n)],
    ["--seed", 0, 2 ** 31 - 1, (n: number) => (flags.seed = n)],
  ] as const) {
    const v = intOf(k, min, max);
    if (typeof v === "string") return { ok: false, error: v };
    if (v !== null) set(v);
  }

  const only = str("--only");
  if (only !== null) {
    flags.only = list(only);
    if (flags.only.length === 0) return { ok: false, error: "--only needs at least one id" };
  }
  const builders = str("--builders");
  if (builders !== null) {
    const b = list(builders);
    const bad = b.filter((x) => !(BUILDERS as readonly string[]).includes(x));
    if (bad.length || b.length === 0) return { ok: false, error: `--builders: unknown ${bad.join(", ") || "(empty)"} (expected ${BUILDERS.join(", ")})` };
    flags.builders = [...new Set(b)] as Builder[];
  }
  const transport = str("--transport");
  if (transport !== null) {
    if (transport !== "batch" && transport !== "background") return { ok: false, error: "--transport is batch or background" };
    flags.transport = transport;
  }
  flags.wordsGate = raw["--no-words-gate"] !== true;
  const sonnetMode = str("--sonnet-mode");
  if (sonnetMode !== null) {
    if (sonnetMode !== "format" && sonnetMode !== "prompt") return { ok: false, error: "--sonnet-mode is format or prompt" };
    flags.sonnetMode = sonnetMode;
  }
  flags.fromRun = str("--from-run");
  const effort = str("--effort");
  if (effort !== null) {
    if (effort !== "low" && effort !== "medium") return { ok: false, error: "--effort is low or medium" };
    flags.effort = effort;
  }
  const engines = str("--engines");
  if (engines !== null) {
    const e = list(engines);
    const bad = e.filter((x) => !(ENGINES as readonly string[]).includes(x));
    if (bad.length || e.length === 0) return { ok: false, error: `--engines: unknown ${bad.join(", ") || "(empty)"} (expected ${ENGINES.join(", ")})` };
    flags.engines = [...new Set(e)] as Engine[];
  }
  flags.control = raw["--no-control"] !== true;
  flags.escalate = raw["--escalate"] === true;
  const raters = str("--raters");
  if (raters !== null) {
    const r = [...new Set(list(raters))];
    if (r.length < 2) return { ok: false, error: "--raters needs at least two distinct rater ids: every bar that uses ratings needs two raters" };
    if (r.some((x) => !/^[A-Za-z0-9_-]{1,20}$/.test(x))) return { ok: false, error: "--raters: ids are letters, digits, - and _ (at most 20)" };
    flags.raters = r;
  }
  const allow = str("--allow-unpriced");
  if (allow !== null) {
    const a = list(allow);
    const bad = a.filter((x) => !(UNPRICED_KINDS as readonly string[]).includes(x));
    if (bad.length) return { ok: false, error: `--allow-unpriced: unknown ${bad.join(", ")} (expected ${UNPRICED_KINDS.join(", ")})` };
    flags.allowUnpriced = a;
  }
  flags.probe = raw["--probe"] === true;
  flags.resume = str("--resume");
  if (flags.resume !== null && !flags.spend) return { ok: false, error: "--resume continues a real run: it needs --spend --max-usd <n>" };
  if (flags.resume !== null && flags.probe) return { ok: false, error: "--resume and --probe cannot be combined" };
  flags.out = str("--out");
  flags.envFile = str("--env-file");
  flags.chrome = str("--chrome");
  flags.acceptDrift = raw["--accept-drift"] === true;
  flags.rebaseline = raw["--rebaseline"] === true;
  flags.allowPartialCorpus = raw["--allow-partial-corpus"] === true;
  flags.allowIncomplete = raw["--allow-incomplete"] === true;
  flags.photos = raw["--photos"] === true;
  if (flags.photos) {
    if (flags.transport === "batch") {
      return { ok: false, error: "--photos runs in background only: a photo in a Batch input file would be uploaded to OpenAI's Files storage, which the product never does" };
    }
    const baselines = seen.has("--builders") ? flags.builders.filter((b) => b === "sonnet-5" || b === "mini-5.4") : [];
    if (baselines.length) {
      return { ok: false, error: `--photos builds on Astra only (section 4 bars photo builds on Astra's cost; the baselines are words-only): drop ${baselines.join(", ")}` };
    }
    if (flags.probe) return { ok: false, error: "--photos and --probe cannot be combined: the probe asks about Batch and the baselines, and a photo build uses neither" };
    if (flags.escalate) return { ok: false, error: "--photos and --escalate cannot be combined: the photo leg judges each photo on its own" };
  }
  flags.given = [...seen];

  if (scope === "report") {
    if (positionals.length === 0) return { ok: false, error: "report needs at least one run directory" };
    return { ok: true, cli: { cmd: "report", runDirs: positionals, flags } };
  }
  if (positionals.length !== 1) {
    return { ok: false, error: `${scope} needs exactly one corpus directory (got ${positionals.length} positional arguments)` };
  }
  return { ok: true, cli: { cmd: "part", part: scope, corpusDir: positionals[0], flags } };
}
