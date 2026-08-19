# Operator actions — required to complete the 2026-08-19 fix round

The code fixes in this round are complete and verified (`tsc`, lint, hook-order, `next build` all clean), but several depend on actions only the operator can take: applying SQL to the live Supabase project, setting env vars, and flipping dashboard settings. Work through this list top to bottom. Items marked **BEFORE DEPLOY** must land before (or together with) the next production deploy — the affected code paths fail closed (loud, retryable errors; no silent breakage) until they do.

## 1. Apply the SQL files (BEFORE DEPLOY)

Apply in the Supabase SQL editor, in this order (all idempotent):

1. `supabase/pending-2026-08-19/billing.sql` — `profiles.plan_currency`/`plan_interval` columns + atomic `clawback_credit_purchase` RPC. Until applied: webhook subscription/clawback writes 500 (Stripe retries safely, but noisily) and Admin → Billing's select fails.
2. `supabase/pending-2026-08-19/pipeline.sql` — `generations.refunded_at` + partial indexes + `record_model_failure` RPC. Header caveat: `model_health` has no DDL in the repo; the RPC assumes `model_id` unique and `failing_user_ids uuid[]` — adjust two casts if the live column is `text[]`. The TS code has a fallback, so this one degrades gracefully.
3. `supabase/pending-2026-08-19/user-actions.sql` — reference-image reservation RPCs, `insert_saved_prompt_capped`, `insert_brand_rules_capped`, grant revocations on `reference_image_generations`/`push_tokens`, storage-bucket size/mime limits. Until applied: reference-image generation, saved prompts, brand rules fail closed with retry messages. **Reconcile first**: verify the live column shapes for `reference_image_generations`/`saved_prompts`/`brand_rules` (the repo has no DDL for them) and drop any permissive live RLS policies the file's comments flag.
4. `supabase/pending-2026-08-19/auth-admin.sql` — unique index + format CHECK on `profiles.username`, `create_api_key_capped` RPC, role-checked `admin_traffic_daily`, and (section 4) per-feature rate-limit scoping: a `scope` column on `api_rate_hits` plus a 4-arg `api_rate_check` (the 3-arg one becomes a delegating shim). **Reconcile first**: the file contains queries to find duplicate/format-violating usernames — fix those rows or the index build fails. Verify the live `admin_traffic_daily` signature before the `CREATE OR REPLACE`. Until applied: creating API keys fails closed, and rate limiting falls back to the old shared per-user bucket (the app logs a warning naming this file on every limited call).

Advisory lock keyspace is now: 0/7/11/23 (pre-existing), 29 (reference images), 31 (saved prompts), 37 (brand rules), 41 (API keys) — documented in the SQL headers.

## 2. Environment variables (production)

- `FAL_ACCOUNT_ID` — pins the fal webhook to your own fal account. Until set, behavior is unchanged and the server logs the observed account id once so you can copy it.
- `MEDIA_SIGNING_SECRET` — decouples "permanent" media URLs from the Supabase service-role key. **Set it once, early, before any future service-key rotation.** Note: the first time you set it, previously issued media URLs are invalidated (one-time cost; the sooner the smaller).
- `SHOWCASE_CHARACTER_ID` / `SHOWCASE_OWNER_ID` (optional) — the showcase route's ids; code falls back to the current hardcoded values.

## 3. Stripe dashboard

- **Webhook endpoint**: add these event types to the existing endpoint subscription: `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.dispute.created`.
- **Dunning**: review Billing → Subscriptions and emails → what happens when payments fail. The code no longer grants plan allowance to `past_due`/`unpaid` accounts, so either setting is now safe — but "cancel after N retries" is still recommended so dead subscriptions eventually emit `customer.subscription.deleted`.

## 4. Supabase dashboard

- Authentication → Email: enable **"Secure email change"** (double opt-in) — the code now requires the current password and pins the redirect, but double opt-in is the backstop against session-theft email takeover.
- Storage: `user-actions.sql` sets bucket `file_size_limit`/`allowed_mime_types`; spot-check the bucket ids match (`chat-attachments`, `character-references`, `generated-images`) and that legitimate existing content fits the limits.

## 5. Schema re-snapshot (strongly recommended)

