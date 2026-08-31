-- =====================================================================
-- 2026-08-31  A moderation decision must survive its subject's own hands.
--
-- FOUND in the site inspection: an admin hides a policy-violating community
-- post by stamping hidden_at on the row — but the OWNER can still see their
-- own hidden post (the SELECT policy deliberately shows it to them), still
-- has the unshare button, and the owner-scoped DELETE policy has no
-- hidden_at guard. So: unshare (deletes the row, and the moderation mark
-- with it), share again (share_to_community inserts a fresh row, hidden_at
-- NULL), and the hidden post is back on the public feed. Repeatable
-- forever, no admin any the wiser.
--
-- Two changes, both idempotent:
--
--   1. The owner's DELETE policy gains `hidden_at IS NULL`: a hidden post
--      cannot be unshared by its owner. It is already invisible to
--      everyone else, so there is nothing legitimate the delete achieves —
--      only the laundering above. Admins moderate via UPDATE as before.
--
--   2. A moderation ledger: hiding also records the generation_id in
--      community_moderation, and share_to_community refuses a generation
--      with a hide on record. Belt and braces: even if a delete slips
--      through some future path, the re-share is what actually relists,
--      and that door is now locked from its own side.
-- =====================================================================

DROP POLICY IF EXISTS "Users unshare their own posts" ON public.community_posts;
CREATE POLICY "Users unshare their own posts" ON public.community_posts FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND hidden_at IS NULL);

CREATE TABLE IF NOT EXISTS public.community_moderation (
  generation_id uuid PRIMARY KEY,
  hidden_by uuid,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  reason text
);
ALTER TABLE public.community_moderation ENABLE ROW LEVEL SECURITY;
-- Admins read it; nobody else needs to. Writes go through the trigger below
-- and the definer function, both owned by the table owner.
DROP POLICY IF EXISTS "Admins read moderation" ON public.community_moderation;
CREATE POLICY "Admins read moderation" ON public.community_moderation FOR SELECT TO authenticated
  USING (is_admin());

-- Record the hide the moment an admin stamps hidden_at, whatever code path
-- did the stamping.
CREATE OR REPLACE FUNCTION public.record_community_hide()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.hidden_at IS NOT NULL AND OLD.hidden_at IS NULL THEN
    INSERT INTO public.community_moderation (generation_id, hidden_by)
    VALUES (NEW.generation_id, auth.uid())
    ON CONFLICT (generation_id) DO NOTHING;
  END IF;
  -- Unhide by an admin is a decision too — it lifts the block on re-sharing.
  IF NEW.hidden_at IS NULL AND OLD.hidden_at IS NOT NULL THEN
    DELETE FROM public.community_moderation WHERE generation_id = NEW.generation_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS community_hide_ledger ON public.community_posts;
CREATE TRIGGER community_hide_ledger
  AFTER UPDATE OF hidden_at ON public.community_posts
  FOR EACH ROW EXECUTE PROCEDURE public.record_community_hide();

-- share_to_community: refuse a generation that has a hide on record. The
-- body below is the 2026-08-21 original with ONE added check — keep any
-- later edits in mind if this ever diverges.
CREATE OR REPLACE FUNCTION public.share_to_community(p_generation_id uuid, p_caption text DEFAULT NULL)
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
    SELECT id INTO post_id FROM public.community_posts WHERE generation_id = p_generation_id;
  END IF;
  RETURN post_id;
END $$;

-- Same ACL as the original definition — CREATE OR REPLACE preserves grants,
-- but restate them so this file is safe on a fresh database too.
REVOKE EXECUTE ON FUNCTION public.share_to_community(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.share_to_community(uuid, text) TO authenticated;
