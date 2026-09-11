-- Astra Sets, Phase 2 (2026-09-11): Sets from a photo — the two columns
-- that mark a build as one built from a photo, and where that photo is.
--
-- A person uploads a photo of a place; after the picture check passes, the
-- photo is stored under their own folder (generated-images/<user>/sets/
-- <set>.photo.jpg) and GPT-6 Astra rebuilds the place as a Set with camera 1
-- where the photographer stood. Design: docs/ASTRA_SETS.md, section 3.2.
--
-- RUN THIS BEFORE PUSHING THE CODE. It is idempotent: a second paste is
-- harmless. The switch (astra_photo_sets) already exists and stays OFF; this
-- file only refreshes its description. Photo sets are admins only, and need
-- astra_sets on as well.
--
-- Safe in either order, but the order above is the one that works: until
-- these columns exist, a photo build is refused at its first write with an
-- admin-facing sentence naming this file — before any reader, upload or
-- OpenAI call, so nothing is spent — and text sets keep working exactly as
-- before, because no existing query names these columns (the code reads
-- them in a separate query whose failure means "a text build").
--
-- Who writes what: unchanged. The owner may READ their own live rows
-- (the table-level SELECT grant covers new columns); every write goes
-- through the server actions on the service role (src/lib/sets/actions.ts).
--
-- A non-null source_photo_path is what makes a build a photo build. It is
-- pinned HERE to the owner's own folder and this set's own file, so no row
-- can point a set at anyone else's file. The hash is of the exact bytes that
-- passed the picture check: a retry resends the stored photo only if it
-- still hashes to it (the owner can write to their own folder). Deleting a
-- set removes the photo and clears both columns; a build that fails removes
-- the photo and keeps the columns as the record of what kind of build it was.
-- A photo build with no notes stores "-" in brief (its 1–500 CHECK stays).

alter table public.location_sets add column if not exists source_photo_path text;
alter table public.location_sets add column if not exists source_photo_sha256 text;

alter table public.location_sets drop constraint if exists location_sets_source_photo_check;
alter table public.location_sets add constraint location_sets_source_photo_check check (
  (source_photo_path is null) = (source_photo_sha256 is null)
  and (source_photo_sha256 is null or source_photo_sha256 ~ '^[0-9a-f]{64}$')
  and (source_photo_path is null or source_photo_path = user_id::text || '/sets/' || id::text || '.photo.jpg')
);

update public.feature_flags
   set description = 'Sets from a photo: Astra rebuilds a location from an uploaded photo, camera 1 where the photographer stood. Admins only; needs astra_sets on. Worst case $1.82 a build with its one retry (three test builds: $0.49–$0.65). Run astra-photo-sets.sql first.'
 where key = 'astra_photo_sets';

-- No grant or policy change: the owner's SELECT on location_sets is table-level and covers new columns.
-- No storage change: generated-images is already fenced to each owner's own folder by its storage
-- policies (applied/2026-09-09/storage-policies-on-file.sql), and account deletion sweeps it whole.

-- Verify (as yourself, in the SQL editor):
--   select column_name from information_schema.columns
--    where table_name = 'location_sets' and column_name like 'source_photo%';   -> 2 rows
--   select key, enabled, description from feature_flags where key = 'astra_photo_sets';   -> enabled false, the new description
-- and from the repo: node scripts/verify-db.mjs
