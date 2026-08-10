# Brand & compliance rulebook — design sketch

Written 2026-08-10. A design, not an implementation — nothing here is built yet.

## The idea in one line

Picacho already enforces a rulebook ("this character has red hair") on every generation. The same machinery, pointed at *brand* rules and *regulatory* rules, becomes something no base model can ship — because it requires knowing your rules and your jurisdiction, not just how to render pixels.

## Why this is the defensible one

Everything else on the shortlist (batch generation, teams, publishing) is good product work that a competitor can copy in a quarter. This one compounds: every rule a customer writes makes their account harder to leave, and a vertical rule pack is a body of work someone has to redo from scratch rather than clone from a screenshot.

It's also the closest to done. The hard part — a validation gate that runs before any money is spent — was built on 2026-08-10 for a different reason (see LAUNCH_CHECKLIST.md, image reliability).

---

## What exists today

In `src/lib/generations/pipeline.ts`:

| Piece | What it does |
|---|---|
| `requiredElements(character, contentType)` | Turns a character's saved traits into `{label, value}[]` |
| `buildRulebook(primary, companions)` | Renders those into text handed to Claude (draft) and OpenAI (review) |
| `validate(prompt, character, contentType, overriddenLabels)` | Checks each required element appears in the prompt |
| `isElementPresent(prompt, value)` | Word-level fuzzy match, 60% of significant words, Levenshtein-tolerant |
| `review(prompt, missing)` | Appends missing items verbatim to repair a prompt for free |
| `splitOverrides(rawResponse)` | Lets a single request intentionally override a trait ("in a suit today") |

The shape today is: **positive requirements, per character, auto-repairable, overridable.**

## What compliance needs that this doesn't have

1. **Negative rules.** Compliance is mostly *"must NOT contain"*. There is no prohibition primitive at all right now.
2. **Account scope.** Rules must apply to every generation, not hang off one character.
3. **Fail closed.** A missing trait can be repaired by appending it. A banned claim **cannot** — you can't append your way out of a prohibition. Blocking rules must stop the generation.
4. **Non-overridable.** `splitOverrides` currently lets a request waive any rulebook label. A compliance rule must be exempt, or the feature is theatre.
5. **An audit trail.** "Show me that we never published a guaranteed-results claim" is the actual buying reason for a regulated customer.

---

## Design

### Data model

New table `brand_rules`:

| Column | Notes |
|---|---|
| `id`, `user_id`, `created_at` | standard |
| `kind` | `require` \| `forbid` |
| `label` | short name, shown in logs and errors — e.g. "no guaranteed results" |
| `value` | the rule text itself |
| `applies_to` | `all` \| `image` \| `video` |
| `severity` | `block` \| `warn` |
| `active` | boolean toggle |

RLS: owner-scoped, same pattern as every other table (`auth.uid() = user_id`).

### Where each piece plugs in

**Prevention — `buildRulebook()`.** Add a `Never include:` section listing active `forbid` rules. Cheapest possible win: the draft and review models simply avoid the content, so most rules never need enforcement.

**Enforcement — the pre-generation validate block.** This already runs after review and before any provider call. Extend it:

- `require` rules join `requiredElements()` → existing repair path, unchanged.
- `forbid` rules run a new check. On a match with `severity: block`, **do not generate**. Push a `validate` step naming the rule, mark the attempt failed, and return a clear message. Costs a draft/review, never a generation.
- `severity: warn` records the hit in `pipeline_log` and proceeds.

**One rewrite before failing.** On a prohibition hit, ask the review model once to rewrite without the offending content, re-check, and only then fail closed. Better UX than an immediate refusal, and bounded at one extra call.

**Override exemption — `splitOverrides()`.** Filter compliance labels out of the returned override set. A request cannot waive a `block` rule, by construction.

### String matching is not enough for prohibitions

`isElementPresent` is right for requirements (did the paraphrase keep "freckles"?) but wrong for prohibitions — "guaranteed results" is trivially evaded as "results you can count on". Prohibition checking should be a single cheap LLM classifier call:

> Here are N rules. Here is a prompt. Return the ids of any rules it violates, or `none`.

One extra call per generation, on a path that already makes two. For a compliance feature, correctness beats saving a fraction of a cent — and this is the difference between a real product and a checkbox.

### Honest limitation

This validates the **prompt**, not the **image**. It catches intent, not outcome — a prompt that says nothing forbidden can still render something unfortunate. Verifying output needs a vision model pass on the result, which is a genuine v2 and should not be promised before it exists. Say "enforced at prompt level" in the marketing and mean it.

---

## Phasing

**Phase 1 — the primitive.** `brand_rules` table, `forbid` support in the pre-generation gate, prohibitions in `buildRulebook`, override exemption, a settings page to manage rules. Ships the whole mechanism with string matching.

**Phase 2 — make it trustworthy.** Swap prohibition checking to the LLM classifier. Surface a per-generation compliance record in History and a filterable log in admin.

**Phase 3 — the product.** Preset rule packs per vertical — "Med spa (US / FTC)", roughly 15 pre-written rules covering guaranteed outcomes, before/after usage, testimonial claims, and consent language. This is the part that's actually sold; Phases 1 and 2 are plumbing.

## What makes this worth doing

Phase 1 is a table, one new check in a function that already exists, and a settings page. Phase 3 is writing, not engineering. The moat is in Phase 3, and it is not copyable from the outside — a competitor can see the feature but not the rules.
