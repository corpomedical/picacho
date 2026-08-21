-- =====================================================================
-- 2026-08-21  Community feed — PENDING, apply to live DB.
--
-- Opt-in public sharing inside the app: a user explicitly shares one of
-- their own finished renders into a community feed; other signed-in users
-- can heart it, views are counted once per account, anything can be
-- reported into the existing admin reports queue, and admins can hide a
-- post without deleting it.
--
-- Design notes:
--   * The post row SNAPSHOTS what the feed needs (media_url,
--     content_type, prompt excerpt, username) at share time, written by a
--     SECURITY DEFINER function from the sharer's own generation row.
--     That keeps the feed a single-table read under RLS — no cross-user
--     reads of generations/profiles are ever needed (their RLS stays
--     owner-only), and media URLs are the app's non-expiring signed
--     /api/media capabilities, so a snapshot never goes stale.
--   * Consent is structural: nothing inserts into community_posts except
--     share_to_community(), which only accepts the caller's OWN succeeded,
--     non-deleted, renderable generation.
--   * Hearts maintain a cached count via trigger; views dedupe per
--     account through community_views' primary key.
--   * Reports reuse generation_reports (the /admin/reports queue) via a
--     definer function, because that table's insert policy is owner-only
--     by design and a community reporter is never the owner.
--
-- Companion code: src/lib/community/actions.ts, src/app/app/community.
-- Everything below is guarded and idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL UNIQUE REFERENCES public.generations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  username text,
  caption text,
  media_url text NOT NULL,
  content_type text NOT NULL DEFAULT 'image' CHECK (content_type IN ('image', 'video')),
  prompt text,
  hearts_count int NOT NULL DEFAULT 0,
  views_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  hidden_at timestamptz
);

CREATE INDEX IF NOT EXISTS community_posts_new
  ON public.community_posts (created_at DESC) WHERE hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS community_posts_top
  ON public.community_posts (hearts_count DESC, created_at DESC) WHERE hidden_at IS NULL;

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='community_posts' AND policyname='Signed-in users see visible posts') THEN
    EXECUTE 'CREATE POLICY "Signed-in users see visible posts" ON public.community_posts FOR SELECT TO authenticated
      USING (hidden_at IS NULL OR auth.uid() = user_id OR is_admin())';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='community_posts' AND policyname='Users unshare their own posts') THEN
    EXECUTE 'CREATE POLICY "Users unshare their own posts" ON public.community_posts FOR DELETE TO authenticated
      USING (auth.uid() = user_id)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='community_posts' AND policyname='Admins moderate posts') THEN
    EXECUTE 'CREATE POLICY "Admins moderate posts" ON public.community_posts FOR UPDATE TO authenticated
      USING (is_admin()) WITH CHECK (is_admin())';
  END IF;
END $$;

-- No INSERT policy on purpose: sharing goes only through the definer
-- function below, so its checks can never be bypassed.
REVOKE ALL ON public.community_posts FROM anon;
GRANT SELECT, DELETE, UPDATE ON public.community_posts TO authenticated;

-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_hearts (
  post_id uuid NOT NULL REFERENCES public.community_posts (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

ALTER TABLE public.community_hearts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='community_hearts' AND policyname='Users manage their own hearts') THEN
    EXECUTE 'CREATE POLICY "Users manage their own hearts" ON public.community_hearts FOR ALL TO authenticated
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)';
  END IF;
END $$;

REVOKE ALL ON public.community_hearts FROM anon;
GRANT SELECT, INSERT, DELETE ON public.community_hearts TO authenticated;

-- Cached hearts_count, maintained by trigger so the feed never aggregates.
CREATE OR REPLACE FUNCTION public.community_hearts_bump()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.community_posts SET hearts_count = hearts_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSE
    UPDATE public.community_posts SET hearts_count = greatest(0, hearts_count - 1) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
END $$;

DROP TRIGGER IF EXISTS community_hearts_bump_trigger ON public.community_hearts;
CREATE TRIGGER community_hearts_bump_trigger
  AFTER INSERT OR DELETE ON public.community_hearts
  FOR EACH ROW EXECUTE FUNCTION public.community_hearts_bump();

-- ---------------------------------------------------------------------
-- One view per account per post, forever — the PK is the dedupe.
CREATE TABLE IF NOT EXISTS public.community_views (
  post_id uuid NOT NULL REFERENCES public.community_posts (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

ALTER TABLE public.community_views ENABLE ROW LEVEL SECURITY;
-- Written only by record_community_view below; nothing reads it directly.
REVOKE ALL ON public.community_views FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- Share: the ONLY write path into community_posts.
CREATE OR REPLACE FUNCTION public.share_to_community(p_generation_id uuid, p_caption text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g record;
  post_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required.'; END IF;

  SELECT gen.id, gen.result_url, gen.content_type, gen.prompt_input, gen.status, gen.deleted_at,
         p.username
    INTO g
    FROM public.generations gen
    JOIN public.profiles p ON p.id = gen.user_id
   WHERE gen.id = p_generation_id AND gen.user_id = auth.uid();

  IF g.id IS NULL THEN RAISE EXCEPTION 'Couldn''t find that generation.'; END IF;
  IF g.status <> 'succeeded' OR g.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only finished renders can be shared.';
  END IF;
  IF g.result_url IS NULL OR (g.result_url NOT LIKE 'http%' AND g.result_url NOT LIKE '/api/media/%') THEN
    RAISE EXCEPTION 'This render has no shareable media.';
  END IF;

  INSERT INTO public.community_posts (generation_id, user_id, username, caption, media_url, content_type, prompt)
  VALUES (
    g.id, auth.uid(), g.username,
    nullif(left(trim(coalesce(p_caption, '')), 200), ''),
    g.result_url,
    CASE WHEN g.content_type = 'video' THEN 'video' ELSE 'image' END,
    left(g.prompt_input, 300)
  )
  ON CONFLICT (generation_id) DO NOTHING
  RETURNING id INTO post_id;

  IF post_id IS NULL THEN
    SELECT id INTO post_id FROM public.community_posts WHERE generation_id = g.id;
  END IF;
  RETURN post_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.share_to_community(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.share_to_community(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_community_view(p_post_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  INSERT INTO public.community_views (post_id, user_id)
  VALUES (p_post_id, auth.uid())
  ON CONFLICT DO NOTHING;
  IF FOUND THEN
    UPDATE public.community_posts SET views_count = views_count + 1 WHERE id = p_post_id;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.record_community_view(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_community_view(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- Community reports land in the existing admin queue (generation_reports),
-- whose insert policy is deliberately owner-only — hence the definer hop.
CREATE OR REPLACE FUNCTION public.report_community_post(p_post_id uuid, p_reason text, p_details text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE gid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required.'; END IF;
  IF p_reason NOT IN ('wrong_result', 'inappropriate', 'technical_error', 'other') THEN
    RAISE EXCEPTION 'Pick a reason for the report.';
  END IF;
  SELECT generation_id INTO gid FROM public.community_posts WHERE id = p_post_id;
  IF gid IS NULL THEN RAISE EXCEPTION 'Post not found.'; END IF;
  INSERT INTO public.generation_reports (generation_id, user_id, reason, details, source)
  VALUES (gid, auth.uid(), p_reason, left(coalesce(p_details, ''), 1000), 'community');
END $$;

REVOKE EXECUTE ON FUNCTION public.report_community_post(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.report_community_post(uuid, text, text) TO authenticated;
