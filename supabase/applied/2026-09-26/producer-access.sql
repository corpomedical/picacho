-- The Producer, granted to one account at a time (2026-09-26, operator: "Give
-- me an option to grant users access to The assistant in the admin area").
-- Code: src/lib/producer/enabled.ts (producerAllowed, readProducerGrant), the
-- "Assistant" block on /admin/users/<id> and its "Assistant" tab on
-- /admin/users.
--
-- APPLIED 2026-09-26 before the code's push (the operator ran it and pasted
-- the check: producer_access | boolean | false).
--
-- Until now the Producer was admins, plus every Elite account once the
-- producer_elite switch is on. This column is the third way in: an admin
-- grants it to one account (a pilot, a partner, someone on another plan)
-- whatever its plan and whatever producer_elite says. A granted account
-- meters against Elite's assistant allowance, as an admin does, so a grant
-- works on a free account too. It is ONE allowance a month for both
-- assistants: the composer's chat (api/agent/chat) and Settings count the
-- same agent_usage ledger against the same cap for a granted account.
--
-- The kill switch still wins: with feature_flags.producer off, nobody has it.
-- A suspended account never has it.
--
-- WRITES: only the admin's server action writes it, with the service role.
-- Signed-in users hold no UPDATE on public.profiles (schema.sql: the
-- authenticated grant is delete, insert, references, select, trigger,
-- truncate), so nobody can grant it to themselves. They can read their own
-- row's value, which tells them nothing they can't see from the lamp.
--
-- BEFORE IT RAN the code coped (and still does on a fresh database): the
-- grant is read on its own, a missing column reads as "not granted", the
-- admin block says to run this file, and nothing else changes. Idempotent.
-- Below is exactly what ran.

alter table public.profiles
  add column if not exists producer_access boolean not null default false;

comment on column public.profiles.producer_access is
  'The Producer granted to this account by an admin (any plan; meters against Elite''s assistant allowance).';

-- The admin's "Assistant" tab lists the granted accounts: a handful of rows,
-- so a partial index keeps that read off the whole table.
create index if not exists profiles_producer_access_idx
  on public.profiles (id) where producer_access;
