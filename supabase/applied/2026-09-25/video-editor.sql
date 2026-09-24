-- The video editor (2026-09-24): raw footage in, a finished edit out, cut
-- by Claude Opus 5.5 and drawn by HeyGen's HyperFrames renderer. Code:
-- src/lib/editor/.
--
-- APPLIED 2026-09-25 (the operator ran it: "SQL ran fine"). Idempotent: a second
-- paste is harmless.
--
-- ONE SWITCH (operator, 2026-09-24: "Admins only"):
--   video_editor  ON — the editor exists: admins can use it. Off hides it
--                      everywhere and the job runner stops advancing edits
--                      (the kill switch).
-- There is no switch for paid plans yet on purpose: edits are not charged in
-- credits until a price is set, so opening it to plans ships with pricing.

-- ONE ROW PER EDIT. Every write is the server's (service role): people may
-- read their own rows and nothing else — no insert/update/delete policy.
create table if not exists public.video_edits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  brief text not null default '' check (char_length(brief) <= 4000),
  aspect text not null default '16:9' check (aspect in ('16:9', '9:16', '1:1')),
  target_seconds integer check (target_seconds is null or target_seconds between 5 and 180),
  -- The uploaded files and, once analysed, what was learned from each
  -- (probe, shot changes, silences, words). Contact sheets live in storage.
  clips jsonb not null default '[]'::jsonb,
  stage text not null default 'uploading'
    check (stage in ('uploading', 'analyzing', 'directing', 'bundling', 'rendering', 'done', 'failed')),
  progress text,
  -- The director's conversation after its opening message (lib/editor/director.ts DirectorState).
  director jsonb,
  plan jsonb,
  -- HeyGen's asset and render ids, and when the render was asked for.
  render jsonb,
  generation_id uuid references public.generations(id) on delete set null,
  error text,
  cost_usd numeric(10, 4) not null default 0,
  attempts integer not null default 0,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Bounds, so a bug cannot store a novel.
  constraint video_edits_clips_size check (pg_column_size(clips) <= 2097152),
  constraint video_edits_director_size check (director is null or pg_column_size(director) <= 4194304),
  constraint video_edits_plan_size check (plan is null or pg_column_size(plan) <= 262144)
);

alter table public.video_edits enable row level security;

drop policy if exists "Users can view their own edits" on public.video_edits;
create policy "Users can view their own edits" on public.video_edits
  for select to authenticated using (user_id = (select auth.uid()));

create index if not exists video_edits_user_created on public.video_edits (user_id, created_at desc);
create index if not exists video_edits_working on public.video_edits (updated_at)
  where stage in ('analyzing', 'directing', 'bundling', 'rendering');

-- THE FOOTAGE BUCKET. Private. Files arrive only through signed upload
-- tokens the server mints for a path it chose (<user>/<edit>/clip-<n>.<ext>),
-- so there are no storage policies for people at all: nobody can list, read,
-- overwrite or delete footage with their own session. The server reads it
-- with the service role.
--
-- 1 GB a file. NOTE: Supabase also has a project-wide upload limit
-- (Dashboard → Storage → Settings, "Upload file size limit"); a file bigger
-- than THAT is refused whatever this says.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'edit-footage',
  'edit-footage',
  false,
  1073741824,
  array['video/mp4', 'video/quicktime', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'image/jpeg']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into public.feature_flags (key, enabled, description)
values (
  'video_editor',
  true,
  'Video editor (Opus 5.5 + HyperFrames): raw footage in, finished edit out. Off = hidden everywhere and no edit advances. Needs ANTHROPIC_API_KEY, OPENAI_API_KEY, HEYGEN_API_KEY.'
)
on conflict (key) do nothing;

-- VERIFY (should list the table with RLS on, one policy, the bucket private at 1 GB, and the flag on):
-- select relname, relrowsecurity from pg_class where relname = 'video_edits';
-- select policyname, cmd from pg_policies where tablename = 'video_edits';
-- select id, public, file_size_limit from storage.buckets where id = 'edit-footage';
-- select key, enabled from public.feature_flags where key = 'video_editor';
