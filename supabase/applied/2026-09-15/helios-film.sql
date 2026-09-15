-- Helios Film (2026-09-15): the set's saved move — engine, start still and
-- up to three beats (film.ts normaliseSetFilm is the one door in and out).
-- The page works without this column; it just cannot remember the move
-- between visits until it exists. Idempotent, like every file here.
alter table public.location_sets add column if not exists film jsonb;
