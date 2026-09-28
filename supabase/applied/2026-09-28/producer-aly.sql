-- Aly, 2026-09-28 (operator's list, items 5 and 6: "Give Aly different
-- personalities, the default that is the actual one, the sarcastic and the
-- rude" and "When a user reaches 100% of monthly consumption, give them the
-- chance to recharge by payment"; his picks for the second: priced at about
-- twice what the units cost us, and bought units kept until used).
--
-- Code: src/lib/producer/personality.ts (the three), src/lib/agent/topups.ts
-- (the packs), src/lib/agent/allowance.ts (reserve + settle), both assistant
-- routes (api/producer, api/agent/chat), the Stripe webhook (grant + refund),
-- lib/stripe/checkout-core.ts startAssistantTopUpCheckout.
--
-- APPLIED 2026-09-28, after the push of a9fdea6: the first try applied
-- nothing (most likely the clipboard command carried nothing into the
-- editor); a true/false check showed all 8 missing, the operator pasted the
-- statements from chat, and the check below answered 8 × true. Idempotent: a second paste is
-- harmless.
--
-- What the code does without it (as it ran for that window): every
-- personality reads as the default and choosing another in Settings says it
-- didn't save; the top-up buttons still open checkout, but the webhook can't
-- record the purchase and answers 500, so Stripe keeps retrying it until
-- this has run (nothing is lost, the units land then).
--
-- WRITES: only the server, with the service role. A signed-in user can read
-- their own top-up purchases and nothing else; the balance is a profiles
-- column outside the user-updatable list (applied/2026-09-09/
-- profiles-column-grants.sql), and every function below is service_role only.

-- ── 1. Her personality ─────────────────────────────────────────────────────
-- default | sarcastic | rude. NULL = the default; the code checks the value,
-- so an unknown one also falls back.
alter table public.producer_prefs
  add column if not exists personality text;

-- ── 2. Assistant top-ups ───────────────────────────────────────────────────
-- The balance: units bought and not yet spent. Spent only after the month's
-- own allowance is used up, and never expires.
alter table public.profiles
  add column if not exists assistant_topup_units int not null default 0;

-- One row per purchase: what the refund/chargeback path takes back, and the
-- record behind the balance. stripe_session_id is UNIQUE so a webhook Stripe
-- delivers twice can't grant twice (the credit_purchases pattern).
create table if not exists public.assistant_topups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  units int not null check (units > 0),
  amount_cents int not null default 0,
  currency text not null default 'usd',
  stripe_session_id text not null unique,
  created_at timestamptz not null default now(),
  refunded_at timestamptz
);
create index if not exists assistant_topups_user on public.assistant_topups (user_id, created_at desc);
alter table public.assistant_topups enable row level security;
drop policy if exists "assistant_topups: own rows readable" on public.assistant_topups;
create policy "assistant_topups: own rows readable"
  on public.assistant_topups for select to authenticated
  using (user_id = auth.uid());
revoke insert, update, delete on public.assistant_topups from anon, authenticated;

-- How much of the balance each billing month has used: the part of that
-- month's assistant use above its allowance. Keyed by the month's start (the
-- same `since` the routes meter from), so a month's figure never mixes with
-- another's. Server only: RLS on, no policies.
create table if not exists public.assistant_topup_spend (
  user_id uuid not null references public.profiles (id) on delete cascade,
  since timestamptz not null,
  spent int not null default 0 check (spent >= 0),
  primary key (user_id, since)
);
alter table public.assistant_topup_spend enable row level security;
revoke all on public.assistant_topup_spend from anon, authenticated;

-- Reserve a turn's units, counting the top-up. record_agent_units with one
-- change: the ceiling is the month's allowance + the balance + what the
-- balance already paid for this month (those units are in the month's sum,
-- so they have to be in the ceiling too). Same advisory lock (91), so it
-- serialises with record_agent_units and every function below.
-- Returns {"id": <reservation row id or null when the limit is reached>,
--          "topup": <balance>}; the route settles the top-up when the balance
-- is above zero.
create or replace function public.reserve_agent_units(
  p_user_id uuid,
  p_since timestamptz,
  p_cap int,
  p_units int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  used int;
  balance int;
  spent int;
  new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 91));
  select coalesce(sum(units), 0)::int into used
    from public.agent_usage
   where user_id = p_user_id and created_at >= p_since;
  select coalesce(assistant_topup_units, 0) into balance
    from public.profiles where id = p_user_id;
  balance := greatest(0, coalesce(balance, 0));
  select s.spent into spent
    from public.assistant_topup_spend s
   where s.user_id = p_user_id and s.since = p_since;
  spent := coalesce(spent, 0);
  if used + p_units > p_cap + balance + spent then
    return jsonb_build_object('id', null, 'topup', balance);
  end if;
  insert into public.agent_usage (user_id, mode, units)
  values (p_user_id, 'reserved', p_units)
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'topup', balance);
end $$;

