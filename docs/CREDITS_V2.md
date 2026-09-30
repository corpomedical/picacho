# Credits v2: the one balance

Adopted 2026-10-01 (operator: "Adopt the one-balance pricing plan at 30%").
Proposal and competitor research: claude.ai/artifact/61LtACNyxPVMaoypy183uH.
Branch: `claude/credit-v2`. Phase 1 (20a229e) is in; this file is the plan for
the rest, written so any session can pick it up.

## The rules

1. **One balance.** Everything that costs us money spends credits: renders,
   pictures, Aly messages (and voice), Helios builds and edits, character
   photos and close-ups, prompt assists, layers, upscales, spoken lines,
   Recast, Live. No side allowances.
2. **Priced at cost.** One credit carries at most $0.02 of our cost
   (`CREDIT_COST_USD`). An action's price is its full cost over that, rounded
   up (`src/lib/credit-prices.ts`).
3. **Sized for the worst case.** Each plan keeps its floor (Basic 40%, Starter
   35%, Growth 32%, Studio and Elite 30%) with every credit spent, on the yearly
   price, at 27% VAT and a premium card (`src/lib/credit-plans.ts`).
4. **No spending without paying.** Done in 1.190.0 and 1.191.0.
5. **A test enforces it** (`src/lib/credit-prices.test.ts`, phase 1).
6. **The free tier is a budget.** Unchanged here; the daily ceiling is still
   the operator's call.

## Numbers (phase 1, pinned by tests)

| Plan | Monthly · yearly | Credits |
|---|---|---|
| Basic | $9 · $8 | 175 |
| Starter | $19 · $16 | 380 |
| Growth | $79 · $67 | 1,700 |
| Studio | $299 · $254 | 6,500 |
| Elite | $499 · $424 (was $399) | 11,000 |

Packs: $15 = 250, $42 = 750, $99 = 1,900.
Prices: Wan 2.2 Turbo 15, Kling 1.6 26 (19 without a character), H3 27,
Kling 2.5 30, O3 41, Omni 8 s 55, Seedance 2.5 144, Veo 3.1 8 s 191, picture
14 (8 without), Aly message 1 (Think harder 2), character photo 4, Helios
build 58, Helios edit 32, prompt assist 1.

## Open decisions (operator)

- Chat: treated as part of the one balance (rule 1). He can still ask for a
  separate chat allowance carved from the same budget.
- VAT: prices assumed VAT-inclusive at 27% (worst). If Stripe adds VAT on top
  (Stripe → Settings → Tax; the code and LAUNCH_CHECKLIST.md disagree), every
  plan can hold ~27% more credits at the same floor.
- Free tier daily ceiling.
- Notice to current subscribers: EU consumer rules want notice before a plan
  gives less. Draft an email; he sends it.

## Phase 2: the switch

### How an account moves (no big-bang, no mixed units)

Each account converts **the first time the new code touches it**, in one
guarded RPC `convert_account_to_credit_v2(p_user_id)`:

- `profiles.credit_v2_at` (new, null = not yet) set to now().
- `purchased_credits` and `bonus_credits` multiplied by 26 (every old credit
  still buys at least what it did: Kling 1.6 with a character was 1, is 26).
- `assistant_topup_units` added to `purchased_credits` 1:1 (a unit was $0.02,
  the same as a new credit), then zeroed.
- A paid plan in good standing: what is left of this month's old allowance
  (`old_limit - monthly_credits_used(window start)`, floored at 0) x 26 goes
  to `bonus_credits`, and `profiles.allowance_starts_at` (new) is set to the
  next monthly window start. Until then the plan's new allowance is 0 (the
  bonus carries them); from then on, the new allowance. This keeps the
  current month on old value, as the plan page promised.
- In-flight rows of that account (`status = 'generating'`): their
  `purchased_credits_used` and `bonus_credits_used` x 26, so a later refund
  returns new credits.
- Idempotent: does nothing when `credit_v2_at` is already set. Old code never
  calls it, so running the SQL before the push changes nothing.

### Usage on the new credit

