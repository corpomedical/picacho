-- The Producer — a personal assistant for Elite (2026-09-24). Code:
-- src/lib/producer/, the route at /api/producer, the lamp in the app shell.
--
-- APPLIED 2026-09-24 (the operator ran it before the push; a read-only probe
-- found producer_threads and producer_notes answering). Idempotent.
--
-- TWO SWITCHES (operator, 2026-09-24: "Build v1 now, admins only"):
--   producer        ON  — the Producer exists: admins see the lamp. Turning it
--                         off in Admin hides the lamp everywhere and the route
--                         refuses every turn at once (the kill switch).
--   producer_elite  OFF — flip it on once the admin runs have measured what a
--                         turn really costs: then every Elite account gets it.
--
-- BILLING NEEDS NO TABLE: a Producer turn is metered through the existing
-- agent_usage ledger and record_agent_units (mode 'producer'), so it draws on
-- the same monthly assistant allowance the plan already has.
--
-- WRITES: every row below is written by the server with the service role.
-- The policies grant SELECT on your own rows and nothing else — no INSERT,
-- UPDATE or DELETE for anyone holding a session (the 2026-09-24 storage review
-- found what a FOR ALL policy lets a session token do; not again).

-- ── Conversations ─────────────────────────────────────────────────────────
-- One open thread per person (closed_at null). "Start fresh" closes it and
-- opens another; notes carry across, threads don't.
create table if not exists public.producer_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  -- The system prompt and tool list this conversation started with, kept for
  -- its whole life: a deploy that rewords either must not change the prefix
  -- of a conversation already under way (Opus 5.5 would drop its thinking).
  setup jsonb
);
alter table public.producer_threads add column if not exists setup jsonb;

create unique index if not exists producer_threads_one_open
  on public.producer_threads (user_id) where closed_at is null;

alter table public.producer_threads enable row level security;
drop policy if exists "Users read their own producer threads" on public.producer_threads;
create policy "Users read their own producer threads"
  on public.producer_threads for select
  using (auth.uid() = user_id);

-- The conversation itself, APPEND-ONLY. Claude Opus 5.5 ties its thinking to
-- the exact conversation it was produced in, so a history that is edited or
-- rebuilt from the browser silently loses it. `content` is what the model
-- is sent back, byte for byte; `display` is what the sheet shows (text and
-- prepared-send cards), so the UI never has to parse model blocks.
create table if not exists public.producer_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.producer_threads (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seq int not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content jsonb not null,
  display jsonb,
  created_at timestamptz not null default now(),
  unique (thread_id, seq)
);

-- Bounded: a turn carrying two looked-at frames is ~0.5 MB of base64; the
-- bound keeps a bug from storing a film.
alter table public.producer_messages drop constraint if exists producer_messages_size_check;
alter table public.producer_messages add constraint producer_messages_size_check check (
  pg_column_size(content) <= 1500000
);

create index if not exists producer_messages_thread_seq_idx
  on public.producer_messages (thread_id, seq);

alter table public.producer_messages enable row level security;
drop policy if exists "Users read their own producer messages" on public.producer_messages;
create policy "Users read their own producer messages"
  on public.producer_messages for select
  using (auth.uid() = user_id);

-- ── Notes (the memory) ────────────────────────────────────────────────────
-- What the Producer remembers across conversations, as small files under
-- /memories/ (the shape Anthropic's memory tool reads and writes). The person
-- sees every note in the sheet and can edit or delete it; there is no hidden
-- profile.
create table if not exists public.producer_notes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  path text not null check (path ~ '^/memories/[A-Za-z0-9._/ -]{1,120}$'),
  content text not null check (char_length(content) <= 20000),
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);

alter table public.producer_notes enable row level security;
drop policy if exists "Users read their own producer notes" on public.producer_notes;
create policy "Users read their own producer notes"
  on public.producer_notes for select
  using (auth.uid() = user_id);

-- ── Preferences ───────────────────────────────────────────────────────────
-- What the person calls it (operator, 2026-09-24: "User picks" — Producer by
-- default) and when they last looked at the watch list, so the lamp's dot
-- only lights for renders they haven't seen.
create table if not exists public.producer_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 24),
  watch_seen_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.producer_prefs enable row level security;
drop policy if exists "Users read their own producer prefs" on public.producer_prefs;
create policy "Users read their own producer prefs"
  on public.producer_prefs for select
  using (auth.uid() = user_id);

-- ── Switches ──────────────────────────────────────────────────────────────
insert into public.feature_flags (key, enabled, description)
values (
  'producer',
  true,
  'The Producer (Elite personal assistant, Claude Opus 5.5). Off = the lamp disappears and every turn is refused. Needs ANTHROPIC_API_KEY.'
)
on conflict (key) do nothing;

insert into public.feature_flags (key, enabled, description)
values (
  'producer_elite',
  false,
  'The Producer for every Elite account. Off = admins only. Turn on after the admin runs have measured a real turn cost.'
)
on conflict (key) do nothing;

-- ── Check ─────────────────────────────────────────────────────────────────
-- Expected: four rows, each with rls = true and exactly one policy (select).
select c.relname as table_name,
       c.relrowsecurity as rls,
       (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c
 where c.relname in ('producer_threads', 'producer_messages', 'producer_notes', 'producer_prefs')
   and c.relkind = 'r'
 order by c.relname;
