-- Helios Cinema (2026-09-15, canvas page I): the rig.
--
-- location_sets.rig — the set's saved rig: format, film stock, lens, stop,
-- light scheme, palette, era, genre (rig.ts normaliseSetRig is the one door
-- in and out).
-- location_set_shots.rig — the rig each shot was shot with: the format it
-- was cut to and each checked look's words exactly as sent (shot-rig.ts).
-- location_set_shots.rig_check — what the rig check read back from the
-- still (rig-check.ts), kept so a page load never asks again.
--
-- The page and every shot work without these columns; they just cannot
-- remember the rig between visits, show a still's rig line, or keep a
-- check until they exist. Idempotent, like every file here.
alter table public.location_sets add column if not exists rig jsonb;
alter table public.location_set_shots add column if not exists rig jsonb;
alter table public.location_set_shots add column if not exists rig_check jsonb;
