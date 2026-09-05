-- outfit_image_urls escaped the ownership trigger (2026-09-05 audit, confirmed).
--
-- enforce_reference_paths_owned (2026-08-18 hardening) validates ONLY
-- reference_image_urls. outfit-slot.sql (2026-08-24) then added
-- outfit_image_urls to the same table under "same ownership rules as
-- reference_image_urls" — but never extended the trigger. Because
-- `authenticated` holds table-wide UPDATE on character_profiles via
-- PostgREST, a signed-in user can PATCH their OWN character row and set
-- outfit_image_urls to '<victim-uid>/<file>.png'; the character page then
-- mints a valid /api/media capability URL for the victim's private
-- reference photo (/api/media verifies only the HMAC, never the caller).
--
-- The page sink now also filters to the owner's folder (deployed with this
-- change, defense in depth), but the database is where the rule must hold —
-- the pipeline already treats this column as untrusted, the page was the
-- missed sink, and the next sink shouldn't have to remember.
--
-- SAFE TO RUN AHEAD OF THE DEPLOY: purely additive validation; every
-- legitimate write already conforms because saveCharacterProfile filters
-- outfit paths to the caller's folder before writing.
--
-- The existing trigger (trg_enforce_reference_paths_owned, BEFORE INSERT OR
-- UPDATE ON character_profiles) already calls this function — replacing the
-- function body is the whole change; no new trigger needed.
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
  RETURN NEW;
END $$;
