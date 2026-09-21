-- Who is in a character's photos (2026-09-21, Helios R1; lib/characters/likeness.ts).
--
-- Reference photos can now put a person's character into any set, so
-- Picacho asks once who is in a character's photos — "This is me", "I have
-- this person's permission", or "No real person (drawn, 3D or AI-made)" —
-- and keeps the answer: when, which notice, how, where, and for exactly
-- which photos (photos_hash). New photos are asked about again (the
-- operator's decision, 2026-09-21). Picacho's Content Policy forbids making
-- a real person without their consent; this is the record of it.
--
-- Run once in the SQL editor BEFORE the push that carries R1.12. Idempotent
-- — safe to run twice. Written only by the server (service role); a person
-- reads their own answers.

create table if not exists public.character_likeness_consents (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  -- the character asked about; kept as a record when the character is deleted
  character_id    uuid references public.character_profiles (id) on delete set null,
  answer          text not null check (answer in ('me', 'permission', 'not_a_person')),
  -- which photos the answer is about: likeness.ts photosHash of reference_image_urls
  photos_hash     text not null,
  -- the notice shown (likeness.ts LIKENESS_NOTICE_VERSION), set by the server
  notice_version  text not null,
  locale          text not null,
  method          text not null,
  place           text not null check (place in ('character_form', 'helios_cast', 'character_page')),
  consented_at    timestamptz not null default now()
);

create index if not exists character_likeness_consents_character_idx
  on public.character_likeness_consents (character_id, consented_at desc);

alter table public.character_likeness_consents enable row level security;

drop policy if exists "Read own likeness answers" on public.character_likeness_consents;
create policy "Read own likeness answers" on public.character_likeness_consents
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.character_likeness_consents from public, anon, authenticated;
grant select on public.character_likeness_consents to authenticated;
grant all on public.character_likeness_consents to service_role;
