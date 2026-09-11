# Astra Sets eval runner

The operator-run eval from `docs/ASTRA_SETS.md` section 4 ("The eval"): parts A–E and the Canary. Sets open to paid plans (`SETS_OPEN_TO_PLANS` in `src/lib/sets/set-config.ts`) only after A–D pass.

**Every command is a dry run unless it says `--spend --max-usd <n>`.** A dry run calls nothing: the network guard is offline, the plan and its ceiling are printed, and a few items run through fakes built from the product's own recorded Astra sets. Every run ends with a line like `network: 0 live calls, 0 blocked`.

## What is built, and what is not yet

| Part | Built now | Not yet |
|---|---|---|
| A. Validity and cost | Everything: Astra low and medium on Batch (or background), claude-sonnet-5 and gpt-5.4-mini, the words gate, `--probe`, `--resume` | Anthropic Message Batches for Sonnet (it runs synchronously) |
| B. Fidelity | Everything: first-camera snapshots in local Chrome, blind sheets, the bar in `report` | — |
| C. Stills | The plan, the frames, the exact shot prompts, the drift checks, the bars, sample sheets | **The engine leg** (the stills, their gates and identity scores): `c --spend` stops before any call |
| D. Safety | Brief gate → Astra build → words gate → persons sheet; the bar in `report` | **The stills leg**: a harmful brief that gets a set ends UNDETERMINED. The 10 location photos with people wait for Phase 2 |
| E. Match | The EXIF field-of-view maths and the bar | Everything that calls a model: Astra takes text only until Phase 2, and `match-shot.ts` does not exist |
| Canary | Everything; history in `out/canary/history.jsonl` | Weekly scheduling (launchd or cron) |

## The rails (mechanical, not by convention)

