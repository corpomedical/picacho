-- The expression set (2026-09-19): nine close-ups of a character — the face
-- at rest, the teeth, the smile, the laugh, the eyes, both profiles, both
-- three-quarter views — each the person's own photo or one Picacho made
-- from their photos, sent beside photo 1 when a shot needs it
-- (lib/characters/expression-set.ts).
--
-- SAFE TO RUN AHEAD OF THE DEPLOY, AND THE CODE RUNS WITHOUT IT. The one
-- module that names the column (expression-set-store.ts) reads it in a
-- query of its own: until this runs, every character reads as having no
-- set, renders are exactly as before, and making a close-up says the
-- database needs this update. Idempotent — safe to run twice.

-- 1. The column: slot → { path, source, likeness, at }. Nine entries of about
-- 200 bytes each; the cap leaves room and stops anything else being stored.
ALTER TABLE public.character_profiles ADD COLUMN IF NOT EXISTS expression_set jsonb;
ALTER TABLE public.character_profiles DROP CONSTRAINT IF EXISTS character_profiles_expression_set_check;
ALTER TABLE public.character_profiles
  ADD CONSTRAINT character_profiles_expression_set_check
  CHECK (
    expression_set IS NULL
    OR (jsonb_typeof(expression_set) = 'object' AND pg_column_size(expression_set) <= 8192)
  );

-- 2. The ownership rule reaches it. `authenticated` holds table-wide UPDATE on
-- character_profiles through PostgREST, so a signed-in person could PATCH
-- their own row with another person's storage path in the set, and the
-- character page would mint a working media link for it — the hole
-- outfit-ownership.sql closed for outfit_image_urls on 2026-09-05. The page
-- and the render already drop any path outside the owner's folder
-- (normaliseExpressionSet); the database is where the rule must hold.
--
-- The existing trigger (trg_enforce_reference_paths_owned, BEFORE INSERT OR
-- UPDATE ON character_profiles) already calls this function. Its first two
-- checks are exactly those in applied/2026-09-05/outfit-ownership.sql and
-- schema.sql; the third is new.
CREATE OR REPLACE FUNCTION public.enforce_reference_paths_owned()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.reference_image_urls IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(NEW.reference_image_urls) u
    WHERE u IS NULL OR position((NEW.user_id::text || '/') in u) <> 1
  ) THEN
    RAISE EXCEPTION 'reference_image_urls must all be under the owner''s storage folder';
  END IF;
  IF NEW.outfit_image_urls IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(NEW.outfit_image_urls) u
    WHERE u IS NULL OR position((NEW.user_id::text || '/') in u) <> 1
  ) THEN
    RAISE EXCEPTION 'outfit_image_urls must all be under the owner''s storage folder';
  END IF;
  IF NEW.expression_set IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_each(NEW.expression_set) e
    WHERE jsonb_typeof(e.value) <> 'object'
       OR (e.value ->> 'path') IS NULL
       OR position((NEW.user_id::text || '/') in (e.value ->> 'path')) <> 1
  ) THEN
    RAISE EXCEPTION 'expression_set paths must all be under the owner''s storage folder';
  END IF;
  RETURN NEW;
END $$;

-- What you should see afterwards (one row, true / true):
--   select
--     exists (select 1 from information_schema.columns
--             where table_schema = 'public' and table_name = 'character_profiles'
--               and column_name = 'expression_set') as column_there,
--     pg_get_functiondef('public.enforce_reference_paths_owned'::regproc) like '%expression_set%' as trigger_covers_it;
