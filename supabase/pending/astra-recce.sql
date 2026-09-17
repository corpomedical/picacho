-- The Recce, cut 1 (board K, 2026-09-17): a set from a clip — the switch,
-- and the one column that keeps what the reader saw in the footage.
--
-- A person drops a 3–30 s clip on the Helios home. The browser samples its
-- frames (the clip itself never uploads); the words reader turns them into
-- shots, one person's path, the light and which frame shows the place best;
-- that frame becomes the set's photograph, and the build IS a photo build
-- from there on (astra-photo-sets.sql's columns, unchanged), with the read
-- riding to Astra as a tail so the marks land on the person's path.
-- Design: board K of the Sets canvas; docs/ASTRA_SETS.md.
--
-- RUN THIS BEFORE PUSHING THE CODE. It is idempotent: a second paste is
-- harmless. The switch goes in OFF. Recces are admins only, and need
-- astra_sets AND astra_photo_sets on as well — a recce sends footage frames
-- to the same readers a photo goes to, so photo sets' pin covers it.
--
-- Safe in either order, but the order above is the one that works: until
-- the column exists, a recce build is refused at its reserve with an
-- admin-facing sentence naming this file — after the read (a few cents)
-- but before the picture check, the upload and the Astra call — and every
-- other kind of build keeps working exactly as before, because no existing
-- query names this column (recce-store.ts reads it in its own query, and
-- any failure there reads as "no read").
--
-- What the column holds is the reader's FIELDS about the person's own
-- footage (shots, one person's start and end in metres, the light) — their
-- data, in their row, deleted with the set. Cut 2 reads it back to lay the
-- clip's shots on the Film timeline; nothing reads it yet.

alter table public.location_sets add column if not exists recce_read jsonb;

-- Bounded: the server writes ~2 KB of fields; nothing hand-written ever
-- lands here, but the bound keeps a bug from storing a novel.
alter table public.location_sets drop constraint if exists location_sets_recce_read_check;
alter table public.location_sets add constraint location_sets_recce_read_check check (
  recce_read is null or pg_column_size(recce_read) <= 16384
);

insert into public.feature_flags (key, enabled, description)
values
  (
    'astra_recce',
    false,
    'The Recce: a 3–30 s clip becomes a set — frames are sampled in the browser, the words reader takes the place, path and light, and the photo builder rebuilds the place with marks on the person''s path. Admins only; needs astra_sets AND astra_photo_sets on. About $0.46 a build measured ($0.45 photo build + the read''s cents), worst case ~$1.90 with the photo retry. Run astra-recce.sql first.'
  )
on conflict (key) do update set description = excluded.description;

-- No grant or policy change: the owner's SELECT on location_sets is
-- table-level and covers the new column; every write goes through the
-- server actions on the service role (src/lib/sets/recce-actions.ts).

-- Verify (as yourself, in the SQL editor):
--   select column_name from information_schema.columns
--    where table_name = 'location_sets' and column_name = 'recce_read';   -> 1 row
--   select key, enabled from feature_flags where key = 'astra_recce';     -> enabled false
-- and from the repo: node scripts/verify-db.mjs
