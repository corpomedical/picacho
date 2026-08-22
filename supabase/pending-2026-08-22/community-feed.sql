-- =====================================================================
-- 2026-08-22  Community swipe feed — PENDING, apply BEFORE the deploy
-- that ships the new feed (the page's select names the new columns, so
-- deploying first would break the community page until this runs).
--
-- The feed shows Picacho's signature on every post — the identity score —
-- plus the character's name. Neither was in the community_posts snapshot
-- (and viewers can't read other people's generations rows under RLS, by
-- design), so both join the snapshot: two new columns, share_to_community
-- stamping them for new shares, and a backfill for existing posts.
-- =====================================================================

ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS match_score int,
  ADD COLUMN IF NOT EXISTS character_name text;

-- Same function as community.sql, now snapshotting score + character name.
CREATE OR REPLACE FUNCTION public.share_to_community(p_generation_id uuid, p_caption text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g record;
  post_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required.'; END IF;

  SELECT gen.id, gen.result_url, gen.content_type, gen.prompt_input, gen.status, gen.deleted_at,
         gen.match_score, ch.name AS character_name,
         p.username
    INTO g
    FROM public.generations gen
    JOIN public.profiles p ON p.id = gen.user_id
    LEFT JOIN public.character_profiles ch ON ch.id = gen.character_profile_id
   WHERE gen.id = p_generation_id AND gen.user_id = auth.uid();

  IF g.id IS NULL THEN RAISE EXCEPTION 'Couldn''t find that generation.'; END IF;
  IF g.status <> 'succeeded' OR g.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only finished renders can be shared.';
  END IF;
  IF g.result_url IS NULL OR (g.result_url NOT LIKE 'http%' AND g.result_url NOT LIKE '/api/media/%') THEN
    RAISE EXCEPTION 'This render has no shareable media.';
  END IF;

  INSERT INTO public.community_posts
    (generation_id, user_id, username, caption, media_url, content_type, prompt, match_score, character_name)
  VALUES (
    g.id, auth.uid(), g.username,
    nullif(left(trim(coalesce(p_caption, '')), 200), ''),
    g.result_url,
    CASE WHEN g.content_type = 'video' THEN 'video' ELSE 'image' END,
    left(g.prompt_input, 300),
    g.match_score,
    left(g.character_name, 80)
  )
  ON CONFLICT (generation_id) DO NOTHING
  RETURNING id INTO post_id;

  IF post_id IS NULL THEN
    SELECT id INTO post_id FROM public.community_posts WHERE generation_id = g.id;
  END IF;
  RETURN post_id;
END $$;

-- Backfill the posts shared before these columns existed.
UPDATE public.community_posts cp
   SET match_score = g.match_score,
       character_name = left(ch.name, 80)
  FROM public.generations g
  LEFT JOIN public.character_profiles ch ON ch.id = g.character_profile_id
 WHERE cp.generation_id = g.id
   AND cp.match_score IS NULL
   AND cp.character_name IS NULL;
