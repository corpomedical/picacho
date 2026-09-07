-- Two CHECK constraints that are behind the code (2026-09-07).
--
-- Both were read from the LIVE database with pg_get_constraintdef, not from
-- schema.sql, because schema.sql is a dated snapshot and the whole point here
-- is that it and production disagree with the code.
--
-- ---------------------------------------------------------------------
-- 1. profiles.plan does not allow 'basic'  -- REVENUE-BREAKING, NOT LATENT
-- ---------------------------------------------------------------------
-- Live definition, verified 2026-09-07:
--   CHECK (plan = ANY (ARRAY['none','starter','growth','studio','elite']))
--
-- Basic is a live, purchasable plan: pricing.ts:30 sells it at $9/month,
-- PLAN_LIMITS.basic is 12 credits, and the Stripe webhook writes
-- `plan: planId` (webhooks/stripe/route.ts:517). So the first person who buys
-- Basic is charged by Stripe, the profile UPDATE violates this constraint, the
-- webhook throws, and Stripe redelivers into the same wall on its retry
-- schedule. The customer keeps paying and stays on plan 'none' with zero
-- credits, and nothing surfaces except a failing webhook.
--
-- Nobody has bought Basic yet, which is the only reason this has not happened.
-- It is not a latent risk; it is a live defect waiting for one sale.
--
-- ---------------------------------------------------------------------
-- 2. generation_reports.source does not allow 'community'
-- ---------------------------------------------------------------------
-- Live definition, verified 2026-09-07:
--   CHECK (source = ANY (ARRAY['user','auto']))
--
-- The report_community_post RPC inserts source = 'community'. So every abuse
-- report on a community post has failed since the feature shipped on
-- 2026-08-21, and the reporter is shown a raw Postgres constraint error
-- (community/actions.ts:141).
--
-- The data agrees exactly: 45 'auto' rows, 15 'user' rows, ZERO 'community'
-- rows, against 8 live community posts. A moderation path that has never once
-- succeeded.
--
-- ---------------------------------------------------------------------
-- Both are widenings. No existing row can violate either new constraint, so
-- neither statement can fail on data, and re-running is harmless.

alter table public.profiles
  drop constraint if exists profiles_plan_check;
alter table public.profiles
  add constraint profiles_plan_check
  check (plan = any (array['none', 'basic', 'starter', 'growth', 'studio', 'elite']));

alter table public.generation_reports
  drop constraint if exists generation_reports_source_check;
alter table public.generation_reports
  add constraint generation_reports_source_check
  check (source = any (array['user', 'auto', 'community']));

-- ---------------------------------------------------------------------
-- Verification — safe to run, changes nothing.
-- ---------------------------------------------------------------------
-- select con.conname, pg_get_constraintdef(con.oid)
--   from pg_constraint con
--   join pg_class rel on rel.oid = con.conrelid
--   join pg_namespace n on n.oid = rel.relnamespace
--  where n.nspname = 'public'
--    and con.conname in ('profiles_plan_check', 'generation_reports_source_check');
