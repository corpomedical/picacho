-- Blocking on the community feed (2026-09-11).
--
-- Google Play's User Generated Content policy requires an app with a public
-- feed to offer in-app reporting AND blocking. Reporting has existed since
-- August; this is the blocking half. One-directional by design: the blocker
-- stops seeing the blocked account's posts. There are no comments or
-- messages to cut, and a two-way block would require letting people read
-- who blocked them, which is a privacy leak of its own.
--
-- The username is a snapshot taken at block time, the same way
-- community_posts snapshots it, because profiles are readable only by their
-- owner — the Settings list shows the name the person blocked.
--
-- Safe before or after the code ships: nothing blocks anyone until this
-- runs, and sharing without the prompt is refused (with a clear message)
-- until the new share function below exists. Idempotent; one transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS public.community_blocks (
  blocker_id       uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  blocked_id       uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  blocked_username text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT community_blocks_not_self CHECK (blocker_id <> blocked_id)
);

ALTER TABLE public.community_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own blocks" ON public.community_blocks;
CREATE POLICY "Users manage their own blocks"
  ON public.community_blocks FOR ALL TO authenticated
  USING (auth.uid() = blocker_id)
  WITH CHECK (auth.uid() = blocker_id);

REVOKE ALL ON public.community_blocks FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.community_blocks TO authenticated;
GRANT ALL ON public.community_blocks TO service_role;

-- Verify as any user: select count(*) from community_blocks; -> only your own rows.

-- ---------------------------------------------------------------------------
-- The feed hides blocked authors at the ROW level (2026-09-11 review). The
-- first version filtered in the page query with an inlined list of blocked
-- ids, which grows without bound in the request URL and silently empties
-- the feed once it is long enough. In the policy it costs one indexed probe
-- per row, applies to deep links for free, and cannot overflow anything.
-- The owner and admins still see everything, exactly as before.
DROP POLICY IF EXISTS "Signed-in users see visible posts" ON public.community_posts;
CREATE POLICY "Signed-in users see visible posts"
  ON public.community_posts FOR SELECT TO authenticated
  USING (
    (
      hidden_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.community_blocks b
         WHERE b.blocker_id = auth.uid() AND b.blocked_id = community_posts.user_id
      )
    )
    OR auth.uid() = user_id
    OR is_admin()
  );

-- ---------------------------------------------------------------------------
-- Sharing without the prompt, decided INSIDE the definer (2026-09-11
-- review). The share sheet asks whether the prompt goes public; the first
-- version inserted it and removed it in a second request, which left it
-- readable in between and, if the removal failed, public for good. Now the
-- prompt is simply never written when the answer is no.
--
-- THE BODY IS THE 2026-08-31 DEFINITION (community-moderation-sticky.sql,
-- identical to schema.sql) with one added parameter and one changed line.
-- The old two-argument signature is dropped so PostgREST never has to choose
-- between overloads; every existing two-argument call resolves to this one
-- through the default.
DROP FUNCTION IF EXISTS public.share_to_community(uuid, text);
CREATE OR REPLACE FUNCTION public.share_to_community(
  p_generation_id uuid,
  p_caption text DEFAULT NULL,
  p_include_prompt boolean DEFAULT true
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g record;
  post_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required.'; END IF;

  IF EXISTS (SELECT 1 FROM public.community_moderation WHERE generation_id = p_generation_id) THEN
    RAISE EXCEPTION 'This post was removed by moderation and can''t be shared again.';
  END IF;

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
    CASE WHEN p_include_prompt THEN left(g.prompt_input, 300) END,
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

REVOKE EXECUTE ON FUNCTION public.share_to_community(uuid, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.share_to_community(uuid, text, boolean) TO authenticated;

COMMIT;
