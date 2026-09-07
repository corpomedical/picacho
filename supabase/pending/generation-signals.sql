-- What people actually do with their renders (2026-09-07).
--
-- Operator asked for something algorithmically hard that a competitor cannot
-- copy. The honest answer is that the algorithm is never the hard part — the
-- LABELS are. Every score in this product today is a model's opinion, and a
-- funded team can buy ten thousand of those in a week. What they cannot buy is
-- what a real customer did: downloaded it, built the next shot from it,
-- published it under their own name, or threw it away.
--
-- None of that was written down anywhere. This table is where it goes.
--
-- APPEND-ONLY, and its own table rather than columns on generations, for one
-- specific reason: generations' terminal UPDATE is what makes a render finish,
-- and a write that fails there does not lose a signal, it strands a paid
-- render at status "generating". Nothing about analytics may ever share a
-- statement with that. Every writer is fail-soft — a missing table or a failed
-- insert costs one row of research data and must never reach the user.
--
-- Not a score. A signal is an event that happened at a time; turning events
-- into a preference is analysis, and analysis changes its mind. The record
-- should not need rewriting when it does.
--
-- Vocabulary lives in src/lib/generations/signals.ts and is pinned by a test,
-- because these names end up in stored rows: renaming one splits a dataset in
-- half with no error raised.

create table if not exists public.generation_signals (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.generations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 'downloaded' | 'continued' | 'shared' | 'opened' | 'deleted'
  kind text not null,
  created_at timestamptz not null default now(),
  constraint generation_signals_kind_check
    check (kind in ('downloaded', 'continued', 'shared', 'opened', 'deleted'))
);

-- The two questions this table exists to answer: "what happened to this
-- render" and "what did this person keep".
create index if not exists generation_signals_generation_idx
  on public.generation_signals (generation_id, kind);
create index if not exists generation_signals_user_idx
  on public.generation_signals (user_id, created_at desc);

-- One row per (render, kind). A person who downloads the same image four times
-- has told us one thing, not four, and counting it four times would weight
-- whoever clicks most rather than whatever is best.
create unique index if not exists generation_signals_unique
  on public.generation_signals (generation_id, kind);

alter table public.generation_signals enable row level security;

drop policy if exists "signals read own" on public.generation_signals;
create policy "signals read own"
  on public.generation_signals for select to authenticated
  using (user_id = auth.uid());

-- Writes come from the server with the service role, which bypasses RLS. No
-- client insert policy on purpose: a signal must mean "this happened", and a
-- client that can write its own signals can also write ones that did not.

-- ---------------------------------------------------------------------
-- Verification — safe to run, changes nothing.
-- ---------------------------------------------------------------------
-- select kind, count(*) from public.generation_signals group by kind order by 2 desc;
-- select count(distinct generation_id) as renders_with_any_signal
--   from public.generation_signals;
