-- Astra Sets (2026-09-12): each still shot in a Set records the camera its
-- frame was taken from.
--
-- A Set shot's "look" keeps a set's car the same car by handing the image
-- model an earlier still from the set. Handed the whole still, GPT Image
-- copied its camera, framing and background too (the operator's first real
-- test, docs/ASTRA_SETS.md). So the look now sends only the set's objects,
-- cut out of the earlier still onto plain grey (src/lib/sets/look-cutout.ts),
-- and to find them in that still the server needs the camera it was framed
-- from: where the camera stood, where it looked, its lens, and the shape of
-- the stage canvas the square frame was cut from. This column holds exactly
-- that, as {position, target, fovDeg, canvasAspect}.
--
-- RUN THIS BEFORE PUSHING THE CODE. It is idempotent: a second paste is
-- harmless.
--
-- Safe in either order, but the order above is the one that works. Until
-- the column exists, every shot still works exactly as before the column:
-- the camera is written in an update of its own after the shot is recorded,
-- whose failure is ignored, and read in queries of their own, whose failure
-- reads as "no camera" (src/lib/sets/shot-camera.ts is the only code that
-- names the column). A still with no camera is simply never a look's source,
-- so until this runs no shot carries a look, and stills shot before it runs
-- never will: the look starts from the first still shot after it.
--
-- Who writes what: unchanged. The owner may READ their own rows (the
-- table-level SELECT grant covers the new column); every write goes through
-- the server actions on the service role (src/lib/sets/actions.ts). The
-- code re-normalises a stored camera on every read and never trusts it as
-- stored; the database only bounds its size.

alter table public.location_set_shots add column if not exists camera jsonb;

-- The code writes about 150 bytes; the database refuses anything far past
-- that.
alter table public.location_set_shots drop constraint if exists location_set_shots_camera_size_check;
alter table public.location_set_shots
  add constraint location_set_shots_camera_size_check check (camera is null or pg_column_size(camera) <= 1024);

-- No grant or policy change: the owner's SELECT on location_set_shots is table-level and covers the
-- new column. No storage change: the cutouts live in the owner's own folder of generated-images
-- (<user>/sets/<set>.look-<still>.jpg), already fenced to each owner by its storage policies
-- (applied/2026-09-09/storage-policies-on-file.sql) and swept whole by account deletion.

-- Verify (as yourself, in the SQL editor):
--   select column_name, data_type from information_schema.columns
--    where table_name = 'location_set_shots' and column_name = 'camera';   -> 1 row, jsonb
--   select conname from pg_constraint where conname = 'location_set_shots_camera_size_check';   -> 1 row
-- and from the repo: node scripts/verify-db.mjs
