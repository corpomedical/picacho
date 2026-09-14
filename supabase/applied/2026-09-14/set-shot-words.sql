-- Astra Sets (2026-09-14): each still shot in a Set records what the person
-- asked for, in their own words.
--
-- A set's page is now a conversation with Astra: the person says who is in
-- the frame, what happens and where the camera stands; Astra frames the shot
-- and, on their word, shoots it. The still is a take in History as before.
-- What was ASKED was nowhere: the shot prompt carries a cleaned direction
-- folded into Picacho's own sentences, and a conversation reopened tomorrow
-- must show the person's message as they wrote it, above the still it led
-- to. This column holds exactly that, at most 600 characters.
--
-- RUN THIS BEFORE PUSHING THE CODE. It is idempotent: a second paste is
-- harmless.
--
-- Safe in either order. Until the column exists, every shot works exactly
-- as before it: the words are written in an update of their own after the
-- shot is recorded, whose failure is ignored, and read in a query of its
-- own, whose failure reads as "no words" (src/lib/sets/shot-words-store.ts
-- is the only code that names the column). A shot without them shows as
-- "Shoot" in the conversation.
--
-- Who writes what: unchanged. The owner may READ their own rows (the
-- table-level SELECT grant covers the new column); every write goes through
-- the server actions on the service role (src/lib/sets/actions.ts). The
-- words are the person's own message, shown back only to them.

alter table public.location_set_shots add column if not exists words text;

alter table public.location_set_shots drop constraint if exists location_set_shots_words_length_check;
alter table public.location_set_shots
  add constraint location_set_shots_words_length_check check (words is null or char_length(words) <= 600);

-- No grant or policy change: the owner's SELECT on location_set_shots is table-level and covers the
-- new column.

-- Verify (as yourself, in the SQL editor):
--   select column_name, data_type from information_schema.columns
--    where table_name = 'location_set_shots' and column_name = 'words';   -> 1 row, text
--   select conname from pg_constraint where conname = 'location_set_shots_words_length_check';   -> 1 row
