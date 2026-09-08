-- drip_candidates() answers the ANONYMOUS key with other people's email
-- addresses, usernames and full names. Verified live on 2026-09-09: a call
-- carrying nothing but the public anon key — the one every browser holds —
-- returned a real user's email. It is a SECURITY DEFINER function that reads
-- profiles for the onboarding drip, meant for the cron's service role only.
--
-- It was "revoked" in applied/2026-08-21/drip-emails.sql — FROM anon,
-- authenticated. Not from PUBLIC. PostgreSQL grants EXECUTE on every new
-- function to PUBLIC, and anon and authenticated are members of PUBLIC, so a
-- revoke that names the two roles but not the group they inherit from
-- changes nothing they can do. Every other revoke in the trail says
-- "FROM public, anon, authenticated" and every one of those functions
-- answers 42501 today; this is the one that left the word out.
--
-- Idempotent. scripts/verify-db.mjs now probes this function (and every
-- other private one) with the anon key on every run, and fails if any of
-- them ever answers again.
REVOKE ALL ON FUNCTION public.drip_candidates() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drip_candidates() TO service_role;
