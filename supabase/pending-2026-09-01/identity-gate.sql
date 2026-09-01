-- =====================================================================
-- 2026-09-01  The identity gate — PENDING, apply to live DB BEFORE the
-- code push. The code fails closed without this: with no
-- `identity_gate_threshold` row the gate resolves to its default and the
-- admin knob is invisible, and with no columns the retry cannot record
-- that it happened.
--
-- WHAT THIS IS FOR. Picacho scores every character render against the
-- character's own identity photo and prints the number under the result,
-- and /compare/higgsfield and /compare/imagineart both sell that as "the
-- identity verified, not assumed". Until now the number branched nowhere.
-- This is the schema half of making it decide something: a render below
-- the bar is re-rendered once free, the better attempt is kept, and a
-- second miss force-refunds the credit.
--
-- SHIPPED DISABLED ON PURPOSE — see the seed at the bottom.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Two nullable columns on generations.
--
-- NULLABLE IS NOT A STYLE CHOICE HERE, IT IS THE ONLY SAFE OPTION.
-- reserve_generation (schema.sql, and its twin reserve_generations) ends
-- with a POSITIONAL insert:
--
--     INSERT INTO public.generations VALUES (rec.*);
--
-- A positional insert supplies an explicit NULL for every column that is
-- not in the record it was handed, which BYPASSES the column DEFAULT. So
-- a column added here as `not null default 0` would raise a not-null
-- violation on EVERY generation insert, image and video, product-wide,
-- the moment this file is applied — before a single line of the new code
-- runs. Every column the previous pending files added is nullable for
-- exactly this reason. Do not "tidy" these into NOT NULL.
-- ---------------------------------------------------------------------

alter table public.generations
  -- How many free re-renders the gate has already granted this row.
  -- Read (not counted in memory) so that two drivers landing on the same
  -- generation — a client poll and a webhook — cannot each grant "the"
  -- one retry. NULL and 0 both mean "none yet"; the code coalesces.
  add column if not exists identity_retries int;

alter table public.generations
  -- When the gate settled this row: tried twice, still under the bar,
  -- credit refunded.
  --
  -- This column exists because a FORCED refund deliberately leaves no
  -- other trace. refundGenerationCosts stamps refunded_at only on the
  -- non-forced path (a 2026-08-31 decision, so that forced refunds for
  -- provably-zero-cost failures don't consume the daily refunded-failure
  -- cap). The gate's refund IS forced, so without this column a settled
  -- row is byte-identical to a guarded-spend abort — and the settle path
  -- would have no idempotency key at all, making a double refund a
  -- matter of timing rather than of policy.
  add column if not exists identity_gated_at timestamptz;

comment on column public.generations.identity_retries is
  'Free re-renders granted by the identity gate. Read from the row, never counted in memory.';
comment on column public.generations.identity_gated_at is
  'Set when the gate settled: two misses, credit force-refunded. The only durable marker a forced refund leaves.';

-- ---------------------------------------------------------------------
-- 2. Seed the admin knob.
--
-- THIS INSERT IS LOAD-BEARING. app_settings grants SELECT to authenticated
-- and UPDATE to admins — and nothing else. updateAppSetting in
-- lib/admin/actions.ts is `.update().eq("key", key)`, not an upsert, and
-- PostgREST reports no error when an update matches zero rows. So without
-- this row the Admin > Settings field does not render at all, and any
-- attempt to create it by saving would silently appear to succeed while
-- changing nothing.
--
-- SEEDED AT '0', WHICH MEANS THE GATE IS OFF.
--
-- Deliberate, and the most important line in this file. Nobody has read
-- the production distribution of generations.match_score, and that
-- distribution is the only thing that decides whether a threshold of 70
-- costs a few cents a month or several thousand dollars: every render
-- below it is re-rendered at our cost, and every render that misses twice
-- is refunded as well. Turning the gate on before reading that number
-- would be betting the provider bill on a guess.
--
-- Run this first, then set the value to a real threshold in
-- Admin > Settings — no deploy needed:
--
--   select width_bucket(match_score, 0, 100, 10) * 10 as bucket,
--          count(*)
--     from public.generations
--    where match_score is not null
--    group by 1
--    order by 1;
--
-- Read it as: everything at or below your chosen bucket gets a free
-- second render, and the share of those that miss twice gets refunded.
-- 70 is the intended destination, not the starting point.
-- ---------------------------------------------------------------------

insert into public.app_settings (key, value, description)
values (
  'identity_gate_threshold',
  '0',
  'Identity match score (0-100) below which a character render is re-rendered once, free. 0 disables the gate. Max 95 — the scorer never returns 100, so a higher value would retry and refund every render ever made.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 3. Verification — safe to run, changes nothing.
-- ---------------------------------------------------------------------
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema = 'public'
--    and table_name = 'generations'
--    and column_name in ('identity_retries', 'identity_gated_at');
--
-- select key, value from public.app_settings where key = 'identity_gate_threshold';