Three independent reviewers hit tables with no DDL in the repo (`api_keys`, `push_tokens`, `reference_image_generations`, `feedback`, `saved_prompts`, `prompt_assists`, `brand_rules`, `generation_jobs`, `credit_purchases`, `promo_codes`, `promo_redemptions`, `model_health`, plus admin view grants). Re-snapshot the live schema into `supabase/schema.sql` (e.g. `supabase db dump --schema public`) so RLS posture is versioned and auditable again. While there, specifically verify:
- `api_keys`: INSERT policy has `WITH CHECK (user_id = auth.uid())`; SELECT owner-scoped.
- `reference_image_generations`: after user-actions.sql, `authenticated` has no INSERT/UPDATE/DELETE grants.
- `push_tokens`: owner-scoped SELECT/DELETE only; INSERT/UPDATE revoked from `authenticated`.

## 6. Post-deploy smoke test

- **CSP** (biggest deploy-behavior change): log in, first-paint theme correct, run a generation and play the resulting video (served from `*.fal.media`), complete a Stripe checkout, open the billing portal ("Manage billing"), check the browser console for CSP violations.
- **Billing**: buy a credit pack on a free-tier account and confirm the credits are spendable (the round's #1 finding).
- **Webhooks**: Stripe endpoint shows the new event types delivering 200s; fal webhook still 200s (watch for the `FAL_ACCOUNT_ID` log line if unset).
- **Native shell**: confirm the iOS app no longer shows the "Install the app" card.

## 7. Pricing restructure (2026-08-19) — Stripe actions

The credits restructure (PLAN_LIMITS multiplied, $9 Basic tier, packs repriced to $15/$42/$99, annual trimmed to ~15%) ships fully fail-closed: everything below unlocks selling the new things, and nothing breaks while you get to it. Existing subscribers keep their Stripe price and simply receive the larger allowances on deploy — no migration.

1. **Basic tier prices** (unlocks selling Basic): in the LIVE Stripe Dashboard create a Product "Picacho Basic" with a **$9.00/month** recurring USD Price and a **€9.00/month** recurring EUR Price on the same Product (same shape as the four existing plan products). Paste the two price ids into `PLAN_PRICE_IDS.basic` and `PLAN_PRICE_IDS_EUR.basic` in `src/lib/stripe/plans.ts`. Until then the Basic card renders but checkout says "This plan isn't set up for checkout yet."
2. **Credit pack re-setup** (unlocks buying packs again): run `node setup-credit-packs.js` locally against the LIVE key. It reuses the existing pack Products, creates new Prices at the new amounts ($15/$42/$99 + EUR twins; a Stripe Price's amount is immutable, so new Prices are required), and prints the two id blocks — paste them into `CREDIT_PACK_PRICE_IDS` / `CREDIT_PACK_PRICE_IDS_EUR` in `src/lib/stripe/credit-packs.ts` (currently nulled, so packs are hidden and checkout fails closed until you do). Optionally archive the old $45/$119/$279 Prices in the Dashboard — the webhook still grants for any payment that straddled the deploy via `LEGACY_CREDIT_PACK_PRICE_CREDITS`, which is safe to delete from the code after ~30 days.
3. **Annual prices**: nothing to create — annual checkouts build inline `price_data` from `PRICING_TIERS.annualPrice`, so the 15% rates are live on deploy for new checkouts only.
4. Smoke test after pasting ids: buy Basic monthly (USD + a EU-geo check for EUR), buy the small pack, and confirm the webhook grants 20 credits.

## Known accepted trade-offs (no action needed, just awareness)

- Reference-image caps reserve the slot **before** the paid provider call (that's what closed the unlimited-free-generations race). The flip side: if the serverless function dies mid-call (timeout/OOM/deploy), the catch-block refund never runs and the slot stays burned — for a free-tier account that's one of only 2 lifetime tries. Rare, and recoverable by support (reset `free_reference_generations_used` / delete the orphaned `reference_image_generations` row); a proper meter-reaper needs the live table schema, which the repo doesn't version yet (see §5).

- `/api/track` rate limit is in-memory per serverless instance — best-effort by design.
- The recovery-session check in `updatePasswordFromRecovery` fails open when the JWT lacks an `amr` claim (Supabase's vocabulary isn't contractual).
- Admin error banner now shows allowlisted/generic messages only; raw Stripe/Postgres detail is in server logs.
- All `api_rate_check` callers share one per-user hit bucket (no endpoint column) — caps interact across endpoints when tuning.
