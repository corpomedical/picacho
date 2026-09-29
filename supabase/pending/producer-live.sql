-- Aly's live voice for everyone with Aly, its minutes counted by the server
-- (2026-09-29, operator: "Way better than what we have. Lets keep her…" →
-- "Every Aly user, after 3 fixes"). Code: src/lib/producer/live-ledger.ts
-- (the counting), src/app/api/producer/live/route.ts (start, heartbeat,
-- close) and src/app/api/cron/producer-live/route.ts (hangs up and charges a
-- call whose page went quiet).
--
-- RUN IT BEFORE THE PUSH. Without the table the live voice refuses to start
-- (it can't count the minutes) and everyone gets her usual voice. Idempotent:
-- a second paste is harmless.
--
-- One row per live call (OpenAI's session id). The page sends a heartbeat
-- every minute; the server holds the allowance for five minutes at a time
-- (13 units, reservations in agent_usage like every assistant turn) and, when
-- the call ends, charges what it really used: $0.05 a minute, billed per
-- second, in the assistant's 2-cent units. A call whose heartbeats stop is
-- hung up and charged up to a minute past its last heartbeat.
create table if not exists public.producer_live_sessions (
  id text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The allowance window and cap it was started under (the brain route's).
  since timestamptz not null,
  cap int not null,
  started_at timestamptz not null default now(),
  beat_at timestamptz not null default now(),
  -- The agent_usage reservation rows holding its allowance, and their units.
  reservations uuid[] not null default '{}',
  reserved_units int not null default 0,
  closed_at timestamptz,
  -- What it was charged: seconds, units, our cost, and why it ended.
  seconds int,
  units int,
  cost_usd numeric(10, 6),
  reason text,
  -- true: the seconds are OpenAI's own count (the page's session.closed,
  -- inside what the heartbeats prove); false: the server's bound.
  confirmed boolean not null default false
);

create index if not exists producer_live_sessions_open
  on public.producer_live_sessions (beat_at) where closed_at is null;
create index if not exists producer_live_sessions_user
  on public.producer_live_sessions (user_id, started_at desc);

-- Only the server reads or writes it (service role, which skips row security).
alter table public.producer_live_sessions enable row level security;
revoke all on public.producer_live_sessions from anon, authenticated;
grant all on public.producer_live_sessions to service_role;

-- The switch on the admin Flags page: off = everyone gets her usual voice.
insert into public.feature_flags (key, enabled, description)
values (
  'producer_live',
  true,
  'Aly''s live voice (OpenAI GPT-Live, $0.05 a minute from each person''s assistant allowance) when they press Talk. Off = everyone gets her usual voice. Needs OPENAI_API_KEY.'
)
on conflict (key) do nothing;

-- Check: 5 rows, each `true` once this has run.
select thing, found from (values
  ('live calls table', to_regclass('public.producer_live_sessions') is not null),
  ('open calls index', to_regclass('public.producer_live_sessions_open') is not null),
  ('row security on', coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.producer_live_sessions')), false)),
  ('hidden from browsers', case when to_regclass('public.producer_live_sessions') is null then false
     else not has_table_privilege('authenticated', 'public.producer_live_sessions', 'select') end),
  ('switch on', exists (select 1 from public.feature_flags where key = 'producer_live' and enabled))
) as t(thing, found);
