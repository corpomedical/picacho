-- =====================================================================
-- 2026-08-22  generations write lockdown — CLOSES A REFERRAL FARMING HOLE.
-- Apply BEFORE (or together with) the referral changes going live.
--
-- THE HOLE: generations still carried PostgREST's default table-wide
-- INSERT/UPDATE grant to `authenticated`, row-scoped only by the "Users
-- manage their own generations" RLS policy. Harmless until the referral
-- reward trigger (reward_referral_on_success) started paying credits the
-- instant a row's status becomes 'succeeded'. With the table-wide grant, a
-- referred user could open the browser console and, with the public anon
-- key + their own session:
--
--   INSERT INTO generations (user_id, status, content_type)
--   VALUES (auth.uid(), 'succeeded', 'image');   -- passes RLS (own row)
--
-- firing the trigger with NO render and NO provider cost — defeating the
-- entire "a real render costs the farmer money first" anti-farm premise
-- and minting +1 to both sides per disposable-email account, up to the
-- 20/month cap. Same trick via UPDATE ... SET status='succeeded' on a
-- self-inserted 'generating' row.
--
-- THE FIX (the column lockdown documented in pending-2026-08-19/
-- gallery.sql, now security-critical rather than cosmetic): revoke blanket
-- write, re-grant ONLY the three columns a user session legitimately
-- writes. Verified against every write path in the app on 2026-08-22:
--   * INSERT: only public.reserve_generation (SECURITY DEFINER, service
--     role) ever inserts a row — always as 'generating', never succeeded.
--   * user-session UPDATE (createClient): cancel_requested (Stop button),
--     feedback (thumbs), deleted_at (soft delete). NOTHING else.
--   * everything else — status, match_score, credits_used, pipeline_log,
--     result_url, attempts, progress_stage, featured_at — writes through
--     the service-role admin client, which is exempt from these grants.
-- After this, the ONLY way a row reaches status='succeeded' is the real
-- pipeline, so the reward trigger can never be fired by a forged row.
--
-- RLS is unchanged: the "Users manage their own generations" policy still
-- row-scopes these column updates to the owner. Grants and RLS are AND-ed,
-- so revoking the grant blocks the write regardless of policy.
-- =====================================================================

REVOKE INSERT, UPDATE, DELETE ON public.generations FROM authenticated;
-- anon has no session (can't pass RLS) but should never hold write grants
-- either — belt to that suspender.
REVOKE INSERT, UPDATE, DELETE ON public.generations FROM anon;

-- The three columns a signed-in user genuinely edits on their own rows.
-- None can forge a reward: the trigger fires only on UPDATE OF status, and
-- status is deliberately NOT in this list.
GRANT UPDATE (cancel_requested, feedback, deleted_at) ON public.generations TO authenticated;

-- SELECT is untouched above (only write verbs revoked), so users still read
-- their own rows and admins still read all — but make the read grant
-- explicit rather than relying on a default that a future REVOKE ALL could
-- take with it.
GRANT SELECT ON public.generations TO authenticated;
