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
-- Safe before or after the code ships: the feed and Settings read this
-- table fail-open (no table = nobody blocked). Idempotent.

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
-- Sharing without the prompt (2026-09-11). share_to_community snapshots the
-- render's prompt into the post, and the feed shows it whenever there is no
-- caption — so every share published the person's full prompt without ever
-- asking. The share sheet now asks; when the answer is no, the app calls
-- this right after sharing. Owner-only by construction.
CREATE OR REPLACE FUNCTION public.hide_community_post_prompt(p_post_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required.'; END IF;
  UPDATE public.community_posts SET prompt = NULL WHERE id = p_post_id AND user_id = auth.uid();
END $$;

REVOKE EXECUTE ON FUNCTION public.hide_community_post_prompt(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hide_community_post_prompt(uuid) TO authenticated;
