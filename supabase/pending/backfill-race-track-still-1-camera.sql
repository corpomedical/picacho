-- Backfill: the camera of the race-track set's first still (2026-09-14).
--
-- location_set_shots.camera arrived on 2026-09-14 (applied/2026-09-14/
-- set-shot-camera.sql). The two stills shot before it have none, so neither
-- can lend its look; the first still shot after it (generation 5095a888…,
-- 09:33 EEST) had nothing to take a look from, went without one, and came
-- out with a different car. Still 1 (generation c29c279e…) is the car the
-- operator wants kept.
--
-- Its camera was fitted to eight points of the car read off its own sketch
-- (12 px rms on 1024; src/lib/sets/look-cutout.test.ts, STILL_1), and its
-- figure is the mark the saved layout still holds, where that sketch shows
-- it. That camera's cut, run through fal on 2026-09-14 by the product's own
-- modules, came back as the car whole on grey with nothing of the person
-- (docs/ASTRA_SETS.md, "The look"). With it recorded, still 1 offers
-- "Use its look" on the set page and the next shot carries that car.
--
-- Idempotent: writes only where no camera is recorded; safe to run twice.
update public.location_set_shots
   set camera = '{"position":[-3.674,1.894,4.691],"target":[-0.361,1.128,1.025],"fovDeg":44.7,"canvasAspect":1.7777777777777777,"figure":{"x":1.39,"z":2.37}}'::jsonb
 where set_id = 'dedbbb65-3982-4886-853d-e02e180d06fb'
   and generation_id = 'c29c279e-ca75-4a8c-8b9a-bd9ade91c607'
   and camera is null;

-- Verify (expect one row, camera not null):
-- select generation_id, camera from public.location_set_shots
--  where generation_id = 'c29c279e-ca75-4a8c-8b9a-bd9ade91c607';
