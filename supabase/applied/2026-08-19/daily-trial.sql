-- =====================================================================
-- 2026-08-19  Daily free trial — PENDING, apply to the live DB BEFORE
-- deploying the matching app changes.
--
-- Operator-approved (2026-08-19): the free tier changes from "5
-- generations, once, lifetime" to ONE free generation per day —
-- use-it-or-lose-it, no rollover. Companion SQL for:
--
--   src/lib/generations/core.ts       (checkGenerationAllowance gates on
--                                      the daily slot; consumeFreeGeneration
--                                      calls spend_daily_free_generation)
--   src/lib/generations/job-runner.ts (refundGenerationCosts re-opens the
--                                      day's slot via
--                                      refund_daily_free_generation)
--
-- ORDERING: apply this file FIRST, deploy second. The code FAILS CLOSED
-- until this is applied — a missing spend_daily_free_generation returns
-- no data, the guarded spend reads false, and the free path aborts with
-- the "used today's generation" message instead of running an unmetered
-- render. Applying the SQL ahead of the deploy is harmless the other way:
-- nothing calls these functions until the code ships.
--
-- The OLD lifetime mechanic is deliberately left in place in the DB:
-- profiles.free_generations_used keeps each account's historical count,
-- and spend_free_generation / increment_free_generations stay defined —
-- the code simply stops calling them. Dropping them would erase the
-- record of what accounts consumed under the old policy for no benefit.
-- =====================================================================

-- When this account last spent its daily free generation. NULL = never
-- spent (or re-opened by a refund) — either way today's slot is open.
alter table public.profiles
  add column if not exists free_generation_last_at timestamptz;

-- ---------------------------------------------------------------------
-- Atomic "spend today's free generation iff it hasn't been spent yet".
--
-- Same guarded-UPDATE shape as spend_free_generation (schema.sql): the
-- single UPDATE is already atomic — concurrent callers target the same
-- row, the row lock serializes them, and the WHERE re-evaluates for the
-- second caller, so exactly one wins. No advisory lock needed.
--
-- "Today" is the DATABASE's calendar day (date_trunc('day', now()) — UTC
-- on Supabase). One clock decides for every caller, so the boundary can't
-- drift with app-server clocks. A user's local midnight may differ from
-- UTC's, which is acceptable for a free allowance: the slot still comes
-- back exactly once per day, just not necessarily at their midnight.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.spend_daily_free_generation(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE updated int;
BEGIN
  UPDATE public.profiles SET free_generation_last_at = now()
   WHERE id = p_user_id
     AND (free_generation_last_at IS NULL
          OR free_generation_last_at < date_trunc('day', now()));
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END $$;

-- ---------------------------------------------------------------------
-- Refund for a refundable failure (see REFUNDS in job-runner.ts): re-open
-- the day's slot by clearing the marker.
--
-- Set to NULL rather than "restore the previous value" on purpose — NULL
-- is equivalent-or-better for the user and always safe:
--   * the refunded spend was today  → NULL re-opens today's slot: the
--     intended refund, exactly.
--   * the refunded spend was yesterday (edge: a render that failed after
--     midnight) → the user had already regained today's slot naturally,
--     so NULL changes nothing.
--   * a double refund, or a refund racing a fresh spend → worst case one
--     extra attempt today. The slot can never stack above one — spending
--     it just rewrites the same timestamp — and refund-loop abuse is
--     bounded upstream by the automatic_refunds kill switch and
--     refundedFailureDailyCap inside refundGenerationCosts.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_daily_free_generation(p_user_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.profiles SET free_generation_last_at = NULL
   WHERE id = p_user_id;
$$;

-- Same EXECUTE posture as spend_free_generation: service-role only —
-- authenticated must never be able to re-open (or burn) a slot directly.
REVOKE EXECUTE ON FUNCTION public.spend_daily_free_generation(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_daily_free_generation(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spend_daily_free_generation(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_daily_free_generation(uuid) TO service_role;