`credits_used_v2(p_user_id, p_since)`: from = greatest(p_since, credit_v2_at);
sum of `generations.credits_used` (rows created >= from) + `agent_usage.units`
(>= from) + `credit_spend.credits` (>= from, not refunded). Old-unit rows sit
before `credit_v2_at` and are never counted.

New v2 functions (the old ones stay untouched for the old code until the push):

- `reserve_generation_v2`, `reserve_generations_v2`: as today, with `used`
  from `credits_used_v2`.
- `reserve_agent_units_v2(p_user_id, p_since, p_cap, p_units)`: cap = the
  plan's credits; used = `credits_used_v2`; over the cap it may reserve
  against `bonus_credits + purchased_credits`.
- `settle_credit_overage_v2(p_user_id, p_since, p_cap)`: after a chat turn
  settles, whatever the window used above the cap that is not yet paid comes
  off `bonus_credits` first, then `purchased_credits` (tracked per window in
  `credit_overage_spend(user_id, since, spent)`, like
  `assistant_topup_spend` today).
- `credit_spend` table + `spend_credits_v2(p_user_id, p_since, p_limit,
  p_amount, p_kind, p_ref)`: for actions that are not renders or chat.
  Takes the monthly part first, then bonus, then purchased, all under the
  same advisory lock as reservations; returns the row id or null.
  `refund_credit_spend_v2(p_id)` gives back exactly what the row took.

The SQL must first assert the live definitions it replaces still read as the
repo's (schema.sql drifts): e.g. that `reserve_generation`'s body contains
`sum(CASE WHEN credits_used IS NULL THEN 1 ELSE credits_used END)`, or raise.
Prove every function on PGlite before handing it over (memory: the storage
write hole's recipe).

### Code (every consumer reads phase 1)

- `quote.ts` `quoteSend` returns `priceSend`'s numbers; `SendQuoteInput`
  gains `characters` (0 or more), passed by the composer, `runGeneration`,
  multi-angle, Helios takes and stills (`take.ts`), the API and Recast.
  `freeSlotEligible` becomes "the free model's default clip, or one
  picture", not a credit count.
- `plans.ts`: `PLAN_LIMITS` = `PLAN_CREDITS`; remove the separate chat,
  reference-photo and prompt-assist allowances (their tests move to credits).
  `pricing.ts`: credits, Elite yearly 424, copy.
- `core.ts` `checkGenerationAllowance`: convert the account first
  (`credit_v2_at` null → RPC); monthly limit 0 before `allowance_starts_at`;
  usage via `credits_used_v2`; reservations via the v2 RPCs.
- Chat (aly-chat route, producer route, agent chat route, live-ledger,
  account-tool, Settings meters, Aly's wheel): cap = plan credits via
  `reserve_agent_units_v2` + `settle_credit_overage_v2`; the top-up packs
  (agent/topups.ts) retire in favour of credit packs.
- Helios builds/edits/tries, Angle Stage proxies, character photos and
  close-ups, prompt assists: `spend_credits_v2` with `actionCredits`, refund
  on failure. Remove SET_BUILDS_MONTHLY_LIMITS, the edit tries tables,
  PLAN_REFERENCE_IMAGE_LIMITS, PLAN_PROMPT_ASSIST_LIMITS.
- Layers, upscale, Recast, Live, Effects, Director's Cut, dialogue: priced
  with `creditsFor(full cost)`.
- Packs (`stripe/credit-packs.json`): 250 / 750 / 1,900 at the same Stripe
  prices. Bonus grants in old units (admin grants, referral rewards,
  promo codes) and low-credit alert thresholds x 26 or re-sized.
- Admin economics: cost basis per credit $0.02.
- API and MCP: prices from `priceSend`; docs say credits per action.
- Copy, all four languages: pricing page, plan cards, FAQ, composer receipt
  and the "1 credit ≈ 1 standard video or image" line, Settings, Helios and
  Recast/Live labels, the product guide Aly reads, emails.

### Launch (the operator)

1. Send the notice email to current subscribers (draft provided).
2. Paste the SQL, then run its true/false check.
3. Push. Accounts convert on first use.
4. Check Stripe: Elite yearly is built inline from `annualPrice` (424).
