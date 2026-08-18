-- =====================================================================
-- 2026-08-19  Auth / admin / API hardening — PENDING, apply to live DB.
--
-- Companion SQL for the fixes in:
--   src/lib/profile/actions.ts      (username integrity: unique + format)
--   src/lib/api/actions.ts          (race-safe API-key cap)
--   src/app/admin/page.tsx          (admin_traffic_daily role check)
--   src/lib/rate-limit.ts           (per-feature rate-limit scopes)
--
-- Ordering: src/lib/api/actions.ts createApiKey FAILS CLOSED until this
-- file is applied (it calls create_api_key_capped and returns a retry
-- error when the function is missing). src/lib/rate-limit.ts keeps
-- working meanwhile by falling back to the 3-arg api_rate_check (one
-- shared 'legacy' bucket per user — the pre-fix behaviour, see section
-- 4). Everything else here is defense-in-depth over behaviour that
-- keeps working meanwhile.
--
-- Advisory-lock keyspace (per-user, hashtextextended(user_id, KEY)):
--   0 = api_rate_check (lock text salted with scope as of section 4),
--   7 = record_prompt_assist, 11 = claim_job_advance,
--   23 = reserve_generation(s), 29 = reference images (also
--   'model_health:'-keyed in pipeline.sql), 31 = saved prompts,
--   37 = brand rules. New key claimed here: 41 (API-key creation).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Username integrity (profile/actions.ts updateUsername).
--
-- Uniqueness and format lived only in app code: the pre-check raced
-- (two concurrent claims both read "free" and both wrote), the ilike
-- check treated `_` as a wildcard, and nothing at the database level
-- stopped a service-role code path from writing any string at all.
-- The unique index on lower(username) is the real guarantee — the
-- action now maps its 23505 to the normal "taken" message — and the
-- CHECK pins the same format the app enforces (signup, updateUsername,
-- username_available all use ^[a-z0-9_]{3,24}$).
--
-- OPERATOR — reconcile BEFORE applying:
--   a) duplicates: the index build fails while two profiles share a
--      username case-insensitively. Find them with
--        SELECT lower(username), count(*) FROM public.profiles
--         GROUP BY 1 HAVING count(*) > 1;
--      and rename the newer account(s) first.
--   b) format: the signup trigger's provisional usernames are derived
--      from email local parts and may contain dots/uppercase/length
--      violations. The CHECK is added NOT VALID so existing rows don't
--      block it and only NEW writes are constrained; list violators with
--        SELECT id, username FROM public.profiles
--         WHERE username IS NOT NULL AND username !~ '^[a-z0-9_]{3,24}$';
--      rename them, then run the commented VALIDATE below.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_key
  ON public.profiles (lower(username));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'profiles_username_format'
       AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_username_format
      CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,24}$')
      NOT VALID;
  END IF;
END $$;

-- OPERATOR: run once the violator list above is empty:
-- ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_username_format;

