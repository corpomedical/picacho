-- Settings → Generation (2026-09-11): per-account composer defaults.
--
-- The video model, the clip length and the aspect ratio reset on every visit
-- to the composer, and sound was hard-wired on for every video. These let a
-- person set their own starting point. NULL means "Picacho's default" —
-- the admin's global video_model setting and each model's own default
-- length — so nothing changes for anyone until they choose.
--
-- Safe before or after the code ships: every reader is a separate,
-- fail-open query (no column = no preference). Idempotent.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_video_model    text,
  ADD COLUMN IF NOT EXISTS default_aspect_ratio   text,
  ADD COLUMN IF NOT EXISTS default_video_duration integer,
  ADD COLUMN IF NOT EXISTS video_sound            boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_default_aspect_ratio_check') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_default_aspect_ratio_check
      CHECK (default_aspect_ratio IS NULL OR default_aspect_ratio IN ('16:9', '9:16'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_default_video_duration_check') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_default_video_duration_check
      CHECK (default_video_duration IS NULL OR default_video_duration BETWEEN 1 AND 60);
  END IF;
END $$;

-- Verify: select default_video_model, default_aspect_ratio, default_video_duration, video_sound
--           from profiles limit 1;   -> nulls and true
