-- The refusal log. Every time a content gate refuses — the prompt gate
-- before a render, the output gate on a rendered frame, or the feed gate on
-- a post to the community feed — one row.
--
-- Four things this is, at once (2026-09-09):
--   1. SESSION CONTEXT. The prompt gate reads how many refusals this account
--      has drawn in the last hour and raises its thresholds by that count.
--      That is what catches "make it more spicy" — five words that mean
--      nothing alone and everything after a boudoir refusal. It was the one
--      mechanism the policy's own header called essential and nothing wired.
--   2. THE FALSE-POSITIVE DETECTOR. A refusal in production was invisible;
--      the only way to find one was replaying the whole database.
--   3. THE AUDIT TRAIL. What a Play reviewer would ask for.
--   4. A PROVIDER SIGNAL. An output block on a prompt the prompt gate scored
--      NEGLIGIBLE is the provider going off-script — that is a model-health
--      fact, not a customer fact.
--
-- No prompt text is stored: a hash, the reason, the lane, and the bands.
-- The row is written with the service role and readable only by admins.

create table if not exists public.policy_refusals (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  gate          text not null check (gate in ('prompt', 'output', 'feed')),
  reason        text not null,
  strict_lane   boolean not null default false,
  prompt_sha256 text,
  generation_id uuid references public.generations (id) on delete set null,
  bands         jsonb,
  -- the prompt gate's bands at the time, when an OUTPUT block follows an
  -- allowed prompt — the provider-signal case
  prompt_bands  jsonb,
  provider      text
);

-- Idempotent whichever version of this file ran first: "create table if not
-- exists" keeps an older check constraint, so the gate set is (re)declared
-- explicitly. Postgres names the inline check policy_refusals_gate_check.
alter table public.policy_refusals drop constraint if exists policy_refusals_gate_check;
alter table public.policy_refusals
  add constraint policy_refusals_gate_check check (gate in ('prompt', 'output', 'feed'));

create index if not exists policy_refusals_user_recent_idx
  on public.policy_refusals (user_id, created_at desc);

alter table public.policy_refusals enable row level security;

drop policy if exists "Admins read policy refusals" on public.policy_refusals;
create policy "Admins read policy refusals"
  on public.policy_refusals for select to authenticated
  using ((select is_admin()));

revoke all on public.policy_refusals from public, anon, authenticated;
grant select on public.policy_refusals to authenticated;
grant all on public.policy_refusals to service_role;

-- Verify as a non-admin: select count(*) from policy_refusals; -> 0 rows.
