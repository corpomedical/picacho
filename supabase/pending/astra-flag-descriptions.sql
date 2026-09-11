-- Astra Sets (2026-09-11): the three switches' descriptions, made true.
--
-- Admin > Feature flags shows these sentences next to each switch. Two of
-- them were wrong in production, read-only on 2026-09-11:
--   astra_sets    quoted a worst case of $1.05 a build. The closing retry
--                 (build-retry.ts) raised it to $1.155 (set-config.ts:
--                 $0.53 first attempt + $0.625 closing retry).
--   astra_previz  showed a garbled dash. The em dash in
--                 applied/2026-09-10/astra-sets.sql reached the database as
--                 the three characters a Mac shows for UTF-8 read as Mac
--                 Roman. This file is ASCII only, so it cannot happen again.
-- astra_photo_sets now also covers Match this shot (docs/ASTRA_SETS.md,
-- Phase 2: one switch for photo sets and matching).
--
-- ONLY descriptions change. No switch is turned on or off, and the code
-- reads nothing from these sentences, so this can run before or after the
-- push, and a second paste is harmless.

update public.feature_flags
   set description = 'Sets: GPT-6 Astra builds a 3D location from a description; you place your character''s stand-in and a camera and shoot stills there. Admins only while in testing. A build costs about $0.25-$0.45 of OpenAI time (worst case $1.16 with its one retry). ASTRA_DISABLED=1 in Vercel turns it off instantly.'
 where key = 'astra_sets';

update public.feature_flags
   set description = 'Sets from a photo, and Match this shot: Astra rebuilds a place from an uploaded photo with camera 1 where the photographer stood, and reads a reference still''s camera so a set''s camera can match it. Admins only; needs astra_sets on. Worst case $1.82 a photo build with its one retry (three test builds: $0.49-$0.65), $0.17 a match.'
 where key = 'astra_photo_sets';

update public.feature_flags
   set description = 'Previz board: Astra blocks out a multi-shot scene inside a Set (Astra Sets phase 3). Not built yet, and ships only if it beats a cheaper model in a blind test. Leave off.'
 where key = 'astra_previz';

-- Verify (expect three rows with enabled unchanged, then no rows: chr(8218)
-- and chr(196) are the first two characters of the garbled dash):
--   select key, enabled, description from public.feature_flags
--    where key in ('astra_sets', 'astra_photo_sets', 'astra_previz') order by key;
--   select key from public.feature_flags
--    where position(chr(8218) || chr(196) in description) > 0;
