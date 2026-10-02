-- Who comes back (2026-10-03). Operator, after a reel on retention
-- ("cohorts, usage events, drop-off alerts") → "Draft all three, both
-- admins" (canvas claude.ai/artifact/6Z1sCKGaQMnxDc8i4p6ZSU) → "Put them in
-- the right place". Code: src/lib/retention/.
--
-- Three small tables, all read by admins only and written by the server
-- (service role), never by a browser:
--   1. user_tool_days       — which tools a signed-in person opened, per day
--                             (the activity heartbeat, /api/activity).
--   2. subscription_events  — cancellations and ends, from the Stripe and
--                             Play webhooks. Until now a cancellation only
--                             reset the profile and left no trace.
--   3. retention_alerts     — the phone alerts already sent, so each one
--                             fires once per person.
-- Every row hangs off profiles ON DELETE CASCADE: deleting an account takes
-- its rows with it.
--
-- RUN THIS BEFORE PUSHING THE CODE. Idempotent: a second paste is harmless.
-- Before it runs, the new code fails soft (nothing recorded, no alerts).

begin;

-- 1. Tools opened, one row per person per day per tool.
create table if not exists public.user_tool_days (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  tool text not null check (tool ~ '^[a-z][a-zA-Z0-9]{0,31}$'),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (user_id, day, tool)
);
create index if not exists user_tool_days_day_idx on public.user_tool_days (day);
alter table public.user_tool_days enable row level security;
drop policy if exists "Admins can view tool days" on public.user_tool_days;
create policy "Admins can view tool days" on public.user_tool_days for select to public
  using ((select is_admin() as is_admin));

-- 2. Subscription cancellations and ends.
create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('cancel_scheduled', 'cancel_undone', 'ended')),
  source text not null check (source in ('stripe', 'play')),
  plan text,
  subscription_id text,
  ends_at timestamptz,
  -- The webhook event's own id: a redelivered event is the same row.
  external_id text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists subscription_events_user_idx on public.subscription_events (user_id, created_at desc);
alter table public.subscription_events enable row level security;
drop policy if exists "Admins can view subscription events" on public.subscription_events;
create policy "Admins can view subscription events" on public.subscription_events for select to public
  using ((select is_admin() as is_admin));

-- 3. Phone alerts already sent (quiet, stalled), one per person per episode.
create table if not exists public.retention_alerts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('quiet', 'stalled')),
  episode text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, episode)
);
alter table public.retention_alerts enable row level security;
drop policy if exists "Admins can view retention alerts" on public.retention_alerts;
create policy "Admins can view retention alerts" on public.retention_alerts for select to public
  using ((select is_admin() as is_admin));

commit;