- **Secrets.** From `.env.local` the runner takes only `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `FAL_KEY` and `OPENAI_MODEL` (the shell wins). Every `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*` and `OPENAI_SAFETY_ID_SECRET` is deleted from the process. An `OPENAI_MODEL` starting `gpt-6` stops the run. Nothing prints a key; the manifest records only which keys were present.
- **Network.** Every `fetch` and `WebSocket` goes through a guard installed before any product code loads. Live calls go only to `api.openai.com`, `api.anthropic.com`, `fal.run`, `queue.fal.run` and `*.fal.media` (downloads only), and only with `--spend`. Everything else is blocked by name, the database included. Chrome runs with every host but 127.0.0.1 unresolvable and its background traffic off.
- **No database.** The runner never uses `gatePrompt` or `recordPolicyRefusal`; it calls `assertPromptAllowed` directly. No refusal is logged anywhere.
- **The model id.** Only `src/lib/generations/providers/astra.ts` names it. The runner imports it; `lib/no-model-literal.test.mts` fails the suite if any file here contains it.
- **Money.** Every call is reserved at its worst case before it is sent and settled from the usage that comes back. The run stops starting work the moment the next reservation would pass `--max-usd`. Everything goes to an append-only ledger. The one upload is Batch's input file (blind briefs only); if that is too much, use `--transport background` (standard price, so the ceiling doubles).
- **Safety identifier.** `sha256("picacho:eval:astra-sets:v1:" + part)`: the production shape, no secret, no real account, fixed per part.

## Before any money is spent (operator steps)

1. **Read the prices the repo does not have** and write them into `scripts/astra-sets-eval/external-prices.json`, each with its page and the date you read it. Until then those calls are "unpriced": they are metered, not reserved, and a real run must name them with `--allow-unpriced`.
   - claude-sonnet-5: https://claude.com/pricing
   - gpt-5.4-mini and gpt-5.4: https://developers.openai.com/api/docs/pricing
   - FLUX.2 Pro edit and Seedream v4 edit: fal's model pages (for C, later)
2. **Get the corpus written blind** by someone who has not read the builder's instructions, the schema, `docs/` or any prompt. Give them the folder `scripts/astra-sets-eval/corpus-template/` and its `WRITER.md`. Keep the finished corpus **outside the repo**, for example:

   ```
   mkdir -p ~/picacho-eval
   cp -R scripts/astra-sets-eval/corpus-template ~/picacho-eval/astra-sets-corpus
   ```

3. **Characters for C** (later): confirm consent, or create two AI personas. Export their identity photo and saved traits into the corpus (`characters.json`, `characters/<id>/identity.jpg`).
4. **Optional baselines** for C: a read-only export of the same characters' ordinary-render identity scores and the strict-lane output-gate refusal counts, into `baselines.json`. The runner never reads production.
5. **Choose two raters.** Each gets only their own sheet folder, never `keys/`.
6. **Run the probes** (below) before any large spend.
7. **Optional, after an in-app D pass:** read `policy_refusals` to confirm that no model-written text was counted against the person (the runner checks this by construction; it cannot read production).

## Commands

Run from the repo root. From a git worktree, add `--env-file <the main checkout>/.env.local` to every command (a worktree has no `.env.local`). First, point `C` at your corpus folder:

```
C=~/picacho-eval/astra-sets-corpus
```

### Dry runs (free, no network)

```
npx tsx scripts/astra-sets-eval/run.mts a scripts/astra-sets-eval/corpus-template
npx tsx scripts/astra-sets-eval/run.mts b scripts/astra-sets-eval/corpus-template
npx tsx scripts/astra-sets-eval/run.mts c scripts/astra-sets-eval/corpus-template
npx tsx scripts/astra-sets-eval/run.mts d scripts/astra-sets-eval/corpus-template
npx tsx scripts/astra-sets-eval/run.mts e scripts/astra-sets-eval/corpus-template
npx tsx scripts/astra-sets-eval/run.mts canary scripts/astra-sets-eval/corpus-template
npx tsx scripts/astra-sets-eval/run.mts a scripts/astra-sets-eval/corpus-template --probe
```

B and C draw sets in a local Chrome; everything else runs in Node.

### Probes (the unknowns, a few cents to a few dimes)

`a --probe` sends one Batch line, one gpt-5.4-mini build and one claude-sonnet-5 build. It tells you whether Batch accepts the product's Astra request and whether both baselines accept the strict schema:

```
npx tsx scripts/astra-sets-eval/run.mts a "$C" --probe --spend --max-usd 1 --allow-unpriced sonnet-5,mini-5.4
```

If Sonnet's `format` line says REJECTED, run A with `--sonnet-mode prompt`. The Batch line can take minutes to hours: the runner polls every 60 s, and Ctrl-C leaves it running (`--resume` re-attaches).

### A (validity and cost)

```
npx tsx scripts/astra-sets-eval/run.mts a "$C" --spend --max-usd 110 --allow-unpriced sonnet-5,mini-5.4,gates
```

If it is interrupted, or a Batch round is still running:

```
npx tsx scripts/astra-sets-eval/run.mts a "$C" --resume scripts/astra-sets-eval/out/<the A run> --spend --max-usd 110 --allow-unpriced sonnet-5,mini-5.4,gates
```

### B (fidelity, no API spend)

```
npx tsx scripts/astra-sets-eval/run.mts b "$C" --from-run scripts/astra-sets-eval/out/<the A run>
```

It prints one sheet per rater (`sheets/<sheetId>/index.html`). Send each rater their folder. They open `index.html` in any browser, rate, and press **Save ratings**. Put the files they send back in `<the B run>/ratings/`.

### D (safety, text leg)

```
npx tsx scripts/astra-sets-eval/run.mts d "$C" --spend --max-usd 50 --allow-unpriced gates
npx tsx scripts/astra-sets-eval/run.mts d "$C" --spend --max-usd 50 --allow-unpriced gates --escalate
```

The second pass carries `sessionPriorHits` from brief to brief, like an escalating attacker. A and D each write a persons sheet (`d-persons`): both go to the raters, and the ratings go in each run's `ratings/`.

### Canary (weekly)

```
npx tsx scripts/astra-sets-eval/run.mts canary "$C" --spend --max-usd 3
```

### Report (reads files only)

```
npx tsx scripts/astra-sets-eval/run.mts report scripts/astra-sets-eval/out/<A> scripts/astra-sets-eval/out/<B> scripts/astra-sets-eval/out/<D>
```

It imports the ratings, prints one line per bar (value, threshold, n, arithmetic), the spend picture, and the release line `SETS_OPEN_TO_PLANS needs A–D PASS: A ✓ B ✓ C ? D ✓`. `--credits N` prices A's cost bar (default `ceil(worst first attempt / $0.28)` = 2).

## Spend (the dry run prints the live numbers; if they differ from this table, the dry run is right)

Worst cases come from `src/lib/astra/prices.ts` over the caps in `set-config.ts`: a first attempt is 2,400 input tokens at the cache-write rate plus 10,000 output tokens = $0.53; the closing retry is 10,000 input + 10,000 output = $0.625; a build is $1.155. Batch halves the billed price (`docs/ASTRA_SETS.md` §1.2). GPT Image 2 is `IMAGE_COST_USD` = $0.17 (`src/lib/admin/economics.ts`), reserved twice per still (`GENERATE_RETRIES` = 2 in `pipeline.ts`).

| Part | Priced ceiling | Unpriced until `external-prices.json` is filled (metered either way) |
|---|---|---|
| A: 30 briefs × 3 runs × Astra low and medium, Batch | 180 × $1.155 × 0.5 = $103.95 | Sonnet 5 and mini: 180 builds × up to 2 attempts; words gate up to 720 judgements |
| B | $0 | — |
| C (engine leg not built) | GPT Image 80 × 2 × $0.17 = $27.20 reserved | FLUX, Seedream, gates, scores, drafts |
| D: 40 briefs, background (standard), text leg | 40 × $1.155 = $46.20 | brief gate 40, words gate up to 80 |
| Canary: 10 first attempts, Batch | 10 × $0.53 × 0.5 = $2.65 | — |
| `a --probe` | $0.53 × 0.5 = $0.265 | 1 mini and 1 Sonnet build |

Expected, not a ceiling: the Astra-low arm of A at the measured ≤ $0.33 a build (`set-config.ts` header, 8 builds) × 90 × 0.5 ≈ $14.85, plus mends for about 1 build in 8. Medium effort has never been measured.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | clean, or every evaluated bar passed |
| 1 | a bar failed, or a canary alert |
| 2 | usage, harness, budget abort, or a bar that could not be determined |
| 130 | interrupted (Ctrl-C). Background builds in flight are cancelled; Batch rounds keep running, to be resumed |

## What a run writes

`scripts/astra-sets-eval/out/<part>-<YYYYMMDD-HHMMSS UTC>-<rand>[-DRYRUN]/` (ignored by git):

- `manifest.json`: arguments, mode, git HEAD and dirty files, hashes of every product file used, the prompt fingerprint, the corpus hash, prices, key presence, the plan, the network counts
- `ledger.jsonl`: every reservation, settlement and metered call (token usage only)
- `results.jsonl`, `answers/`, `specs/`, `frames/`, `batches.json`, `state.json`
- `sheets/` (for raters), `keys/` (never share), `ratings/` (what raters send back)
- `summary.txt`, `summary.json`

Progress on stderr shows ids only, never a brief. Sheets that show consented people's photos stay on this machine.

## Known gaps

- Snapshots render with swiftshader, not a GPU, at pixel ratio 1 on a square canvas. The lift chosen for each set is recorded. A pose that the live viewer's orbit limits would have moved is flagged.
- The eval's copy of production's build flow has `stale` always false, because a Batch round can take hours. It retries the words gate twice when the gate is unavailable, then flags the build UNJUDGED.
- The identity scorer sets no temperature or seed. Sizing its noise (rescoring a subset) is left for later.
- The corpus is spent once the builder's instructions are tuned against it. Every run records the prompt fingerprint and the corpus hash, so a rerun on changed instructions shows.

## Checks

```
npx tsc -p scripts/astra-sets-eval
npx vitest run scripts/astra-sets-eval
npx eslint scripts/astra-sets-eval
```

The runner is `.mts` on purpose. The root `tsconfig.json` checks `**/*.ts`, so an eval tool can never block `npm run verify` or a deploy. The local `tsconfig.json` type-checks it separately. Vitest and ESLint pick it up as usual.
