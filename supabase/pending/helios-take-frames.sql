-- Helios takes (2026-09-16): each take keeps what it was rendered from.
--
-- A take is a clip between two stills of a set. When its clip fails, the
-- set page offers "Try the clip again", which renders only the clip between
-- the same two stills (the end still is reused, so only the clip is paid
-- for). The page knew the two stills only in the visit that started the
-- take: a take's row recorded neither, so after a reload a failed take said
-- it failed and offered nothing. This column keeps them on the take's row,
-- as {start, end, engine, direction, film}: the two stills' generation ids,
-- the engine ("omni" or "veo"), the person's direction (at most 300
-- characters), and whether a film rendered it (a film renders its own
-- beats again, so those are never offered on their own).
--
-- Safe in either order. Until the column exists, every take works exactly
-- as before: the frames are written in an update of their own after the
-- take is recorded, whose failure is ignored, and read in a query of their
-- own, whose failure reads as "nothing kept" (src/lib/sets/shot-take.ts is
-- the only code that names the column). Takes rendered before this runs
-- keep nothing, so only takes rendered after it offer the retry after a
-- reload. Idempotent: a second paste is harmless.
--
-- Who writes what: unchanged. The owner may READ their own rows (the
-- table-level SELECT grant covers the new column); every write goes through
-- the server actions on the service role (src/lib/sets/actions.ts). The
-- code re-normalises a stored take on every read and never trusts it as
-- stored; the database only bounds its size.

alter table public.location_set_shots add column if not exists take jsonb;

-- Two ids, an engine, a flag and a direction of at most 300 characters:
-- well under two kilobytes. The database refuses anything past that.
alter table public.location_set_shots drop constraint if exists location_set_shots_take_size_check;
alter table public.location_set_shots
  add constraint location_set_shots_take_size_check check (take is null or pg_column_size(take) <= 2048);

-- No grant, policy or storage change.

-- Verify (as yourself, in the SQL editor):
--   select column_name, data_type from information_schema.columns
--    where table_name = 'location_set_shots' and column_name = 'take';   -> 1 row, jsonb
--   select conname from pg_constraint where conname = 'location_set_shots_take_size_check';   -> 1 row
-- and from the repo: node scripts/verify-db.mjs
