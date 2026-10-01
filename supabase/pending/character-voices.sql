-- A character's voice can come from ElevenLabs' library, be generated from a
-- description, or be the person's own cloned voice (2026-10-01, operator:
-- "Build a full voice picker and generator on characters like in
-- Elevenlabs"; his picks: the full library limited to safe voices, Generate
-- for Studio and Elite only, cloning of the person's own voice only, the
-- voice sheet).
--
-- voice_presets was one catalogue that every signed-in person could read
-- (the 13 curated voices Aly and every character pick from). A voice a
-- person picks from the library, generates or clones becomes a row OWNED by
-- them: owner_id set, readable by them alone (and by admins), never part of
-- the curated catalogue. character_profiles.voice_id keeps pointing at
-- voice_presets, so every reader of a character's voice works unchanged.
--
-- RUN THIS BEFORE PUSHING THE CODE. The code filters the curated list on
-- owner_id, so until this has run the character form, Aly's voice list and
-- the automatic voice for a new character would fail to read the catalogue.
-- Idempotent: a second paste is harmless.

-- 1. Who owns the voice (null: the curated catalogue), where it came from,
--    what the library said about it, and when its owner agreed to a clone.
alter table public.voice_presets
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists source text not null default 'curated',
  add column if not exists attributes jsonb not null default '{}'::jsonb,
  add column if not exists consent_at timestamptz,
  add column if not exists consent_text text;

alter table public.voice_presets
  drop constraint if exists voice_presets_source_check;
alter table public.voice_presets
  add constraint voice_presets_source_check
  check (source in ('curated', 'library', 'designed', 'cloned'));

-- A curated voice has no owner; every other kind has one. A clone carries
-- the consent its owner gave.
alter table public.voice_presets
  drop constraint if exists voice_presets_owner_check;
alter table public.voice_presets
  add constraint voice_presets_owner_check
  check (
    (source = 'curated' and owner_id is null)
    or (source <> 'curated' and owner_id is not null)
  );
alter table public.voice_presets
  drop constraint if exists voice_presets_clone_consent_check;
alter table public.voice_presets
  add constraint voice_presets_clone_consent_check
  check (source <> 'cloned' or (consent_at is not null and consent_text is not null));

-- One row per person per ElevenLabs voice: picking the same library voice
-- for a second character reuses the first row.
create unique index if not exists voice_presets_owner_voice_key
  on public.voice_presets (owner_id, elevenlabs_voice_id)
  where owner_id is not null;
create index if not exists voice_presets_owner_idx
  on public.voice_presets (owner_id)
  where owner_id is not null;

-- 2. Reading: the curated catalogue for every signed-in person, your own
--    voices for you, everything for admins. Writes stay admin-only through
--    the existing policies; a person's own voices are written by the server
--    (service role) after it has checked their plan and limits.
drop policy if exists "Authenticated users can read voice presets" on public.voice_presets;
create policy "Authenticated users can read voice presets" on public.voice_presets
  for select to authenticated
  using (
    owner_id is null
    or owner_id = (select auth.uid())
    or (select is_admin())
  );

-- Check: every value should be true.
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'voice_presets' and column_name = 'owner_id') as has_owner_id,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'voice_presets' and column_name = 'source') as has_source,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'voice_presets' and column_name = 'attributes') as has_attributes,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'voice_presets' and column_name = 'consent_at') as has_consent_at,
  to_regclass('public.voice_presets_owner_voice_key') is not null as has_unique_index,
  exists (select 1 from pg_policies where tablename = 'voice_presets' and policyname = 'Authenticated users can read voice presets' and qual like '%owner_id%') as policy_updated,
  not exists (select 1 from public.voice_presets where source <> 'curated') as existing_rows_curated;