-- After a turn's real cost is written: whatever this month has used above
-- its allowance, and the balance hasn't paid for yet, comes off the balance.
-- Counts settled turns, plus reservations older than any turn runs (a
-- process that died mid-turn leaves its reservation as the charge — the
-- record_agent_units rule). Idempotent: running it twice takes nothing the
-- second time. Returns the units taken.
create or replace function public.settle_assistant_topup(
  p_user_id uuid,
  p_since timestamptz,
  p_cap int
) returns int
language plpgsql security definer set search_path = public as $$
declare
  used int;
  balance int;
  spent int;
  take int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 91));
  select coalesce(assistant_topup_units, 0) into balance
    from public.profiles where id = p_user_id;
  if coalesce(balance, 0) <= 0 then
    return 0;
  end if;
  select coalesce(sum(units), 0)::int into used
    from public.agent_usage
   where user_id = p_user_id and created_at >= p_since
     and (mode <> 'reserved' or created_at < now() - interval '15 minutes');
  select s.spent into spent
    from public.assistant_topup_spend s
   where s.user_id = p_user_id and s.since = p_since;
  spent := coalesce(spent, 0);
  take := least(balance, greatest(0, used - p_cap - spent));
  if take <= 0 then
    return 0;
  end if;
  update public.profiles
     set assistant_topup_units = greatest(0, coalesce(assistant_topup_units, 0) - take)
   where id = p_user_id;
  insert into public.assistant_topup_spend (user_id, since, spent)
  values (p_user_id, p_since, take)
  on conflict (user_id, since)
  do update set spent = public.assistant_topup_spend.spent + excluded.spent;
  return take;
end $$;

-- The Stripe webhook, once a top-up is paid: records the purchase and adds
-- its units in one transaction. Idempotent on the Checkout session; true
-- only the first time.
create or replace function public.grant_assistant_topup(
  p_user_id uuid,
  p_session_id text,
  p_units int,
  p_amount_cents int,
  p_currency text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if p_units is null or p_units <= 0 then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 91));
  insert into public.assistant_topups (user_id, units, amount_cents, currency, stripe_session_id)
  values (p_user_id, p_units, coalesce(p_amount_cents, 0), coalesce(p_currency, 'usd'), p_session_id)
  on conflict (stripe_session_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    return false;
  end if;
  update public.profiles
     set assistant_topup_units = coalesce(assistant_topup_units, 0) + p_units
   where id = p_user_id;
  return true;
end $$;

-- A full refund or a chargeback takes the top-up back: whatever of its units
-- is still in the balance (floored at zero, like clawback_credit_purchase —
-- spent units can't be un-spent). Claims the row first, so a redelivered
-- event is a no-op. False when there is no such top-up or it was already
-- taken back.
create or replace function public.clawback_assistant_topup(p_session_id text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_units int;
begin
  update public.assistant_topups set refunded_at = now()
   where stripe_session_id = p_session_id and refunded_at is null
   returning user_id, units into v_user, v_units;
  if v_user is null then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 91));
  update public.profiles
     set assistant_topup_units = greatest(0, coalesce(assistant_topup_units, 0) - v_units)
   where id = v_user;
  return true;
end $$;

-- Service role only, like every meter and balance function here: a client
-- that could call these could grant itself units.
revoke execute on function public.reserve_agent_units(uuid, timestamptz, int, int) from public, anon, authenticated;
grant execute on function public.reserve_agent_units(uuid, timestamptz, int, int) to service_role;
revoke execute on function public.settle_assistant_topup(uuid, timestamptz, int) from public, anon, authenticated;
grant execute on function public.settle_assistant_topup(uuid, timestamptz, int) to service_role;
revoke execute on function public.grant_assistant_topup(uuid, text, int, int, text) from public, anon, authenticated;
grant execute on function public.grant_assistant_topup(uuid, text, int, int, text) to service_role;
revoke execute on function public.clawback_assistant_topup(text) from public, anon, authenticated;
grant execute on function public.clawback_assistant_topup(text) to service_role;

-- Check: 8 rows, one per thing, each `true` once this has run. Every row is
-- always there (true or false); the first version grouped its rows, so a
-- missing table or function simply didn't show, and an empty result read as
-- "nothing happened" when nothing had.
select thing, found from (values
  ('personality column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'producer_prefs' and column_name = 'personality')),
  ('top-up balance column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'assistant_topup_units')),
  ('top-ups table', to_regclass('public.assistant_topups') is not null),
  ('top-up spend table', to_regclass('public.assistant_topup_spend') is not null),
  ('reserve function', to_regprocedure('public.reserve_agent_units(uuid, timestamptz, integer, integer)') is not null),
  ('settle function', to_regprocedure('public.settle_assistant_topup(uuid, timestamptz, integer)') is not null),
  ('grant function', to_regprocedure('public.grant_assistant_topup(uuid, text, integer, integer, text)') is not null),
  ('refund function', to_regprocedure('public.clawback_assistant_topup(text)') is not null)
) as t(thing, found);
