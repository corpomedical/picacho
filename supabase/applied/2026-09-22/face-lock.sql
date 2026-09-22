-- Face lock, cut 1 (2026-09-18): two switches, both inserted OFF.
--
-- Nothing here changes a table, and the code runs without these rows: a
-- missing row reads as OFF. Running this file only makes the two switches
-- appear in Admin > Feature flags so they can be turned on there.
-- Idempotent — safe to run twice.

-- THE OPENING FRAME (lib/generations/opening-frame.ts). On Kling O3, Kling
-- 2.5, Veo and Wan Turbo the clip opens on a frame of the SHOT, painted from
-- the character's photo and face-checked before any video is paid for,
-- instead of opening on the character's reference photo. A frame that misses
-- the face twice is thrown away and the clip opens on the photo as before.
-- Costs one picture per clip (two when the first misses).
insert into public.feature_flags (key, enabled, description)
values (
  'opening_frame',
  false,
  'Kling O3, Kling 2.5, Veo and Wan Turbo clips open on a face-checked frame of the shot instead of the character''s photo. Costs about 6-8 cents a clip.'
)
on conflict (key) do nothing;

-- THE REFUND FOR A WRONG FACE (lib/generations/face-lock.ts). Every character
-- clip's face is now read at the start, the middle and the end, and the
-- lowest counts, whatever this says. With it ON, a clip whose lowest frame
-- falls under the identity bar (Admin > Settings) is delivered and NOT
-- charged for — while we still pay the provider for it. A deliberate
-- exception to "charge when the provider charged us", so it is the
-- operator's switch, not a default.
insert into public.feature_flags (key, enabled, description)
values (
  'video_face_refund',
  false,
  'Do not charge for a character clip whose face falls under the identity bar at the start, middle or end. We still pay the provider for it.'
)
on conflict (key) do nothing;