-- ---------------------------------------------------------------------
-- 2. Race-safe API-key cap (api/actions.ts createApiKey).
--
-- The action counted active keys and then inserted — two statements, no
-- atomicity, so a concurrent burst all counted 4 and all inserted,
-- sailing past MAX_ACTIVE_KEYS with live credentials. Same advisory-lock
-- check-and-insert as reserve_generation and friends; lock key 41 (new —
-- see the keyspace note in the header). Returns whether the key was
-- created (false = cap already reached, nothing inserted).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_api_key_capped(
  p_user_id uuid, p_max int, p_name text, p_prefix text, p_key_hash text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE active int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 41));
  SELECT count(*) INTO active FROM public.api_keys
   WHERE user_id = p_user_id AND revoked_at IS NULL;
  IF active >= p_max THEN RETURN false; END IF;
  INSERT INTO public.api_keys (user_id, name, prefix, key_hash)
  VALUES (p_user_id, p_name, p_prefix, p_key_hash);
  RETURN true;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_api_key_capped(uuid,int,text,text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_api_key_capped(uuid,int,text,text,text) TO service_role;

-- ---------------------------------------------------------------------
-- 3. admin_traffic_daily: role check inside the function.
--
-- The dashboard calls this RPC with the CALLER'S OWN session client, so
-- EXECUTE is necessarily granted to authenticated — which meant any
-- signed-in user could call it directly over PostgREST and read the
-- whole site's daily traffic aggregates, sidestepping the admin layout
-- gate entirely (SECURITY DEFINER sees past page_views RLS). The
-- function now verifies the caller's profile role itself, the same
-- pattern the app's requireAdmin() applies in code.
--
-- OPERATOR: the original function ships in the admin_traffic_daily
-- migration, not schema.sql — confirm its live signature/return type is
-- (days integer) RETURNS TABLE(day date, views bigint, visitors bigint)
-- before applying; if the return type differs, CREATE OR REPLACE errors
-- and the function must be DROPped and recreated (adjusting the shape
-- below to match what src/app/admin/page.tsx reads: day, views,
-- visitors). Re-grant EXECUTE to authenticated if the DROP path is
-- taken — the dashboard calls it with the admin's own session.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_traffic_daily(days integer)
RETURNS TABLE (day date, views bigint, visitors bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Admin access required.';
  END IF;
  RETURN QUERY
    SELECT (pv.created_at AT TIME ZONE 'utc')::date AS day,
           count(*)::bigint AS views,
           count(DISTINCT pv.visitor_id)::bigint AS visitors
      FROM public.page_views pv
     WHERE pv.created_at >= now() - make_interval(days => admin_traffic_daily.days)
     GROUP BY 1
     ORDER BY 1;
END $$;

-- ---------------------------------------------------------------------
-- 4. Per-feature rate-limit scopes (lib/rate-limit.ts).
--
-- api_rate_hits had no scope column, so every feature that reused
-- api_rate_check counted into ONE shared per-user bucket: public API
-- (30/min), voice preview (20/min), voice transcribe (10/min) +
-- synthesize (20/min), feedback (10/min), uploads (30/min), password
-- verify (5/min) all throttled EACH OTHER. Five transcribe+synthesize
-- exchanges (10 hits) exhaust transcribe's 10/min on their own; ten
-- uploads block feedback outright. Every limit silently meant "minus
-- whatever else this user did in the same minute".
--
-- Fix: a scope column, a 4-arg api_rate_check that counts and inserts
-- within (user_id, scope), and the 3-arg signature kept as a shim that
-- delegates with scope 'legacy' — so an app instance still running the
-- old code (or lib/rate-limit.ts's pre-apply fallback) keeps working,
-- just with the old shared-bucket behaviour. The advisory lock now
-- hashes user+scope (still lock key 0 — same keyspace slot, finer
-- lock text), so two different features never serialize against each
-- other; only same-scope bursts do, which is the point of the lock.
-- ---------------------------------------------------------------------
ALTER TABLE public.api_rate_hits
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'legacy';

-- Replaces schema.sql's unscoped (user_id, created_at) index — every
-- count/prune below filters by scope too, and the old index is a strict
-- prefix-loser once this one exists.
DROP INDEX IF EXISTS public.api_rate_hits_user_time;
CREATE INDEX IF NOT EXISTS api_rate_hits_user_scope_time
  ON public.api_rate_hits (user_id, scope, created_at);

CREATE OR REPLACE FUNCTION public.api_rate_check(
  p_user_id uuid, p_window_seconds int, p_max int, p_scope text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE used int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_scope, 0));
  DELETE FROM public.api_rate_hits
   WHERE user_id = p_user_id AND scope = p_scope
     AND created_at < now() - make_interval(secs => p_window_seconds * 4);
  SELECT count(*) INTO used FROM public.api_rate_hits
   WHERE user_id = p_user_id AND scope = p_scope
     AND created_at >= now() - make_interval(secs => p_window_seconds);
  IF used >= p_max THEN RETURN false; END IF;
  INSERT INTO public.api_rate_hits (user_id, scope) VALUES (p_user_id, p_scope);
  RETURN true;
END $$;

-- The legacy 3-arg signature delegates rather than duplicating the
-- logic. Existing rows carry scope 'legacy' via the column default, so
-- a not-yet-updated caller sees exactly the counts it had before.
-- CREATE OR REPLACE preserves the REVOKE/GRANT already applied to this
-- signature in schema.sql.
CREATE OR REPLACE FUNCTION public.api_rate_check(p_user_id uuid, p_window_seconds int, p_max int)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.api_rate_check(p_user_id, p_window_seconds, p_max, 'legacy');
$$;

REVOKE EXECUTE ON FUNCTION public.api_rate_check(uuid,int,int,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_rate_check(uuid,int,int,text) TO service_role;
