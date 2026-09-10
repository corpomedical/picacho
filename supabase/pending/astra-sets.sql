-- Astra Sets, Phase 1 (2026-09-10): the three switches, and the two tables
-- a Set lives in.
--
-- A Set is a reusable 3D location that GPT-6 Astra builds from a
-- description, as data (never code). The person places a grey stand-in for
-- their character and a camera in it; each still they shoot is an ordinary
-- image take with the character's own photos, gated and identity-scored like
-- any other. Astra never sees the character. Design and measurements:
-- docs/ASTRA_SETS.md.
--
-- RUN THIS BEFORE PUSHING THE CODE. It is idempotent: a second paste is
-- harmless. Every switch is inserted OFF, and the code is admin-only even
-- once the first one is on (src/lib/sets/set-config.ts, SETS_OPEN_TO_PLANS).
--
-- Who writes what: the owner may READ their own live rows, nothing more.
-- Every insert, update and delete goes through the server actions on the
-- service role (src/lib/sets/actions.ts), because the columns worth
-- protecting — the status, the saved set, what it cost us — must never be
-- writable from a browser.
--
-- Deleting a set is a SOFT delete (deleted_at), and that is load-bearing:
-- the monthly build cap counts rows, so a row the person could remove
-- would give the build back — the cap would limit how many sets someone
-- holds, not how many builds we pay for (2026-09-10 review). The deleted
-- row keeps only what the cap and the cost record need; the person's words
-- and the set itself are cleared when it is deleted.

-- ---------------------------------------------------------------------------
-- The switches. Flip in Admin > Feature flags.
-- ---------------------------------------------------------------------------
insert into public.feature_flags (key, enabled, description)
values
  (
    'astra_sets',
    false,
    'Sets: GPT-6 Astra builds a 3D location from a description; you place your character''s stand-in and a camera and shoot stills there. Admins only while in testing. Each build costs about $0.30 of OpenAI time (worst case $1.05 with its one retry). ASTRA_DISABLED=1 in Vercel turns it off instantly.'
  ),
  (
    'astra_photo_sets',
    false,
    'Sets from a photo, and Match this shot (Astra Sets phase 2). Not built yet — leave off.'
  ),
  (
    'astra_previz',
    false,
    'Previz board: Astra blocks out a multi-shot scene inside a Set (Astra Sets phase 3). Not built yet, and ships only if it beats a cheaper model in a blind test — leave off.'
  )
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- A Set.
-- ---------------------------------------------------------------------------
create table if not exists public.location_sets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  status       text not null default 'building',
  -- The person's description of the place, gated before it was sent.
  brief        text not null,
  -- Astra's words, gated before they were saved. description is the one
  -- piece of model text that ever reaches an image model.
  title        text not null default '',
  description  text not null default '',
  -- The normalised set (src/lib/sets/set-spec.ts). Re-normalised on every
  -- read; never trusted as stored.
  spec         jsonb,
  -- Where the person put the stand-in and the camera.
  layout       jsonb,
  -- The OpenAI background response being waited on, while building.
  response_id  text,
  attempts     smallint not null default 0,
  -- Why a build failed: refused | lost | expired | invalid | incomplete | failed | cancelled | start | save.
  failure      text,
  -- What the build cost us at OpenAI, all attempts included.
  cost_usd     numeric(10, 4) not null default 0,
  thumb_path   text,
  deleted_at   timestamptz
);

-- For a table created by an earlier paste of this file.
alter table public.location_sets add column if not exists deleted_at timestamptz;

alter table public.location_sets drop constraint if exists location_sets_status_check;
alter table public.location_sets
  add constraint location_sets_status_check check (status in ('building', 'ready', 'failed'));
alter table public.location_sets drop constraint if exists location_sets_brief_check;
alter table public.location_sets
  add constraint location_sets_brief_check check (char_length(brief) between 1 and 500);
alter table public.location_sets drop constraint if exists location_sets_words_check;
alter table public.location_sets
  add constraint location_sets_words_check check (char_length(title) <= 60 and char_length(description) <= 300);
-- The normaliser keeps a set far under this; the database refuses anything
-- that is not.
alter table public.location_sets drop constraint if exists location_sets_spec_size_check;
alter table public.location_sets
  add constraint location_sets_spec_size_check check (spec is null or pg_column_size(spec) <= 262144);

-- The list, and the monthly count of builds.
create index if not exists location_sets_user_created_idx
  on public.location_sets (user_id, created_at desc);

alter table public.location_sets enable row level security;

drop policy if exists "Owners read their sets" on public.location_sets;
create policy "Owners read their sets"
  on public.location_sets for select to authenticated
  using ((select auth.uid()) = user_id and deleted_at is null);

-- No delete policy, on purpose: see the header.
drop policy if exists "Owners delete their sets" on public.location_sets;

revoke all on public.location_sets from public, anon, authenticated;
grant select on public.location_sets to authenticated;
grant all on public.location_sets to service_role;

-- ---------------------------------------------------------------------------
-- The stills shot in a Set: which takes belong to it, for its contact
-- sheet. The takes themselves are ordinary generations and live in History;
-- deleting a set hides these links with it and never touches the takes.
-- ---------------------------------------------------------------------------
create table if not exists public.location_set_shots (
  set_id        uuid not null references public.location_sets (id) on delete cascade,
  generation_id uuid not null references public.generations (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (set_id, generation_id)
);

create index if not exists location_set_shots_set_created_idx
  on public.location_set_shots (set_id, created_at desc);

alter table public.location_set_shots enable row level security;

drop policy if exists "Owners read their set shots" on public.location_set_shots;
create policy "Owners read their set shots"
  on public.location_set_shots for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.location_set_shots from public, anon, authenticated;
grant select on public.location_set_shots to authenticated;
grant all on public.location_set_shots to service_role;

-- Verify (as yourself, in the SQL editor):
--   select key, enabled from feature_flags where key like 'astra%';   -> 3 rows, all false
--   select count(*) from location_sets;                                -> 0
-- and from the repo: node scripts/verify-db.mjs
