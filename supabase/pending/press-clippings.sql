-- Press Tour › Clippings (2026-10-02). Operator: "Build C, leave X out"
-- (canvas claude.ai/artifact/X8W76bPZJL8r72a4XwH7wS, board C): what the
-- person's OWN posts say works, on one chart, every script broken into its
-- parts, and the formats that beat their usual. Code: src/lib/clippings/.
--
-- The platforms' rules shape every table here:
--   - only the person's own posts, read with the keys THEY gave us
--     (social_connections), or videos they upload and say they made;
--   - one person's posts are never pooled with anyone else's;
--   - disconnecting an account deletes everything read from it: a clip read
--     through a connection points at it ON DELETE CASCADE, so the Disconnect
--     button, a reconnect to another account and account deletion all take
--     the clips with them.
--
-- RUN THIS BEFORE PUSHING THE CODE. Idempotent: a second paste is harmless,
-- and a switch already turned on stays on (ON CONFLICT DO NOTHING).
-- NOTHING HERE TURNS ANYTHING ON: the three switches go in OFF.

begin;

-- ---------------------------------------------------------------------
-- 1. Switches (feature_flags), all inserted OFF. Every one also needs
--    press_tour on (src/lib/clippings/enabled.ts).
-- ---------------------------------------------------------------------
insert into public.feature_flags (key, enabled, description)
values (
  'press_clippings',
  false,
  'Press Tour › Clippings: the person''s own posts on one chart, scripts broken into parts, winning formats. On = the Clippings tab, uploads and Press Tour''s own ads. Instagram and TikTok each have their own switch.'
)
on conflict (key) do nothing;

insert into public.feature_flags (key, enabled, description)
values (
  'press_clippings_instagram',
  false,
  'Clippings reads Instagram views and words. Turn on ONLY after instagram_business_manage_insights is added to the Meta app (connecting then asks for it). Public users need Meta App Review (Advanced Access).'
)
on conflict (key) do nothing;

insert into public.feature_flags (key, enabled, description)
values (
  'press_clippings_tiktok',
  false,
  'Clippings reads TikTok views (TikTok shares no video file, so no words). Turn on ONLY after the video.list scope is added to the TikTok app (connecting then asks for it).'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. press_clips: one row per post or uploaded video, the person's own.
--    People SELECT their own rows; only the service role writes.
-- ---------------------------------------------------------------------
create table if not exists public.press_clips (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  source         text not null,
  connection_id  uuid references public.social_connections (id) on delete cascade,
  external_id    text,
  campaign_id    uuid references public.press_campaigns (id) on delete set null,
  posted_at      timestamptz,
  permalink      text,
  thumb_url      text,
  thumb_path     text,
  caption        text,
  duration_s     numeric,
  views          bigint,
  likes          bigint,
  comments       bigint,
  words_state    text not null default 'pending',
  lines          jsonb not null default '[]'::jsonb,
  format         text,
  why            text,
  cost_usd       numeric not null default 0,
  read_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint press_clips_source check (source in ('instagram', 'tiktok', 'upload')),
  constraint press_clips_connection check ((source = 'upload') = (connection_id is null)),
  constraint press_clips_external_len check (external_id is null or char_length(external_id) between 1 and 128),
  constraint press_clips_permalink_len check (permalink is null or char_length(permalink) <= 500),
  constraint press_clips_thumb_len check (thumb_url is null or char_length(thumb_url) <= 2000),
  constraint press_clips_thumb_path_len check (thumb_path is null or char_length(thumb_path) <= 300),
  constraint press_clips_caption_len check (caption is null or char_length(caption) <= 2200),
  constraint press_clips_duration check (duration_s is null or (duration_s >= 0 and duration_s <= 36000)),
  constraint press_clips_counts check (
    (views is null or views >= 0) and (likes is null or likes >= 0) and (comments is null or comments >= 0)
  ),
  constraint press_clips_words_state check (
    words_state in ('pending', 'read', 'none', 'no_file', 'too_long', 'failed', 'views_only')
  ),
  constraint press_clips_lines check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 40),
  constraint press_clips_format_len check (format is null or char_length(format) <= 40),
  constraint press_clips_why_len check (why is null or char_length(why) <= 300),
  constraint press_clips_cost check (cost_usd >= 0)
);

-- One row per post. Not partial: the read upserts ON CONFLICT (user_id,
-- source, external_id), which a partial index can't answer. Uploads have no
-- external_id, and NULLs never clash, so any number of them fit.
create unique index if not exists press_clips_one_per_post
  on public.press_clips (user_id, source, external_id);
create index if not exists press_clips_user on public.press_clips (user_id, posted_at desc);

alter table public.press_clips enable row level security;
drop policy if exists "Read own clips" on public.press_clips;
create policy "Read own clips" on public.press_clips
  for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.press_clips from public, anon, authenticated;
grant select on public.press_clips to authenticated;
grant all on public.press_clips to service_role;

create or replace function public.press_clips_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'a clip cannot change owner';
  end if;
  new.updated_at := now();
  return new;
end
$function$;
drop trigger if exists trg_press_clips_guard on public.press_clips;
create trigger trg_press_clips_guard
  before insert or update on public.press_clips
  for each row execute function public.press_clips_guard();

-- ---------------------------------------------------------------------
-- 3. press_clip_runs: where the person's last read is (one row each).
-- ---------------------------------------------------------------------
create table if not exists public.press_clip_runs (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  state        text not null default 'idle',
  started_at   timestamptz,
  finished_at  timestamptz,
  done         integer not null default 0,
  total        integer not null default 0,
  error        text,
  cost_usd     numeric not null default 0,
  updated_at   timestamptz not null default now(),
  constraint press_clip_runs_state check (state in ('idle', 'reading')),
  constraint press_clip_runs_counts check (done >= 0 and total >= 0 and done <= 1000 and total <= 1000),
  constraint press_clip_runs_error_len check (error is null or char_length(error) <= 300),
  constraint press_clip_runs_cost check (cost_usd >= 0)
);

alter table public.press_clip_runs enable row level security;
drop policy if exists "Read own clip runs" on public.press_clip_runs;
create policy "Read own clip runs" on public.press_clip_runs
  for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.press_clip_runs from public, anon, authenticated;
grant select on public.press_clip_runs to authenticated;
grant all on public.press_clip_runs to service_role;

-- ---------------------------------------------------------------------
-- 4. The press-clip-uploads bucket: a video the person made, staged at
--    <user>/<clip>/video until the server has read its words, then
--    removed (the cover frame is kept in press-kit). Private, and no
--    storage policy for people: the browser uploads through a signed token
--    the server mints for a path it chose. 50 MB, like Recast.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'press-clip-uploads',
  'press-clip-uploads',
  false,
  52428800,
  array['video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
declare
  bad text;
begin
  select string_agg(policyname, ', ') into bad
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and coalesce(qual, '') || coalesce(with_check, '') ilike '%press-clip-uploads%';
  if bad is not null then
    raise exception 'a storage policy reaches press-clip-uploads: %', bad;
  end if;
end
$$;

commit;
