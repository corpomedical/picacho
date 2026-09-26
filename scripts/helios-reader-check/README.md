# Helios reader check

Check A from Helios Cut 2, "Astra understands" (spec v2 §7.4). It reads the phrase corpus with the chat's new reader (v2), the way a set's page would. Every answer then goes through the page's own code: `parseShotReading`, `planTurn`, `shootDecision`, and the reply in the phrase's own language. The results are graded by code, never by a model.

**It is dry by default.** Nothing is read from `.env.local` and nothing leaves the machine unless you type `--live` with a `--max-usd` cap.

## The three runs

```
npx tsx scripts/helios-reader-check/run.mts                   # dry run: the perfect reader (free)
npx tsx scripts/helios-reader-check/run.mts --dry-garbage     # dry run: four wrong answers per phrase (free)
npx tsx scripts/helios-reader-check/run.mts --live --max-usd 0.50
                                                              # check A: the real model (paid, the owner runs it)
```

- **The dry run.** For each phrase, it builds the model's answer from the phrase's own `expected` block, as a perfect reader would answer. That answer is then parsed, planned, composed and graded, so the corpus, the three sets, the grader and every reply string in all four languages are checked against each other. It says nothing about how the real model reads; only check A tests that. The run then prints the plan a live run would make (the calls, each call's worst case, the ceiling) and ends with `network: 0 live calls, 0 blocked`.
- **`--dry-garbage`.** Every phrase gets four fixed wrong answers:
  - a person swap with a shot;
  - words the person never wrote;
  - a film stock sent as a lens, plus an undo;
  - prose instead of JSON.

  Every hard gate an answer should trip must fire, and no wrong answer may pass. This tests the grader against a bad reader.
- **`--live --max-usd n` (check A).** This is the real model, in this order:
  1. v2 on the 108 corpus phrases;
  2. v2 on the 20 blind phrases;
  3. v1 on the 53 audited phrases, for the before/after table.

  It makes one call at a time. Each call is reserved at its worst case before it is sent and settled from the usage it reports, and the run stops before any call whose worst case could pass `n`.

Other flags:
- `--only A1,X54` runs just those phrases. A re-run of only the failures costs cents, and it skips the blind phrases.
- `--verbose` prints every phrase, not only the failures.
- `--no-v1` skips the before/after readings.
- `--env-file <path>` says where the key is.

## Check A: before you run it (spec §7.4)

1. **Cut 2 is merged,** and this folder's dry run ends with `network: 0 live calls, 0 blocked`.
2. **The 20 blind phrases exist.**
   - Copy `blind-corpus.template.json` to `blind-corpus.json`.
   - Someone who has not read the reader's instructions, the spec or `corpus.json` writes the phrases and puts their name in `author`.
   - Someone else can add expectations afterwards, from the phrase alone, and puts their name in `expectationsBy`.
   - A phrase with no expectations is still held to every hard gate.
   - The live run refuses to start with fewer than 20 phrases (unless `--only` is used).
3. **The OpenAI balance has room.** The content gates draw on the same balance and fail closed (it ran dry on 15 and 19 September).
4. **The price is fresh.**
   - Re-read <https://developers.openai.com/api/docs/models/gpt-5.4-mini> and write the three rates and today's date into `prices.json`.
   - The live run refuses a price read more than 7 days ago.
   - The rates in the file were read on 2026-09-25: $0.75 input, $0.075 cached input and $4.50 output, per 1M tokens.

The sit/lean proof stills (`SET_POSE_WORDS_OPEN`) are **not** a precondition. They change the still's prompt, not the reader (check of the spec, item 2).

Then, from the main checkout (the only place with `.env.local`):

```
npx tsx scripts/helios-reader-check/run.mts --live --max-usd 0.50
```

It reads only `OPENAI_API_KEY`. It deletes every Supabase variable and the Anthropic and fal keys from the process. The only address it can reach is `POST https://api.openai.com/v1/chat/completions`.

## What it costs (from the dry run's plan, prices of 2026-09-25)

- **Worst case per call:** the input counted at 2.5 characters per token with nothing cached, plus the whole answer cap. That is 600 tokens for v2 and 400 for v1; hidden reasoning counts against the cap.
  - v2: about $0.0047–0.0048 per call.
  - v1: about $0.0025 per call.
- **Ceiling:** about $0.74 ($0.7389 on the 108 phrases) if every call hit its worst case, which is above the $0.50 cap.
- **Typical:** about $0.26 in all (128 × ≈$0.0017 + 53 × ≈$0.0008), estimated at 4 characters per token with nothing cached and 90 tokens out. The spec's estimate is $0.22–0.27.
- The spend guard stops before the cap. So the run ends early only if calls cost close to their worst.

**If the API refuses `reasoning_effort`,** the reader would retry once at the model's own effort, capped at 1,500 tokens, which is about $0.009 a reading. This check never sends that retry. The reading comes back empty and the run stops, so the owner can decide (check of the spec, item 8).

## What it reports

Everything below also goes to `out/check-a-<stamp>/`, together with the ledger and each answer.

- Each failing phrase: the reading, the plan, whether it shot, the cards and the reply.
- The blind phrases, reported apart.
- The before/after table for the 53 audited phrases.
- Token usage: prompt, cached, completion and reasoning tokens (p50, p95, p99), how each answer finished, and which effort path ran.
- The measured typical cost against v1's, and the 1.25× budget rule (spec §2.1).
- The new answer cap: `max(400, ceil(1.5 × p99))`.
- The bars (below).

**Hard gates, each must be 0:**
- a forbidden key. `shoot`, `set_change`, `undo` and `who` are forbidden unless the phrase expects or allows them; a `who` equal to NOW's is not a swap;
- a plan that shoots where nothing should be shot;
- `lens_mm` beside a film stock;
- words the person never wrote: every part the parser drops, and a "not yet" quote the message doesn't contain;
- an answer that is not JSON, a `length` finish, or a 4xx;
- a silent reply;
- reasoning tokens on more than 5% of calls.

**Soft bars:**
- 28 of the 30 designed-full audited requests pass every expected field (29 and 27 until Helios Cut 4 added A19, graded on its set as saved);
- 85% of the phrases pass: 92 of the 108;
- 16 of the 20 blind phrases pass;
- every expected reply mention is found.

**If a hard gate fails:**
1. v2 stays admins-only (`SHOT_READER_V2_OPEN_TO_ALL = false`).
2. The failing phrases become unit fixtures.
3. The static block is changed, and only the failures are re-run with `--only`.

If check A passes, the flag flips in its own commit, with a changelog entry.

Exit codes:
- 0: every bar is met.
- 1: a bar failed.
- 2: a usage, corpus or set problem, a failed precondition, or a run that stopped early.

## Files

- `corpus.json`: spec v2's `corpus-v2.json`. Version 3 (Helios Cut 4, step B3, 2026-09-26) adds the phrases about names and parts, X104–X111, each read on a named set: a look at a part, A19's words facing a named part (X105), a named stand, "the other one" between two cars of one name, standing by a part, and A44, X88 and X92 again with their sets named (X109–X111). Every other phrase, A19 included, reads its set as saved, as it did in version 2. Its `conventions` block is what `lib/grade.mts` implements.
- `dry-extras.json`: keys the dry run's perfect reader adds to a phrase's expectations where the expected reply needs a key the phrase only *allows*. For X56, the Sets home's build turn, that key is the set change. Only the dry run reads this file.
- `prices.json`: the reader's prices and the date they were read.
- `blind-corpus.template.json`: the blind phrases' form. `blind-corpus.json` is the filled copy.
- `lib/fixtures.mts`: the three sets, built as real sets:
  - **race:** the race-track fixture;
  - **showroom:** the open showroom with a blue second car and a white stand;
  - **garage:** two red cars and a bench, built here.

  Each set is read **as saved**, nameless, as every set is until an admin's naming pass names it, and as every non-admin's set is: check A opens reader v2 to everyone, so it measures the STAGE those accounts send. A phrase with `context.named` reads its set as the naming pass would name it: `HAND_NAMES` puts hand-written names on through `withNames` (the race's car and its grandstand, pit garages and barriers; the showroom's two coupes and its stand; the garage's two cars with one name, so "which one?" stays a real question). Only a named phrase may name a part (`s1`…).

  THINGS and PARTS are listed nearest first, but a thing's alias is its place in the set's own order and a part's (`s1`, `s2`, `s3`) its place among the parts, so the corpus's aliases hold only because the sets place them in that order, and the run refuses a set whose aliases or names don't match. Where a built set differs from the corpus's description (the race car is 0.3 m to Marco's right; the showroom's stand is 5.5 m away rather than 2 m, so that it stays `t3`), the run prints a note.
- `lib/grade.mts`: the grader. `lib/answers.mts`: the perfect and garbage answers. `lib/turn.mts`: one reading through the page's code. `lib/main.mts` and `lib/dry.mts`: the runs. `lib/fence.mts`, `lib/net.mts` and `lib/env.mts`: the fences. `lib/money.mts`: the arithmetic.
- It reuses the Astra Sets eval's network guard, spend guard, ledger and `.env` parser (`scripts/astra-sets-eval/lib/`).

The tests are `lib/grade.test.mts` and `lib/run.test.mts`. They run in the ordinary `npx vitest run`, both dry runs included.
